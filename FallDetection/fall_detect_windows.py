"""
跌倒检测系统 - Windows 本地版
=============================

功能概述:
    1. 使用 YOLO26n-pose 模型进行实时人体姿态检测 (COCO 17 关键点)
    2. 基于 5 条独立规则 + 时序一致性验证的多逻辑跌倒判定算法
    3. 通过 WebSocket 局域网推送跌倒告警图片到手机 APP
    4. 可选: 通过蓝牙 BLE 传输图片到手机

工作流程:
    摄像头采集 → YOLO 姿态估计 → 跌倒规则判定 → 时序验证 → 告警推送

运行方式:
    python fall_detect_windows.py                    # 默认摄像头 0
    python fall_detect_windows.py --camera 1         # 指定摄像头
    python fall_detect_windows.py --ws-port 9000     # 自定义 WS 端口

操作:
    按 'q' 退出 | 按 't' 发送测试告警图片到手机

依赖:
    pip install ultralytics opencv-python numpy websockets
    pip install bleak  # 可选, BLE 传输需要
"""

import asyncio
import base64
import json
import logging
import socket
import struct
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── BLE 协议常量 (与 app-v2 和 fall_detect_raspi.py 共用) ──
SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0"
CHAR_IMAGE_UUID = "12345678-1234-5678-1234-56789abcdef1"
CHAR_CONTROL_UUID = "12345678-1234-5678-1234-56789abcdef2"
CHAR_STATUS_UUID = "12345678-1234-5678-1234-56789abcdef3"
BLE_CHUNK_SIZE = 496  # 每个 BLE 通知包的最大 JPEG 数据字节数

# YOLO 姿态关键点索引 (COCO 17 点)
NOSE, L_EYE, R_EYE, L_EAR, R_EAR = 0, 1, 2, 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16


# ═══════════════════════════════════════════════════════════════
#  跌倒检测核心算法
#  ─────────────────────────────────────────────────────────────
#  输入: YOLO 输出的 17 个 COCO 关键点 (x, y, confidence)
#  输出: 跌倒判定结果 (fall/suspected/各规则状态)
#
#  5 条检测规则:
#    1. 身体宽高比  — 宽/高 > 1.2 说明身体处于水平状态
#    2. 躯干倾斜角  — 肩-臀连线与水平线夹角 > 55°
#    3. 头部下降比  — 头-臀距离 / 肩-臀距离 < 0.75 说明头部下垂
#    4. 关键点置信度 — 可见关键点过少说明身体被遮挡或模糊
#    5. 面积突变    — 边界框面积突然增大说明身体倒下
#
#  时序验证: 在 8 帧窗口内至少 4 帧触发规则才判定为跌倒
#  冷却机制: 检测到跌倒后冷却 45 帧 (~1.5s) 防止重复告警
# ═══════════════════════════════════════════════════════════════

def get_mid_shoulder(keypoints: np.ndarray) -> tuple:
    """计算左右肩膀中点坐标, 用于躯干倾斜角检测"""
    ls = keypoints[L_SHOULDER]
    rs = keypoints[R_SHOULDER]
    if ls[2] < 0.3 or rs[2] < 0.3:
        return None
    return ((ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2)


def get_mid_hip(keypoints: np.ndarray) -> tuple:
    """计算左右臀部中点坐标, 用于躯干倾斜角和头部下降检测"""
    lh = keypoints[L_HIP]
    rh = keypoints[R_HIP]
    if lh[2] < 0.3 or rh[2] < 0.3:
        return None
    return ((lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2)


def get_body_bbox(keypoints: np.ndarray) -> Optional[tuple]:
    """从可见关键点计算身体边界框, 用于宽高比和面积突变检测"""
    visible = keypoints[keypoints[:, 2] > 0.3]
    if len(visible) < 3:
        return None
    x_min, y_min = visible[:, 0].min(), visible[:, 1].min()
    x_max, y_max = visible[:, 0].max(), visible[:, 1].max()
    return (x_min, y_min, x_max, y_max)


def angle_between(p1: tuple, p2: tuple) -> float:
    """计算两点连线与水平线的夹角 (度), 用于躯干倾斜角检测"""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return 0.0
    return abs(np.degrees(np.arctan2(abs(dy), abs(dx))))


@dataclass
class FallDetector:
    """
    多逻辑跌倒检测器

    采用 5 条独立规则 + 时序一致性验证:
      1. 身体宽高比 (水平检测)
      2. 躯干倾斜角度
      3. 头部相对臀部下降
      4. 关键点置信度下降 (遮挡/运动模糊)
      5. 边界框面积突变

    时序一致性: 连续 N 帧中至少 M 帧触发规则才判定跌倒
    """
    # ── 规则阈值 ──
    aspect_ratio_threshold: float = 1.2     # 宽/高 > 此值视为水平
    angle_threshold: float = 55.0           # 躯干倾斜 > 此值 (度)
    drop_ratio_threshold: float = 0.75      # 头-臀距离 / 肩-臀距离
    confidence_threshold: float = 0.5       # 关键点最低置信度
    min_visible_points: int = 6             # 最少可见关键点数
    area_change_threshold: float = 2.5      # 面积突变倍数阈值

    # ── 时序参数 ──
    temporal_window: int = 8                # 滑动窗口帧数
    min_triggers: int = 4                   # 窗口内最少触发帧数
    cooldown_frames: int = 45               # 跌倒后冷却帧数 (约1.5秒@30fps)

    # ── 内部状态 ──
    _trigger_history: deque = field(default_factory=lambda: deque(maxlen=8))
    _area_history: deque = field(default_factory=lambda: deque(maxlen=10))
    _cooldown_counter: int = 0
    _fall_detected: bool = False

    def reset(self):
        self._trigger_history.clear()
        self._area_history.clear()
        self._cooldown_counter = 0
        self._fall_detected = False

    def detect(self, keypoints: np.ndarray) -> dict:
        """
        检测单帧姿态是否满足跌倒条件

        Args:
            keypoints: shape (17, 3) - (x, y, confidence)

        Returns:
            dict: {
                'fall': bool,           # 最终判定结果
                'suspected': bool,      # 单帧是否疑似
                'rules': dict,          # 各规则触发状态
                'confidence': float,    # 平均关键点置信度
                'visible_points': int,  # 可见关键点数
            }
        """
        result = {
            'fall': False,
            'suspected': False,
            'rules': {},
            'confidence': 0.0,
            'visible_points': 0,
        }

        # 冷却期内直接返回
        if self._cooldown_counter > 0:
            self._cooldown_counter -= 1
            self._trigger_history.append(False)
            return result

        # 计算平均置信度与可见关键点数
        confidences = keypoints[:, 2]
        visible_mask = confidences > self.confidence_threshold
        visible_count = int(visible_mask.sum())
        avg_confidence = float(confidences[visible_mask].mean()) if visible_count > 0 else 0.0

        result['confidence'] = avg_confidence
        result['visible_points'] = visible_count

        if visible_count < self.min_visible_points:
            self._trigger_history.append(False)
            return result

        rules = {}

        # ── 规则 1: 身体宽高比 ──
        bbox = get_body_bbox(keypoints)
        aspect_trigger = False
        if bbox:
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            if h > 0:
                ratio = w / h
                aspect_trigger = ratio > self.aspect_ratio_threshold
                rules['aspect_ratio'] = {
                    'triggered': aspect_trigger,
                    'value': round(ratio, 2),
                    'threshold': self.aspect_ratio_threshold,
                }
        if 'aspect_ratio' not in rules:
            rules['aspect_ratio'] = {'triggered': False, 'value': 0, 'threshold': self.aspect_ratio_threshold}

        # ── 规则 2: 躯干倾斜角度 ──
        mid_s = get_mid_shoulder(keypoints)
        mid_h = get_mid_hip(keypoints)
        angle_trigger = False
        if mid_s and mid_h:
            angle = angle_between(mid_s, mid_h)
            angle_trigger = angle > self.angle_threshold
            rules['trunk_angle'] = {
                'triggered': angle_trigger,
                'value': round(angle, 1),
                'threshold': self.angle_threshold,
            }
        if 'trunk_angle' not in rules:
            rules['trunk_angle'] = {'triggered': False, 'value': 0, 'threshold': self.angle_threshold}

        # ── 规则 3: 头部相对臀部下降 ──
        drop_trigger = False
        if mid_s and mid_h:
            nose_kp = keypoints[NOSE]
            if nose_kp[2] > 0.3:
                head_hip_dist = abs(nose_kp[1] - mid_h[1])
                shoulder_hip_dist = abs(mid_s[1] - mid_h[1])
                if shoulder_hip_dist > 0:
                    drop_ratio = head_hip_dist / shoulder_hip_dist
                    drop_trigger = drop_ratio < self.drop_ratio_threshold
                    rules['head_drop'] = {
                        'triggered': drop_trigger,
                        'value': round(drop_ratio, 2),
                        'threshold': self.drop_ratio_threshold,
                    }
        if 'head_drop' not in rules:
            rules['head_drop'] = {'triggered': False, 'value': 1.0, 'threshold': self.drop_ratio_threshold}

        # ── 规则 4: 关键点置信度下降 ──
        conf_trigger = visible_count < self.min_visible_points + 2
        rules['low_confidence'] = {
            'triggered': conf_trigger,
            'value': visible_count,
            'threshold': self.min_visible_points + 2,
        }

        # ── 规则 5: 边界框面积突变 ──
        area_trigger = False
        if bbox:
            current_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
            self._area_history.append(current_area)
            if len(self._area_history) >= 3:
                recent_avg = np.mean(list(self._area_history)[-3:])
                if recent_avg > 0:
                    area_ratio = current_area / recent_avg
                    area_trigger = area_ratio > self.area_change_threshold or area_ratio < (1 / self.area_change_threshold)
                    rules['area_change'] = {
                        'triggered': area_trigger,
                        'value': round(area_ratio, 2),
                        'threshold': self.area_change_threshold,
                    }
        if 'area_change' not in rules:
            rules['area_change'] = {'triggered': False, 'value': 1.0, 'threshold': self.area_change_threshold}

        result['rules'] = rules

        # ── 单帧判定: 至少 3 条规则同时触发 ──
        triggered_count = sum(1 for r in rules.values() if r['triggered'])
        suspected = triggered_count >= 3
        result['suspected'] = suspected

        self._trigger_history.append(suspected)

        # ── 时序一致性验证 ──
        if len(self._trigger_history) >= self.temporal_window:
            recent = list(self._trigger_history)[-self.temporal_window:]
            trigger_count = sum(recent)
            if trigger_count >= self.min_triggers:
                result['fall'] = True
                self._fall_detected = True
                self._cooldown_counter = self.cooldown_frames

        return result


# ═══════════════════════════════════════════════════════════════
#  BLE 图片传输 (Windows 客户端模式)
#  ─────────────────────────────────────────────────────────────
#  Windows 作为 BLE 客户端, 主动连接 Raspberry Pi 的 GATT Server
#  图片数据分块发送, 每块 496 字节, 带序号和首尾标志
#  协议: [flags(1B), reserved(1B), seq(2B), data(NB)]
# ═══════════════════════════════════════════════════════════════

class BleImageSender:
    """BLE 图片发送器 (客户端模式, 适用于 Windows)"""

    def __init__(self):
        self.device = None
        self.connected = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    async def connect(self, device_name_prefix: str = "FallDetect", timeout: float = 10.0):
        """扫描并连接到 BLE 设备"""
        try:
            from bleak import BleakScanner, BleakClient

            logger.info("正在扫描 BLE 设备 (名称前缀: %s)...", device_name_prefix)
            devices = await BleakScanner.discover(timeout=timeout, return_adv=True)

            target = None
            for dev, adv in devices.values():
                if dev.name and device_name_prefix in dev.name:
                    target = dev
                    break

            if not target:
                logger.warning("未找到名称包含 '%s' 的 BLE 设备", device_name_prefix)
                return False

            logger.info("找到设备: %s (%s)", target.name, target.address)
            self.device = BleakClient(target, disconnected_callback=self._on_disconnect)
            await self.device.connect(timeout=timeout)
            self.connected = True
            logger.info("BLE 连接成功: %s", target.name)
            return True

        except ImportError:
            logger.warning("bleak 库未安装, BLE 功能不可用")
            return False
        except Exception as e:
            logger.error("BLE 连接失败: %s", e)
            return False

    def _on_disconnect(self, client):
        self.connected = False
        logger.info("BLE 设备已断开")

    async def send_image(self, image_bytes: bytes):
        """通过 BLE 通知发送图片数据"""
        if not self.connected or not self.device:
            return False

        try:
            from bleak import BleakClient
            total = len(image_bytes)
            offset = 0
            seq = 0

            while offset < total:
                chunk = image_bytes[offset:offset + BLE_CHUNK_SIZE]
                is_first = (offset == 0)
                is_last = (offset + len(chunk) >= total)

                flags = 0
                if is_first:
                    flags |= 0x01
                if is_last:
                    flags |= 0x02

                header = struct.pack('<BBH', flags, 0, seq & 0xFFFF)
                packet = header + chunk

                await self.device.write_gatt_char(CHAR_IMAGE_UUID, packet, response=False)
                offset += len(chunk)
                seq += 1

                if not is_last:
                    await asyncio.sleep(0.005)

            logger.debug("BLE 图片发送完成 (%d 字节, %d 包)", total, seq)
            return True

        except Exception as e:
            logger.error("BLE 图片发送失败: %s", e)
            self.connected = False
            return False

    async def disconnect(self):
        if self.device and self.connected:
            try:
                await self.device.disconnect()
            except Exception:
                pass
            self.connected = False


# ═══════════════════════════════════════════════════════════════
#  WebSocket 服务器 (局域网通信)
#  ─────────────────────────────────────────────────────────────
#  手机 APP 通过局域网 WebSocket 连接到 PC, 实时接收跌倒告警
#  告警格式: JSON { type, timestamp, image(base64), rules, ... }
#  支持多客户端同时连接
# ═══════════════════════════════════════════════════════════════

class WsServer:
    """WebSocket 服务器, 用于局域网内向手机 APP 推送跌倒告警"""

    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.host = host
        self.port = port
        self.clients: set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._server = None

    async def _handler(self, websocket, path=None):
        self.clients.add(websocket)
        logger.info("WS 客户端已连接 (%d 在线)", len(self.clients))
        try:
            async for _ in websocket:
                pass
        except Exception:
            pass
        finally:
            self.clients.discard(websocket)
            logger.info("WS 客户端已断开 (%d 在线)", len(self.clients))

    async def start(self):
        import websockets
        self._loop = asyncio.get_event_loop()
        self._server = await websockets.serve(self._handler, self.host, self.port)
        logger.info("WebSocket 服务器已启动: ws://%s:%d", self.host, self.port)

    def broadcast(self, message: dict):
        if not self.clients or not self._loop:
            return
        data = json.dumps(message, ensure_ascii=False)
        for ws in list(self.clients):
            try:
                asyncio.run_coroutine_threadsafe(ws.send(data), self._loop)
            except Exception:
                self.clients.discard(ws)


# ═══════════════════════════════════════════════════════════════
#  主检测系统 (Windows)
#  ─────────────────────────────────────────────────────────────
#  整合摄像头采集、YOLO 检测、跌倒判定、BLE/WS 推送
#  主循环: 采集帧 → YOLO 推理 → 跌倒检测 → 告警 → 显示
#  BLE 和 WS 各自运行在独立线程中
# ═══════════════════════════════════════════════════════════════

class FallDetectionSystem:
    def __init__(self, camera_id: int = 0, model_name: str = "yolo26n-pose.pt",
                 target_fps: int = 30, ble_device: str = "FallDetect",
                 ws_host: str = "0.0.0.0", ws_port: int = 8765):
        self.camera_id = camera_id
        self.model_name = model_name
        self.target_fps = target_fps
        self.ble_device = ble_device
        self.ws_host = ws_host
        self.ws_port = ws_port
        self.frame_interval = 1.0 / target_fps

        self.model = None
        self.cap = None
        self.running = False
        self.detector = FallDetector()
        self.ble_sender = BleImageSender()
        self._ble_loop: Optional[asyncio.AbstractEventLoop] = None
        self.ws_server = WsServer(ws_host, ws_port)
        self._ws_loop: Optional[asyncio.AbstractEventLoop] = None
        self.alert_history: list = []
        self.max_alert_history = 100
        self.last_alert_time = 0
        self.alert_cooldown_sec = 3.0

        # FPS 计算
        self._fps_buffer: deque = deque(maxlen=30)
        self._current_fps: float = 0.0

    def _init_camera(self):
        """初始化摄像头"""
        self.cap = cv2.VideoCapture(self.camera_id)
        if not self.cap.isOpened():
            raise RuntimeError(f"无法打开摄像头 {self.camera_id}")

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.cap.set(cv2.CAP_PROP_FPS, self.target_fps)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        logger.info("摄像头已初始化: %dx%d", w, h)

    def _init_model(self):
        """初始化 YOLO 模型"""
        from ultralytics import YOLO
        logger.info("正在加载模型: %s", self.model_name)
        self.model = YOLO(self.model_name)
        logger.info("模型加载完成")

    def _draw_pose(self, frame: np.ndarray, keypoints: np.ndarray, result: dict) -> np.ndarray:
        """在帧上绘制骨骼和检测结果"""
        h, w = frame.shape[:2]
        color = (0, 0, 255) if result.get('fall') else (0, 255, 0)
        thickness = 3 if result.get('fall') else 2

        # COCO 骨骼连接定义
        skeleton = [
            (NOSE, L_EYE), (NOSE, R_EYE), (L_EYE, L_EAR), (R_EYE, R_EAR),
            (L_SHOULDER, R_SHOULDER),
            (L_SHOULDER, L_ELBOW), (L_ELBOW, L_WRIST),
            (R_SHOULDER, R_ELBOW), (R_ELBOW, R_WRIST),
            (L_SHOULDER, L_HIP), (R_SHOULDER, R_HIP),
            (L_HIP, R_HIP),
            (L_HIP, L_KNEE), (L_KNEE, L_ANKLE),
            (R_HIP, R_KNEE), (R_KNEE, R_ANKLE),
        ]

        for i, j in skeleton:
            p1, p2 = keypoints[i], keypoints[j]
            if p1[2] > 0.3 and p2[2] > 0.3:
                cv2.line(frame, (int(p1[0]), int(p1[1])),
                         (int(p2[0]), int(p2[1])), color, thickness)

        for kp in keypoints:
            if kp[2] > 0.3:
                cv2.circle(frame, (int(kp[0]), int(kp[1])), 4, color, -1)

        # 状态标签
        if result.get('fall'):
            cv2.putText(frame, "FALL DETECTED!", (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
        elif result.get('suspected'):
            cv2.putText(frame, "SUSPECTED", (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 165, 255), 2)

        # 跌倒状态标志
        fall_status = "YES" if result.get('fall') else "NO"
        status_color = (0, 0, 255) if result.get('fall') else (0, 255, 0)
        cv2.putText(frame, f"Fall: {fall_status}", (w - 180, h - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)

        # 置信度和可见点数
        info = f"Conf: {result.get('confidence', 0):.2f}  Points: {result.get('visible_points', 0)}"
        cv2.putText(frame, info, (10, h - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        # FPS 显示
        fps_text = f"FPS: {self._current_fps:.1f}"
        cv2.putText(frame, fps_text, (w - 150, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        # WebSocket 连接状态
        ws_clients = len(self.ws_server.clients) if self.ws_server else 0
        ws_color = (0, 255, 0) if ws_clients > 0 else (128, 128, 128)
        cv2.putText(frame, f"WS: {ws_clients}", (w - 150, 55),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, ws_color, 2)

        # 告警计数
        alert_count = len(self.alert_history)
        cv2.putText(frame, f"Alerts: {alert_count}", (w - 150, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)

        # 触发的规则
        rules = result.get('rules', {})
        y_offset = 70
        for name, rule in rules.items():
            if rule.get('triggered'):
                text = f"! {name}: {rule.get('value', '')}"
                cv2.putText(frame, text, (10, y_offset),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
                y_offset += 20

        return frame

    def run(self):
        """主运行函数"""
        self._init_model()
        self._init_camera()

        # 启动 BLE 事件循环 (在独立线程中)
        self._ble_loop = asyncio.new_event_loop()
        ble_thread = threading.Thread(target=self._run_ble_loop, daemon=True)
        ble_thread.start()

        # 启动 WebSocket 服务器 (在独立线程中)
        self._ws_loop = asyncio.new_event_loop()
        ws_thread = threading.Thread(target=self._run_ws_loop, daemon=True)
        ws_thread.start()

        # 获取本机局域网 IP
        local_ip = self._get_local_ip()
        logger.info("按 'q' 退出 | 按 't' 发送测试告警到手机")
        logger.info("局域网 WebSocket 地址: ws://%s:%d", local_ip, self.ws_port)
        self.running = True

        try:
            while self.running:
                frame_start = time.time()

                ret, frame = self.cap.read()
                if not ret:
                    logger.warning("无法读取摄像头帧")
                    time.sleep(0.1)
                    continue

                # YOLO 姿态检测
                result = self.model.predict(frame, verbose=False, conf=0.5)[0]

                if result.keypoints is not None and len(result.keypoints.data) > 0:
                    kp = result.keypoints.data[0].cpu().numpy()
                    det_result = self.detector.detect(kp)
                    frame = self._draw_pose(frame, kp, det_result)

                    # 跌倒告警: 发送图片
                    if det_result['fall']:
                        now = time.time()
                        if now - self.last_alert_time > self.alert_cooldown_sec:
                            self.last_alert_time = now
                            self._handle_fall_alert(frame, det_result)
                else:
                    cv2.putText(frame, "No person detected", (10, 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (128, 128, 128), 2)
                    # 无人时也显示 FPS
                    fps_text = f"FPS: {self._current_fps:.1f}"
                    cv2.putText(frame, fps_text, (frame.shape[1] - 150, 30),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

                cv2.imshow("Fall Detection (q to quit)", frame)

                # 计算实际 FPS
                frame_end = time.time()
                self._fps_buffer.append(frame_end)
                if len(self._fps_buffer) >= 2:
                    fps_window = self._fps_buffer[-1] - self._fps_buffer[0]
                    if fps_window > 0:
                        self._current_fps = (len(self._fps_buffer) - 1) / fps_window

                # 帧率控制
                elapsed = frame_end - frame_start
                sleep_time = self.frame_interval - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)

                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('t'):
                    self._send_test_alert(frame)

        except KeyboardInterrupt:
            pass
        finally:
            self.running = False
            # 清理 BLE 连接
            if self._ble_loop and self.ble_sender.connected:
                future = asyncio.run_coroutine_threadsafe(
                    self.ble_sender.disconnect(), self._ble_loop)
                future.result(timeout=5)
            if self._ble_loop:
                self._ble_loop.call_soon_threadsafe(self._ble_loop.stop)
            # 清理 WebSocket 服务器
            if self._ws_loop:
                self._ws_loop.call_soon_threadsafe(self._ws_loop.stop)
            if self.cap:
                self.cap.release()
            cv2.destroyAllWindows()
            logger.info("检测系统已停止")

    def _run_ble_loop(self):
        """BLE 事件循环线程: 连接设备并保持运行"""
        loop = self._ble_loop
        asyncio.set_event_loop(loop)
        # 阻塞式连接 BLE 设备
        connected = loop.run_until_complete(
            self.ble_sender.connect(self.ble_device))
        if connected:
            logger.info("BLE 已就绪, 等待告警...")
        else:
            logger.warning("BLE 连接失败, 图片传输不可用")
        loop.run_forever()

    def _handle_fall_alert(self, frame: np.ndarray, result: dict):
        """处理跌倒告警: 编码图片并通过 BLE + WebSocket 发送"""
        _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        jpeg_bytes = jpeg.tobytes()
        b64 = base64.b64encode(jpeg_bytes).decode('utf-8')

        # Convert numpy types to Python native types for JSON serialization
        rules = {}
        for k, v in result.get('rules', {}).items():
            if v.get('triggered'):
                rules[k] = {
                    'triggered': bool(v['triggered']),
                    'value': float(v['value']) if hasattr(v['value'], '__float__') else v['value'],
                    'threshold': float(v['threshold']) if hasattr(v['threshold'], '__float__') else v['threshold'],
                }

        alert = {
            'type': 'fall_alert',
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            'image': b64,
            'rules': rules,
            'confidence': float(result.get('confidence', 0)),
            'visible_points': int(result.get('visible_points', 0)),
        }

        logger.warning("!!! 跌倒检测告警 !!!")

        # WebSocket 广播
        self.ws_server.broadcast(alert)
        if self.ws_server.clients:
            logger.info("WebSocket 告警已推送给 %d 个客户端", len(self.ws_server.clients))

        # 通过 BLE 发送图片
        if self._ble_loop and self.ble_sender.connected:
            try:
                future = asyncio.run_coroutine_threadsafe(
                    self.ble_sender.send_image(jpeg_bytes), self._ble_loop)
                future.result(timeout=10)
                logger.info("BLE 图片发送完成 (%d 字节)", len(jpeg_bytes))
            except Exception as e:
                logger.error("BLE 图片发送失败: %s", e)
        else:
            logger.warning("BLE 未连接, 跳过图片发送")

        self.alert_history.append({
            'timestamp': alert['timestamp'],
            'confidence': alert['confidence'],
        })
        if len(self.alert_history) > self.max_alert_history:
            self.alert_history.pop(0)

    def _send_test_alert(self, frame: np.ndarray):
        """发送测试告警 (按 't' 键触发)"""
        _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        jpeg_bytes = jpeg.tobytes()
        b64 = base64.b64encode(jpeg_bytes).decode('utf-8')

        alert = {
            'type': 'fall_alert',
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            'image': b64,
            'rules': {},
            'confidence': 0.0,
            'visible_points': 0,
            'test': True,
        }

        self.ws_server.broadcast(alert)
        if self.ws_server.clients:
            logger.info("[测试] 告警已推送给 %d 个客户端", len(self.ws_server.clients))
        else:
            logger.warning("[测试] 无 WebSocket 客户端连接")

    def _run_ws_loop(self):
        """WebSocket 事件循环线程"""
        loop = self._ws_loop
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self.ws_server.start())
        loop.run_forever()

    @staticmethod
    def _get_local_ip() -> str:
        """获取本机局域网 IP 地址"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"


# ═══════════════════════════════════════════════════════════════
#  入口
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="跌倒检测系统 - Windows 本地版")
    parser.add_argument("--camera", type=int, default=0, help="摄像头 ID")
    parser.add_argument("--model", type=str, default="yolo26n-pose.pt", help="YOLO 模型路径")
    parser.add_argument("--fps", type=int, default=30, help="目标帧率")
    parser.add_argument("--ble-device", type=str, default="FallDetect", help="BLE 设备名称前缀")
    parser.add_argument("--ws-host", type=str, default="0.0.0.0", help="WebSocket 监听地址")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket 监听端口")
    args = parser.parse_args()

    system = FallDetectionSystem(
        camera_id=args.camera,
        model_name=args.model,
        target_fps=args.fps,
        ble_device=args.ble_device,
        ws_host=args.ws_host,
        ws_port=args.ws_port,
    )
    system.run()
