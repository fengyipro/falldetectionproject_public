# 落影有应

<div align="right">

**简体中文** | [English](./README_ENGLISH.md)

</div>

> 基于 YOLO 姿态检测的智能跌倒预警系统

***

#### 项目协作者

JI FENG SHUO | ZHONG YU HONG | ZHANG SUN WU JI

#### 项目主题

深圳零一学院PSRT一小帮一老产品

***

## 1. 项目简介

落影有应是一个完整的跌倒检测预警系统，由**边缘检测端**和**安卓客户端**两部分组成。

检测端通过摄像头采集实时画面，使用 YOLO 姿态检测模型识别人体 17 个 COCO 关键点，结合多规则算法和时序一致性验证判断是否发生跌倒。一旦检测到跌倒，系统会自动截取画面并通过**局域网 WebSocket** 或**蓝牙 BLE** 推送到安卓手机，同时调用 **Coze AI 大模型**进行二次确认，有效降低误报率。

```
┌─────────────────────────────────────────────────────────────────┐
│                         检测端                                   │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐     │
│  │  摄像头   │───▶│ YOLO 姿态检测 │───▶│  跌倒判定算法       │     │
│  └──────────┘    └──────────────┘    └────────┬───────────┘     │
│                                               │ 检测到跌倒       │
│                                               ▼                  │
│                                    ┌────────────────────┐        │
│                                    │  告警推送            │        │
│                                    │  BLE + WebSocket    │        │
│                                    └────────┬───────────┘        │
└─────────────────────────────────────────────┼───────────────────┘
                                              │ 局域网 / 蓝牙
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         安卓端                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐     │
│  │  接收告警图片  │───▶│ Coze AI 确认  │───▶│  状态更新/预警   │     │
│  │  WS / BLE    │    │ 大模型分析     │    │ 紧急/一般/疑似  │     │
│  └──────────────┘    └──────────────┘    └────────────────┘     │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐     │
│  │  Supabase    │    │  实时记录管理  │    │  设备管理       │     │
│  │  数据库/存储   │    │  历史查询/删除 │    │  连接状态       │     │
│  └──────────────┘    └──────────────┘    └────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

***

## 2. 快速开始

### 2.1 下载文件

| 文件                       | 说明           |                      下载                      |
| :----------------------- | :----------- | :------------------------------------------: |
| Android APK              | 安卓应用安装包      |  [下载](./AndroidClient/落影有应_FINALVERSION.apk) |
| fall\_detect\_windows.py | Windows 检测脚本 | [下载](./FallDetection/fall_detect_windows.py) |
| fall\_detect\_raspi.py   | 树莓派检测脚本      |  [下载](./FallDetection/fall_detect_raspi.py)  |
| requirements.txt         | Python 依赖列表  |    [查看](./FallDetection/requirements.txt)    |

> **注意：** 需要安卓 7.0 (API 24) 及以上版本。安装时可能需要允许"安装未知来源应用"。

***

### 2.2 配置安卓端

安装 APK 后，打开应用，进入**设置**页面。

#### 第一步：配置 Coze AI 工作流

用于跌倒二次确认（可选但强烈推荐）：

| 字段              | 说明                        | 示例                     |
| :-------------- | :------------------------ | :--------------------- |
| **Token (PAT)** | Coze 平台个人访问令牌，以 `pat_` 开头 | `pat_xxxxxxxxxx`       |
| **Workflow ID** | 你的 Coze 工作流 ID            | `xxxxxxxxxxxxxxxxxxxx` |
| **Base URL**    | API 地址，国内用户使用 coze.cn     | `https://api.coze.cn`  |

配置完成后点击「**保存配置**」，可使用「**API测试**」验证是否正确。

#### 第二步：连接检测端

进入**设备**页面，支持两种连接方式：

**方式一：局域网连接（推荐）**

1. 确保手机和电脑/树莓派连接到**同一个 WiFi** 网络
2. 在电脑/树莓派上运行检测程序，终端会显示 WebSocket 地址（如 `ws://192.168.1.100:8765`）
3. 在 APP 中选择「**局域网连接**」，输入 IP 地址和端口号
4. IP 和端口只需输入一次，之后会自动保存

**方式二：蓝牙连接**

1. 在 APP 中选择「**蓝牙连接**」，点击「**开始扫描**」
2. 选择名称包含 "FallDetect" 的设备进行连接
3. 检测端需要运行 BLE GATT Server（仅树莓派支持）

***

### 2.3 运行检测端 — Windows 本地版

#### 2.3.1 环境要求

- Python 3.8+
- 摄像头（内置或 USB）

#### 2.3.2 安装依赖

```bash
pip install ultralytics opencv-python numpy websockets
# 可选 BLE 支持：
pip install bleak
```

#### 2.3.3 运行

```bash
cd FallDetection
python fall_detect_windows.py
```

#### 2.3.4 可选参数

| 参数             | 说明             |        默认值        |
| :------------- | :------------- | :---------------: |
| `--camera N`   | 摄像头设备 ID       |        `0`        |
| `--ws-port N`  | WebSocket 监听端口 |       `8765`      |
| `--model PATH` | YOLO 模型文件路径    | `yolo26n-pose.pt` |
| `--fps N`      | 目标帧率           |        `30`       |

示例：

```bash
python fall_detect_windows.py --camera 1 --ws-port 9000
```

#### 2.3.5 键盘操作

|  按键 | 功能              |
| :-: | :-------------- |
| `t` | 发送测试告警图片到已连接的手机 |
| `q` | 退出程序            |

***

### 2.4 运行检测端 — Raspberry Pi 版

#### 2.4.1 环境要求

- Raspberry Pi 5（推荐）或 Pi 4
- picamera2（通常预装在 Raspberry Pi OS）
- BlueZ 蓝牙协议栈

#### 2.4.2 安装依赖

```bash
pip install ultralytics numpy websockets dbus-next
# picamera2 若未安装：
sudo apt install python3-picamera2
# 蓝牙依赖：
sudo apt install bluetooth bluez
```

#### 2.4.3 运行

```bash
cd FallDetection
python fall_detect_raspi.py
```

#### 2.4.4 可选参数

| 参数                | 说明             |        默认值        |
| :---------------- | :------------- | :---------------: |
| `--camera N`      | 摄像头设备 ID       |        `0`        |
| `--ws-port N`     | WebSocket 监听端口 |       `8765`      |
| `--fps N`         | 目标帧率（Pi 建议较低）  |        `15`       |
| `--ble-name NAME` | BLE 广播设备名称     |   `FallDetectPi`  |
| `--model PATH`    | YOLO 模型文件路径    | `yolo11n-pose.pt` |

示例：

```bash
python fall_detect_raspi.py --fps 10 --ws-port 9000
```

#### 2.4.5 键盘操作

|    按键    | 功能              |
| :------: | :-------------- |
|    `t`   | 发送测试告警图片到已连接的手机 |
| `Ctrl+C` | 退出程序            |

***

### 2.5 从源代码构建（开发者）

如果你想修改源代码并自行构建 APK，请按以下步骤操作。

#### 环境要求

- **Node.js** 18+ 和 **pnpm**（推荐通过 `npm install -g pnpm` 安装）
- Android Studio（用于 Android SDK 和构建工具）
- 一个 [Supabase](https://supabase.com) 账户（免费层即可）

#### 第一步：配置环境变量

项目使用 `.env` 文件管理 Supabase 连接凭证。该文件不会提交到 Git 仓库。

```bash
cd AndroidClient
cp .env.example .env
```

编辑 `.env` 文件，填入你的 Supabase 凭证：

| 变量 | 说明 | 在哪获取 |
|:---|:---|:---|
| `VITE_SUPABASE_URL` | Supabase 项目 URL | Supabase 控制台 → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | 匿名公钥（可安全公开） | Supabase 控制台 → Project Settings → API → `anon` `public` key |
| `VITE_SENTRY_DSN` | Sentry 错误监控 DSN（可选） | Sentry 项目设置 → Client Keys (DSN) |
| `VITE_SENTRY_APP_ID` | Sentry App ID（可选） | Sentry 项目设置 |

> **提示：** `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 是必需的，其余变量可选。不填 Sentry 变量时，开发模式不会启用错误监控插件。

#### 第二步：初始化 Supabase 数据库

```bash
cd AndroidClient
npx supabase db push
```

这将执行 `supabase/migrations/` 目录下的迁移脚本，创建所需的表结构（告警记录表、API 配置表、RLS 安全策略等）。

#### 第三步：安装依赖并构建

```bash
cd AndroidClient
pnpm install
npx cap sync
npx cap open android     # 在 Android Studio 中打开项目
```

在 Android Studio 中选择 **Build → Build Bundle(s) / APK(s) → Build APK(s)** 即可生成 APK 文件。

或者直接用命令行构建：

```bash
npx vite build
npx cap copy
cd android
./gradlew assembleDebug
```

APK 将输出到 `AndroidClient/android/app/build/outputs/apk/debug/`。

#### 第四步：安装 APK 并配置

将构建好的 APK 安装到手机上，然后按照 [2.2 配置安卓端](#22-配置安卓端) 的步骤配置 Coze AI 工作流和设备连接即可。

***

## 3. 功能说明

### 3.1 安卓端功能

| 功能      | 说明                              |
| :------ | :------------------------------ |
| 实时监控面板  | 显示当前连接状态、最新警报、监控画面              |
| 跌倒图片接收  | 通过 WebSocket 或 BLE 接收检测端推送的跌倒画面 |
| AI 二次确认 | 调用 Coze 大模型分析图片，区分真实跌倒与误报       |
| 三级状态管理  | 疑似（黄色）→ 紧急（红色）/ 一般（蓝色，降级）       |
| 警报记录管理  | 查看历史记录、查看详情、删除记录                |
| 设备管理    | 蓝牙搜索连接、局域网 IP 连接、设备信息编辑         |
| 模拟演示    | 上传图片模拟完整检测流程，用于测试验证             |
| 使用引导    | 分步骤引导首次配置 API 和设备连接             |

### 3.2 检测端功能

| 功能      | 说明                           |
| :------ | :--------------------------- |
| 实时姿态检测  | 使用 YOLO 模型检测 17 个 COCO 人体关键点 |
| 多规则跌倒判定 | 5 条独立规则综合判定，降低单一规则误报         |
| 时序一致性验证 | 滑动窗口内多帧确认，避免瞬间误判             |
| 冷却机制    | 检测到跌倒后自动冷却，防止重复告警            |
| 双通道推送   | 同时支持 WebSocket 局域网和蓝牙 BLE 推送 |
| 实时画面显示  | OpenCV 窗口显示骨骼叠加、规则状态、FPS 信息  |
| 测试告警    | 按 `t` 键发送测试图片到手机，验证连接        |

### 3.3 协作流程

```Markdown
1. 检测端启动    → 启动摄像头 + YOLO 模型 + WebSocket/BLE 服务
2. 安卓端连接    → 通过局域网 IP 或蓝牙连接到检测端
3. 实时检测      → 每帧姿态估计 → 跌倒规则判定 → 时序验证
4. 跌倒触发      → 编码 JPEG → 通过 WS/BLE 推送到手机
5. 安卓接收      → 显示"疑似"状态 → 创建告警记录 → 上传图片
6. AI 确认       → 调用 Coze 工作流分析图片
7. 结果处理      → 确认跌倒: 升级为"紧急"(红色) + 振动预警
                 → 未确认: 降级为"一般"(蓝色)
```

***

## 4. 技术栈

### 4.1 安卓端

| 技术                    | 用途                                 |
| :-------------------- | :--------------------------------- |
| React 18 + TypeScript | 前端 UI 框架，组件化开发                     |
| Vite                  | 构建工具，快速热更新                         |
| Capacitor 8           | 混合应用框架，将 Web 应用打包为原生 Android APK   |
| Tailwind CSS          | 原子化 CSS 框架，快速构建响应式 UI              |
| Radix UI              | 无头 UI 组件库（Dialog、Tabs 等）           |
| Supabase              | 后端即服务：PostgreSQL 数据库 + 实时订阅 + 文件存储 |
| Coze Workflow API     | AI 大模型工作流，用于跌倒图片二次确认               |
| WebSocket             | 局域网实时通信协议，接收检测端推送的告警               |
| Bluetooth LE          | 低功耗蓝牙，通过 Capacitor BLE 插件实现设备连接    |
| Sonner                | Toast 通知组件                         |

### 4.2 检测端

| 技术                          | 用途                                        |
| :-------------------------- | :---------------------------------------- |
| YOLO26n-pose / YOLO11n-pose | 轻量级姿态检测模型，输出 17 个 COCO 关键点                |
| OpenCV (cv2)                | 摄像头采集、图像编码、画面显示                           |
| picamera2                   | Raspberry Pi 原生摄像头库（替代 OpenCV）            |
| websockets                  | Python WebSocket 服务器库                     |
| dbus-next                   | D-Bus 异步库，用于 Raspberry Pi BLE GATT Server |
| bleak                       | BLE 客户端库（Windows 版可选）                     |
| NumPy                       | 关键点数据处理和数学计算                              |

### 4.3 跌倒判定算法

| 规则     | 逻辑            |        阈值       |
| :----- | :------------ | :-------------: |
| 身体宽高比  | 边界框宽度 / 高度    |      > 1.2      |
| 躯干倾斜角  | 肩-臀连线与水平线夹角   |      > 55°      |
| 头部下降比  | 头-臀距 / 肩-臀距   |      < 0.75     |
| 关键点置信度 | 可见关键点数        |       < 8       |
| 面积突变   | 当前面积 / 近期平均面积 | > 2.5x 或 < 0.4x |

**时序验证：**

- 滑动窗口：8 帧
- 触发阈值：至少 4 帧触发规则
- 冷却期：45 帧（约 1.5 秒 @30fps）

***

## 5. 目录结构

```
FallDetectionProject/
├── README.md                       # 英文文档
├── README_zh.md                    # 中文文档
│
├── AndroidClient/                  # 安卓客户端
│   ├── src/
│   │   ├── contexts/
│   │   │   └── AlertContext.tsx     # 核心状态管理
│   │   ├── pages/
│   │   │   └── DashboardPage.tsx   # 主页面 UI
│   │   ├── lib/
│   │   │   ├── coze.ts             # Coze API 调用
│   │   │   ├── websocket.ts        # WebSocket 客户端
│   │   │   └── bluetooth.ts        # BLE 蓝牙操作
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript 类型定义
│   │   └── db/
│   │       └── supabase.ts         # Supabase 客户端
│   ├── android/                    # Android 原生工程
│   ├── package.json
│   └── app-debug.apk               # 预编译 APK
│
└── FallDetection/                  # 跌倒检测端
    ├── fall_detect_windows.py      # Windows 本地版
    ├── fall_detect_raspi.py        # Raspberry Pi 版
    ├── yolo26n-pose.pt             # YOLO 姿态检测模型
    └── requirements.txt            # Python 依赖
```

***

## 许可

本项目仅供学习和研究使用。
