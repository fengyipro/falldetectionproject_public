"""
跌倒检测系统 - Raspberry Pi 5 版
=================================

功能概述:
    1. 使用 picamera2 采集摄像头画面 (替代 OpenCV VideoCapture)
    2. 使用 YOLO11n-pose 模型进行实时人体姿态检测 (COCO 17 关键点)
    3. 基于 5 条独立规则 + 时序一致性验证的多逻辑跌倒判定算法
    4. 通过 BLE GATT Server (蓝牙服务端) 向手机推送跌倒图片
    5. 同时通过 WebSocket 局域网推送告警 (与 Windows 版共用协议)

与 Windows 版的差异:
    - 摄像头: picamera2 (Linux 原生) vs OpenCV VideoCapture
    - BLE 角色: GATT Server (被动等待连接) vs BLE Client (主动连接)
    - 运行模式: async 异步 vs 同步多线程
    - 推荐帧率: 15fps (Pi 性能限制) vs 30fps

运行方式:
    python fall_detect_raspi.py                     # 默认配置
    python fall_detect_raspi.py --ws-port 9000      # 自定义 WS 端口
    python fall_detect_raspi.py --fps 10            # 降低帧率

操作:
    按 Ctrl+C 退出 | 按 't' 发送测试告警图片到手机

依赖:
    pip install ultralytics numpy websockets dbus-next
    # picamera2 通常预装在 Raspberry Pi OS, 若未安装:
    #   sudo apt install python3-picamera2
    # BLE 需要 BlueZ:
    #   sudo apt install bluetooth bluez
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

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── BLE 协议常量 (与 app-v2 和 fall_detect_windows.py 共用) ──
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
#  跌倒检测核心算法 (与 Windows 版共用)
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
    """多逻辑跌倒检测器 (与 Windows 版完全相同)"""
    aspect_ratio_threshold: float = 1.2
    angle_threshold: float = 55.0
    drop_ratio_threshold: float = 0.75
    confidence_threshold: float = 0.5
    min_visible_points: int = 6
    area_change_threshold: float = 2.5
    temporal_window: int = 8
    min_triggers: int = 4
    cooldown_frames: int = 45

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
        result = {
            'fall': False, 'suspected': False, 'rules': {},
            'confidence': 0.0, 'visible_points': 0,
        }

        if self._cooldown_counter > 0:
            self._cooldown_counter -= 1
            self._trigger_history.append(False)
            return result

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

        # 规则 1: 身体宽高比
        bbox = get_body_bbox(keypoints)
        aspect_trigger = False
        if bbox:
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            if h > 0:
                ratio = w / h
                aspect_trigger = ratio > self.aspect_ratio_threshold
                rules['aspect_ratio'] = {
                    'triggered': aspect_trigger, 'value': round(ratio, 2),
                    'threshold': self.aspect_ratio_threshold,
                }
        if 'aspect_ratio' not in rules:
            rules['aspect_ratio'] = {'triggered': False, 'value': 0, 'threshold': self.aspect_ratio_threshold}

        # 规则 2: 躯干倾斜角度
        mid_s = get_mid_shoulder(keypoints)
        mid_h = get_mid_hip(keypoints)
        angle_trigger = False
        if mid_s and mid_h:
            angle = angle_between(mid_s, mid_h)
            angle_trigger = angle > self.angle_threshold
            rules['trunk_angle'] = {
                'triggered': angle_trigger, 'value': round(angle, 1),
                'threshold': self.angle_threshold,
            }
        if 'trunk_angle' not in rules:
            rules['trunk_angle'] = {'triggered': False, 'value': 0, 'threshold': self.angle_threshold}

        # 规则 3: 头部相对臀部下降
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
                        'triggered': drop_trigger, 'value': round(drop_ratio, 2),
                        'threshold': self.drop_ratio_threshold,
                    }
        if 'head_drop' not in rules:
            rules['head_drop'] = {'triggered': False, 'value': 1.0, 'threshold': self.drop_ratio_threshold}

        # 规则 4: 关键点置信度下降
        conf_trigger = visible_count < self.min_visible_points + 2
        rules['low_confidence'] = {
            'triggered': conf_trigger, 'value': visible_count,
            'threshold': self.min_visible_points + 2,
        }

        # 规则 5: 边界框面积突变
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
                        'triggered': area_trigger, 'value': round(area_ratio, 2),
                        'threshold': self.area_change_threshold,
                    }
        if 'area_change' not in rules:
            rules['area_change'] = {'triggered': False, 'value': 1.0, 'threshold': self.area_change_threshold}

        result['rules'] = rules
        triggered_count = sum(1 for r in rules.values() if r['triggered'])
        suspected = triggered_count >= 3
        result['suspected'] = suspected
        self._trigger_history.append(suspected)

        if len(self._trigger_history) >= self.temporal_window:
            recent = list(self._trigger_history)[-self.temporal_window:]
            trigger_count = sum(recent)
            if trigger_count >= self.min_triggers:
                result['fall'] = True
                self._fall_detected = True
                self._cooldown_counter = self.cooldown_frames

        return result


# ═══════════════════════════════════════════════════════════════
#  BLE GATT Server (Raspberry Pi 蓝牙服务端)
#  ─────────────────────────────────────────────────────────────
#  Pi 注册为 BLE GATT Server, 手机 APP 作为客户端主动连接
#  使用 dbus-next 直接操作 BlueZ D-Bus API (无需 bleak)
#
#  GATT 结构:
#    Service: 12345678-1234-5678-1234-56789abcdef0
#      ├── Image Char:   ...def1  (read, notify) — 图片数据
#      ├── Status Char:  ...def3  (read, notify) — 设备状态
#      └── Control Char: ...def2  (write)        — 接收命令
#
#  图片分块协议: [flags(1B), reserved(1B), seq(2B), data(NB)]
#  flags: bit0=首包, bit1=尾包
# ═══════════════════════════════════════════════════════════════

try:
    from dbus_next.aio import MessageBus
    from dbus_next.service import ServiceInterface, method, dbus_property
    from dbus_next import Variant, BusType
    HAS_DBUS = True
except ImportError:
    HAS_DBUS = False
    logger.warning("dbus-next 未安装, BLE GATT Server 不可用")


if HAS_DBUS:
    # ── D-Bus Interface 定义 ──

    class ObjectManagerInterface(ServiceInterface):
        def __init__(self):
            super().__init__('org.freedesktop.DBus.ObjectManager')

        @method()
        def GetManagedObjects(self) -> 'a{oa{sa{sv}}}':
            return {}

    classGattManagerInterface = ServiceInterface.__init__  # placeholder


    class Characteristic(ServiceInterface):
        """BLE GATT Characteristic 基类"""

        def __init__(self, uuid: str, flags: list, service_path: str, index: int):
            self._uuid = uuid
            self._flags = flags
            self._service_path = service_path
            self._value = bytes()
            self._notifying = False
            self._path = f"{service_path}/char{index:04d}"
            super().__init__('org.bluez.GattCharacteristic1')

        @dbus_property()
        def UUID(self) -> 's':
            return self._uuid

        @dbus_property()
        def Service(self) -> 'o':
            return self._service_path

        @dbus_property()
        def Flags(self) -> 'as':
            return self._flags

        @method()
        def ReadValue(self, options: 'a{sv}') -> 'ay':
            return list(self._value)

        @method()
        def WriteValue(self, value: 'ay', options: 'a{sv}'):
            self._value = bytes(value)

        @method()
        def StartNotify(self):
            self._notifying = True

        @method()
        def StopNotify(self):
            self._notifying = False

        def set_value(self, value: bytes):
            self._value = value
            if self._notifying:
                # PropertiesChanged 信号由 dbus-next 自动处理
                pass

        @property
        def path(self):
            return self._path

        @property
        def notifying(self):
            return self._notifying


    class ImageCharacteristic(Characteristic):
        """图片数据 Characteristic - 支持通知"""

        def __init__(self, service_path: str, index: int):
            super().__init__(
                uuid=CHAR_IMAGE_UUID,
                flags=['read', 'notify'],
                service_path=service_path,
                index=index,
            )


    class ControlCharacteristic(Characteristic):
        """控制 Characteristic - 接收命令"""

        def __init__(self, service_path: str, index: int):
            self._on_command = None
            super().__init__(
                uuid=CHAR_CONTROL_UUID,
                flags=['write'],
                service_path=service_path,
                index=index,
            )

        def set_command_callback(self, callback):
            self._on_command = callback

        @method()
        def WriteValue(self, value: 'ay', options: 'a{sv}'):
            cmd = bytes(value).decode('utf-8', errors='ignore').strip()
            if self._on_command:
                self._on_command(cmd)


    class StatusCharacteristic(Characteristic):
        """状态 Characteristic - 设备状态"""

        def __init__(self, service_path: str, index: int):
            super().__init__(
                uuid=CHAR_STATUS_UUID,
                flags=['read', 'notify'],
                service_path=service_path,
                index=index,
            )


    class Service(ServiceInterface):
        """BLE GATT Service"""

        def __init__(self, path: str, uuid: str, primary: bool = True):
            self._path = path
            self._uuid = uuid
            self._primary = primary
            super().__init__('org.bluez.GattService1')

        @dbus_property()
        def UUID(self) -> 's':
            return self._uuid

        @dbus_property()
        def Primary(self) -> 'b':
            return self._primary

        @property
        def path(self):
            return self._path


    class BleApplication:
        """BLE GATT Application - ObjectManager"""

        def __init__(self):
            self._services = {}
            self._characteristics = {}
            self._path = '/com/luoying/falldetect'

        def add_service(self, service: Service):
            self._services[service.path] = service

        def add_characteristic(self, char: Characteristic):
            self._characteristics[char.path] = char

        def get_service(self, uuid: str) -> Optional[Service]:
            for svc in self._services.values():
                if svc._uuid == uuid:
                    return svc
            return None

        def get_characteristic(self, uuid: str) -> Optional[Characteristic]:
            for char in self._characteristics.values():
                if char._uuid == uuid:
                    return char
            return None

        @property
        def path(self):
            return self._path

        def get_managed_objects(self):
            """返回 ObjectManager 格式的对象树"""
            objects = {}

            # 服务
            for path, svc in self._services.items():
                objects[path] = {
                    'org.bluez.GattService1': {
                        'UUID': Variant('s', svc._uuid),
                        'Primary': Variant('b', svc._primary),
                    }
                }

            # 特征
            for path, char in self._characteristics.items():
                objects[path] = {
                    'org.bluez.GattCharacteristic1': {
                        'UUID': Variant('s', char._uuid),
                        'Service': Variant('o', char._service_path),
                        'Flags': Variant('as', char._flags),
                    }
                }

            return objects


    class Advertisement(ServiceInterface):
        """BLE 广播"""

        def __init__(self, path: str, local_name: str, service_uuids: list):
            self._path = path
            self._local_name = local_name
            self._service_uuids = service_uuids
            super().__init__('org.bluez.LEAdvertisement1')

        @dbus_property()
        def Type(self) -> 's':
            return 'peripheral'

        @dbus_property()
        def LocalName(self) -> 's':
            return self._local_name

        @dbus_property()
        def ServiceUUIDs(self) -> 'as':
            return self._service_uuids

        @property
        def path(self):
            return self._path


    class BleGattServer:
        """BLE GATT Server 管理器"""

        def __init__(self, device_name: str = "FallDetectPi"):
            self.device_name = device_name
            self.bus = None
            self.app = None
            self.advertisement = None
            self.image_char = None
            self.status_char = None
            self.control_char = None
            self._registered = False
            self._connected = False
            self._on_command = None

        def set_command_callback(self, callback):
            self._on_command = callback
            if self.control_char:
                self.control_char.set_command_callback(callback)

        async def start(self):
            """初始化并注册 BLE GATT Server"""
            self.bus = await MessageBus(bus_type=BusType.SYSTEM).connect()

            # 获取 adapter 对象路径
            introspection = await self.bus.introspect('org.bluez', '/org/bluez/hci0')
            adapter_obj = self.bus.get_proxy_object('org.bluez', '/org/bluez/hci0', introspection)
            adapter_props = adapter_obj.get_interface('org.freedesktop.DBus.Properties')

            # 设置 Powered
            try:
                await adapter_props.call_set('org.bluez.Adapter1', 'Powered', Variant('b', True))
            except Exception as e:
                logger.warning("设置 Powered 失败: %s", e)

            # 创建 Application
            self.app = BleApplication()

            # 创建 Service
            svc_path = '/com/luoying/falldetect/service0'
            service = Service(svc_path, SERVICE_UUID)
            self.app.add_service(service)

            # 创建 Characteristics
            self.image_char = ImageCharacteristic(svc_path, 0)
            self.status_char = StatusCharacteristic(svc_path, 1)
            self.control_char = ControlCharacteristic(svc_path, 2)

            if self._on_command:
                self.control_char.set_command_callback(self._on_command)

            self.app.add_characteristic(self.image_char)
            self.app.add_characteristic(self.status_char)
            self.app.add_characteristic(self.control_char)

            # 导出对象到 D-Bus
            # Application
            self.bus.export(self.app.path, {
                'org.freedesktop.DBus.ObjectManager': {
                    'GetManagedObjects': self.app.get_managed_objects,
                }
            })
            # 注: dbus-next 不支持直接导出 ObjectManager, 需要手动处理

            # 导出 Service
            self.bus.export(service.path, service)

            # 导出 Characteristics
            self.bus.export(self.image_char.path, self.image_char)
            self.bus.export(self.status_char.path, self.status_char)
            self.bus.export(self.control_char.path, self.control_char)

            # 注册 GATT Application
            gatt_mgr_introspection = await self.bus.introspect('org.bluez', '/org/bluez/hci0')
            gatt_mgr_obj = self.bus.get_proxy_object('org.bluez', '/org/bluez/hci0', gatt_mgr_introspection)
            gatt_mgr = gatt_mgr_obj.get_interface('org.bluez.GattManager1')

            try:
                await gatt_mgr.call_register_application(self.app.path, {})
                logger.info("GATT Application 注册成功")
            except Exception as e:
                logger.error("GATT Application 注册失败: %s", e)
                raise

            # 创建并注册广播
            adv_path = '/com/luoying/falldetect/adv0'
            self.advertisement = Advertisement(adv_path, self.device_name, [SERVICE_UUID])
            self.bus.export(adv_path, self.advertisement)

            adv_mgr = gatt_mgr_obj.get_interface('org.bluez.LEAdvertisingManager1')
            try:
                await adv_mgr.call_register_advertisement(adv_path, {})
                logger.info("BLE 广播注册成功")
            except Exception as e:
                logger.error("BLE 广播注册失败: %s", e)
                raise

            self._registered = True
            logger.info("BLE GATT Server 已启动, 设备名: %s", self.device_name)

        async def send_image(self, image_bytes: bytes):
            """分块发送图片数据"""
            if not self._registered or not self.image_char:
                return False

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

                self.image_char.set_value(packet)
                offset += len(chunk)
                seq += 1

                if not is_last:
                    await asyncio.sleep(0.005)  # 5ms 间隔避免缓冲区溢出

            logger.debug("BLE 图片发送完成 (%d 字节, %d 包)", total, seq)
            return True

        async def send_status(self, status: str):
            if self.status_char:
                self.status_char.set_value(status.encode('utf-8'))

        async def stop(self):
            if self._registered and self.bus:
                try:
                    gatt_mgr_introspection = await self.bus.introspect('org.bluez', '/org/bluez/hci0')
                    gatt_mgr_obj = self.bus.get_proxy_object('org.bluez', '/org/bluez/hci0', gatt_mgr_introspection)
                    gatt_mgr = gatt_mgr_obj.get_interface('org.bluez.GattManager1')
                    await gatt_mgr.call_unregister_application(self.app.path)
                except Exception:
                    pass
            if self.bus:
                self.bus.disconnect()


# ═══════════════════════════════════════════════════════════════
#  WebSocket 服务器 (局域网通信, 与 Windows 版共用)
#  ─────────────────────────────────────────────────────────────
#  手机 APP 通过局域网 WebSocket 连接到 Pi, 实时接收跌倒告警
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
#  picamera2 摄像头封装 (Raspberry Pi 专用)
#  ─────────────────────────────────────────────────────────────
#  使用 Linux 原生 picamera2 库采集摄像头画面
#  输出 RGB888 格式, 自动转换为 BGR 供 OpenCV 使用
# ═══════════════════════════════════════════════════════════════

class PiCamera:
    """Raspberry Pi Camera 封装 (使用 picamera2)"""

    def __init__(self, camera_id: int = 0, width: int = 640, height: int = 480):
        self.camera_id = camera_id
        self.width = width
        self.height = height
        self.camera = None
        self._frame = None
        self._lock = threading.Lock()
        self._running = False

    def start(self):
        """启动摄像头"""
        try:
            from picamera2 import Picamera2
            self.camera = Picamera2(self.camera_id)
            config = self.camera.create_video_configuration(
                main={"size": (self.width, self.height), "format": "RGB888"},
            )
            self.camera.configure(config)
            self.camera.start()
            self._running = True

            # 预热
            time.sleep(1)
            logger.info("picamera2 已启动: %dx%d (camera %d)", self.width, self.height, self.camera_id)
        except ImportError:
            logger.error("picamera2 未安装! 请运行: sudo apt install python3-picamera2")
            raise
        except Exception as e:
            logger.error("picamera2 启动失败: %s", e)
            raise

    def read(self) -> Optional[np.ndarray]:
        """读取一帧 (返回 BGR 格式的 numpy 数组, 与 OpenCV 兼容)"""
        if not self._running or not self.camera:
            return None
        try:
            frame = self.camera.capture_array()
            # picamera2 输出 RGB, 转换为 BGR 供 OpenCV 使用
            if frame is not None:
                return frame[:, :, ::-1].copy()
            return None
        except Exception as e:
            logger.error("picamera2 读取失败: %s", e)
            return None

    def stop(self):
        if self.camera:
            self._running = False
            self.camera.stop()
            self.camera.close()
            logger.info("picamera2 已停止")

    @property
    def is_opened(self) -> bool:
        return self._running and self.camera is not None


# ═══════════════════════════════════════════════════════════════
#  主检测系统 (Raspberry Pi 5)
#  ─────────────────────────────────────────────────────────────
#  整合 picamera2、YOLO 检测、跌倒判定、BLE GATT/WS 推送
#  主循环: 采集帧 → YOLO 推理 → 跌倒检测 → 告警 → 显示
#  BLE 和 WS 在同一 async 事件循环中运行
# ═══════════════════════════════════════════════════════════════

class FallDetectionSystem:
    def __init__(self, camera_id: int = 0, model_name: str = "yolo11n-pose.pt",
                 ws_host: str = "0.0.0.0", ws_port: int = 8765,
                 target_fps: int = 15, ble_name: str = "FallDetectPi"):
        self.camera_id = camera_id
        self.model_name = model_name
        self.ws_host = ws_host
        self.ws_port = ws_port
        self.target_fps = target_fps
        self.ble_name = ble_name
        self.frame_interval = 1.0 / target_fps

        self.model = None
        self.camera = None
        self.running = False
        self.detector = FallDetector()
        self.ws_server = WsServer(ws_host, ws_port)
        self.ble_server = BleGattServer(ble_name) if HAS_DBUS else None
        self.alert_history: list = []
        self.max_alert_history = 100
        self.last_alert_time = 0
        self.alert_cooldown_sec = 3.0

        # FPS 计算
        self._fps_buffer: deque = deque(maxlen=30)
        self._current_fps: float = 0.0

    def _init_camera(self):
        self.camera = PiCamera(self.camera_id, 640, 480)
        self.camera.start()

    def _init_model(self):
        from ultralytics import YOLO
        logger.info("正在加载模型: %s", self.model_name)
        self.model = YOLO(self.model_name)
        logger.info("模型加载完成")

    def _draw_pose(self, frame: np.ndarray, keypoints: np.ndarray, result: dict) -> np.ndarray:
        import cv2

        h, w = frame.shape[:2]
        color = (0, 0, 255) if result.get('fall') else (0, 255, 0)
        thickness = 3 if result.get('fall') else 2

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

    async def run(self):
        """主运行函数 (异步)"""
        self._init_model()
        self._init_camera()

        # 启动 BLE GATT Server
        if self.ble_server:
            try:
                await self.ble_server.start()
            except Exception as e:
                logger.error("BLE Server 启动失败: %s", e)
                self.ble_server = None

        # 启动 WebSocket 服务器
        await self.ws_server.start()

        # 获取本机局域网 IP
        local_ip = self._get_local_ip()
        logger.info("按 Ctrl+C 退出 | 按 't' 发送测试告警到手机")
        logger.info("局域网 WebSocket 地址: ws://%s:%d", local_ip, self.ws_port)
        self.running = True

        import cv2

        try:
            while self.running:
                frame_start = time.time()

                frame = self.camera.read()
                if frame is None:
                    await asyncio.sleep(0.1)
                    continue

                # YOLO 姿态检测
                result = self.model.predict(frame, verbose=False, conf=0.5)[0]

                if result.keypoints is not None and len(result.keypoints.data) > 0:
                    kp = result.keypoints.data[0].cpu().numpy()
                    det_result = self.detector.detect(kp)
                    frame = self._draw_pose(frame, kp, det_result)

                    if det_result['fall']:
                        now = time.time()
                        if now - self.last_alert_time > self.alert_cooldown_sec:
                            self.last_alert_time = now
                            await self._handle_fall_alert(frame, det_result)
                else:
                    cv2.putText(frame, "No person detected", (10, 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (128, 128, 128), 2)
                    # 无人时也显示 FPS
                    fps_text = f"FPS: {self._current_fps:.1f}"
                    cv2.putText(frame, fps_text, (frame.shape[1] - 150, 30),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

                cv2.imshow("Fall Detection (q to quit, t for test alert)", frame)

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
                    await asyncio.sleep(sleep_time)

                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('t'):
                    self._send_test_alert(frame)

        except KeyboardInterrupt:
            pass
        finally:
            self.running = False
            if self.camera:
                self.camera.stop()
            if self.ble_server:
                await self.ble_server.stop()
            cv2.destroyAllWindows()
            logger.info("检测系统已停止")

    async def _handle_fall_alert(self, frame: np.ndarray, result: dict):
        """处理跌倒告警: 编码图片并通过 BLE + WebSocket 发送"""
        import cv2

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

        # BLE 发送
        if self.ble_server:
            try:
                await self.ble_server.send_status("FALL_ALERT")
                await self.ble_server.send_image(jpeg_bytes)
                logger.info("BLE 图片已发送 (%d 字节)", len(jpeg_bytes))
            except Exception as e:
                logger.error("BLE 发送失败: %s", e)

        self.alert_history.append({
            'timestamp': alert['timestamp'],
            'confidence': alert['confidence'],
        })
        if len(self.alert_history) > self.max_alert_history:
            self.alert_history.pop(0)

    def _send_test_alert(self, frame):
        """发送测试告警 (按 't' 键触发)"""
        import cv2

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

async def main():
    import argparse

    parser = argparse.ArgumentParser(description="跌倒检测系统 - Raspberry Pi 5 版")
    parser.add_argument("--camera", type=int, default=0, help="摄像头 ID")
    parser.add_argument("--model", type=str, default="yolo11n-pose.pt", help="YOLO 模型路径")
    parser.add_argument("--ws-host", type=str, default="0.0.0.0", help="WebSocket 监听地址")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket 端口")
    parser.add_argument("--fps", type=int, default=15, help="目标帧率 (Pi 建议 15)")
    parser.add_argument("--ble-name", type=str, default="FallDetectPi", help="BLE 设备名称")
    args = parser.parse_args()

    system = FallDetectionSystem(
        camera_id=args.camera,
        model_name=args.model,
        ws_host=args.ws_host,
        ws_port=args.ws_port,
        target_fps=args.fps,
        ble_name=args.ble_name,
    )
    await system.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
