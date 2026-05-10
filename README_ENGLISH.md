# FallShadow Response

<div align="right">

[简体中文](./README.md) | **English**

</div>

> An intelligent fall detection and alert system based on YOLO pose estimation

---

#### Project Collaborators

JI FENG SHUO | ZHONG YU HONG | ZHANG SUN WU JI

#### Project Topic

PSRT One-to-One Elderly Care Product of Shenzhen Zero-One Academy

---

## 1. Overview

FallShadow Response is a complete fall detection and alert system consisting of an **edge detection module** and an **Android client**.

The detection module captures real-time video via camera, uses a YOLO pose estimation model to identify 17 COCO human body keypoints, and applies a multi-rule algorithm combined with temporal consistency verification to determine whether a fall has occurred. When a fall is detected, the system automatically captures the frame and pushes it to an Android phone via **LAN WebSocket** or **Bluetooth BLE**, while calling the **Coze AI large model** for secondary confirmation to effectively reduce false alarms.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Detection Side                              │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐    │
│  │  Camera   │───▶│ YOLO Pose    │───▶│  Fall Detection    │    │
│  │           │    │ Estimation   │    │  Algorithm         │    │
│  └──────────┘    └──────────────┘    └────────┬───────────┘    │
│                                               │ Fall detected   │
│                                               ▼                 │
│                                    ┌────────────────────┐       │
│                                    │  Alert Push         │       │
│                                    │  BLE + WebSocket    │       │
│                                    └────────┬───────────┘       │
└─────────────────────────────────────────────┼──────────────────┘
                                              │ LAN / Bluetooth
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Android Side                                │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐    │
│  │ Receive Alert │───▶│ Coze AI      │───▶│ Status Update  │    │
│  │ Image (WS/BLE)│    │ Confirmation │    │ Emergency/Normal│   │
│  └──────────────┘    └──────────────┘    └────────────────┘    │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐    │
│  │  Supabase    │    │ Alert Record │    │ Device Mgmt    │    │
│  │  DB / Storage│    │ History/Del  │    │ Connection     │    │
│  └──────────────┘    └──────────────┘    └────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Quick Start

### 2.1 Download Files

| File | Description | Link |
|:---|:---|:---:|
| Android APK | Pre-built Android application | [Download](./AndroidClient/app-debug.apk) |
| fall_detect_windows.py | Windows detection script | [Download](./FallDetection/fall_detect_windows.py) |
| fall_detect_raspi.py | Raspberry Pi detection script | [Download](./FallDetection/fall_detect_raspi.py) |
| requirements.txt | Python dependencies | [View](./FallDetection/requirements.txt) |

> **Note:** Requires Android 7.0 (API 24) or above. You may need to allow "Install unknown apps" during installation.

---

### 2.2 Configure Android Client

After installing the APK, open the app and go to the **Settings** tab.

#### Step 1: Configure Coze AI Workflow

Used for secondary fall confirmation (optional but highly recommended):

| Field | Description | Example |
|:---|:---|:---|
| **Token (PAT)** | Coze platform personal access token, starts with `pat_` | `pat_xxxxxxxxxx` |
| **Workflow ID** | Your Coze workflow ID | `xxxxxxxxxxxxxxxxxxxx` |
| **Base URL** | API endpoint, use `coze.cn` for China | `https://api.coze.cn` |

Click **"Save Config"** after filling in. Use **"Test API"** to verify.

#### Step 2: Connect to Detection System

Go to the **Device** tab. Two connection methods are supported:

**Method A: LAN Connection (Recommended)**

1. Ensure your phone and computer/Raspberry Pi are on the **same WiFi** network
2. Run the detection program on computer/Pi, the terminal will show the WebSocket address (e.g., `ws://192.168.1.100:8765`)
3. In the APP, select **"LAN Connection"**, enter the IP address and port
4. IP and port only need to be entered once — they will be auto-saved

**Method B: Bluetooth Connection**

1. In the APP, select **"Bluetooth Connection"**, click **"Start Scan"**
2. Select a device with "FallDetect" in its name
3. The detection side needs to run a BLE GATT Server (Raspberry Pi only)

---

### 2.3 Run Detection System (Windows)

#### 2.3.1 Environment

- Python 3.8+
- Webcam (built-in or USB)

#### 2.3.2 Install Dependencies

```bash
pip install ultralytics opencv-python numpy websockets
# Optional BLE support:
pip install bleak
```

#### 2.3.3 Run

```bash
cd FallDetection
python fall_detect_windows.py
```

#### 2.3.4 Optional Parameters

| Parameter | Description | Default |
|:---|:---|:---:|
| `--camera N` | Camera device ID | `0` |
| `--ws-port N` | WebSocket listening port | `8765` |
| `--model PATH` | YOLO model file path | `yolo26n-pose.pt` |
| `--fps N` | Target frame rate | `30` |

Example:

```bash
python fall_detect_windows.py --camera 1 --ws-port 9000
```

#### 2.3.5 Keyboard Controls

| Key | Action |
|:---:|:---|
| `t` | Send a test alert image to connected phone |
| `q` | Quit the program |

---

### 2.4 Run Detection System (Raspberry Pi)

#### 2.4.1 Environment

- Raspberry Pi 5 (recommended) or Pi 4
- picamera2 (usually pre-installed on Raspberry Pi OS)
- BlueZ Bluetooth stack

#### 2.4.2 Install Dependencies

```bash
pip install ultralytics numpy websockets dbus-next
# If picamera2 is not installed:
sudo apt install python3-picamera2
# Bluetooth dependencies:
sudo apt install bluetooth bluez
```

#### 2.4.3 Run

```bash
cd FallDetection
python fall_detect_raspi.py
```

#### 2.4.4 Optional Parameters

| Parameter | Description | Default |
|:---|:---|:---:|
| `--camera N` | Camera device ID | `0` |
| `--ws-port N` | WebSocket listening port | `8765` |
| `--fps N` | Target frame rate (lower for Pi) | `15` |
| `--ble-name NAME` | BLE device broadcast name | `FallDetectPi` |
| `--model PATH` | YOLO model file path | `yolo11n-pose.pt` |

Example:

```bash
python fall_detect_raspi.py --fps 10 --ws-port 9000
```

#### 2.4.5 Keyboard Controls

| Key | Action |
|:---:|:---|
| `t` | Send a test alert image to connected phone |
| `Ctrl+C` | Quit the program |

---

### 2.5 Build from Source (Developers)

If you want to modify the source code and build the APK yourself, follow these steps.

#### Prerequisites

- **Node.js** 18+ and **pnpm** (install via `npm install -g pnpm`)
- Android Studio (for Android SDK and build tools)
- A [Supabase](https://supabase.com) account (free tier works)

#### Step 1: Configure Environment Variables

The project uses a `.env` file for Supabase connection credentials. This file is **not** committed to Git.

```bash
cd AndroidClient
cp .env.example .env
```

Edit `.env` and fill in your Supabase credentials:

| Variable | Description | Where to Find |
|:---|:---|:---|
| `VITE_SUPABASE_URL` | Supabase project URL | Supabase Console → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Anonymous public key (safe to expose) | Supabase Console → Project Settings → API → `anon` `public` key |
| `VITE_SENTRY_DSN` | Sentry error monitoring DSN (optional) | Sentry Project Settings → Client Keys (DSN) |
| `VITE_SENTRY_APP_ID` | Sentry App ID (optional) | Sentry Project Settings |

> **Note:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required. The Sentry variables are optional — the dev server will skip the monitoring plugin if they are not set.

#### Step 2: Initialize Supabase Database

```bash
cd AndroidClient
npx supabase db push
```

This runs the migration scripts in `supabase/migrations/` to create the required tables (alert records, API config, RLS policies, etc.).

#### Step 3: Install Dependencies and Build

```bash
cd AndroidClient
pnpm install
npx cap sync
npx cap open android     # Open the project in Android Studio
```

In Android Studio, select **Build → Build Bundle(s) / APK(s) → Build APK(s)** to generate the APK.

Or build via command line:

```bash
npx vite build
npx cap copy
cd android
./gradlew assembleDebug
```

The APK will be output to `AndroidClient/android/app/build/outputs/apk/debug/`.

#### Step 4: Install APK and Configure

Install the built APK on your phone, then follow [2.2 Configure Android Client](#22-configure-android-client) to set up the Coze AI workflow and device connection.

---

### 3.1 Android Client

| Feature | Description |
|:---|:---|
| Real-time Dashboard | Shows connection status, latest alert, monitoring feed |
| Fall Image Reception | Receives fall detection images via WebSocket or BLE |
| AI Confirmation | Calls Coze AI to analyze images, distinguishing real falls from false alarms |
| 3-Level Status | Suspected (yellow) -> Emergency (red) / Normal (blue, downgraded) |
| Alert Record Management | View history, see details, delete records |
| Device Management | BLE scan/connect, LAN IP connect, device info editing |
| Simulation Demo | Upload image to simulate full detection flow for testing |
| Onboarding Guide | Step-by-step guide for first-time API and device setup |

### 3.2 Detection System

| Feature | Description |
|:---|:---|
| Real-time Pose Detection | Detects 17 COCO human keypoints using YOLO model |
| Multi-rule Fall Detection | 5 independent rules combined to reduce false positives |
| Temporal Consistency | Multi-frame confirmation in sliding window to avoid momentary false triggers |
| Cooldown Mechanism | Auto-cooldown after fall detection to prevent repeated alerts |
| Dual-channel Push | Supports both WebSocket LAN and Bluetooth BLE push |
| Live Display | OpenCV window shows skeleton overlay, rule status, FPS info |
| Test Alert | Press `t` to send test image to phone to verify connection |

### 3.3 Collaboration Flow

```
1. Detection starts    -> Camera + YOLO model + WebSocket/BLE service
2. Android connects    -> Via LAN IP or Bluetooth to detection system
3. Real-time detection -> Pose estimation per frame -> Rule evaluation -> Temporal verification
4. Fall triggered      -> Encode JPEG -> Push to phone via WS/BLE
5. Android receives    -> Show "Suspected" status -> Create alert record -> Upload image
6. AI confirmation     -> Call Coze workflow to analyze image
7. Result handling     -> Confirmed: "Emergency" (red) + vibration alert
                       -> Not confirmed: "Normal" (blue)
```

---

## 4. Tech Stack

### 4.1 Android Client

| Technology | Purpose |
|:---|:---|
| React 18 + TypeScript | Frontend UI framework, component-based development |
| Vite | Build tool with fast HMR |
| Capacitor 8 | Hybrid app framework, packages web app as native Android APK |
| Tailwind CSS | Atomic CSS framework for rapid responsive UI |
| Radix UI | Headless UI component library (Dialog, Tabs, etc.) |
| Supabase | Backend-as-a-Service: PostgreSQL DB + Realtime subscriptions + Storage |
| Coze Workflow API | AI large model workflow for fall image confirmation |
| WebSocket | LAN real-time communication protocol for receiving alerts |
| Bluetooth LE | Low-energy Bluetooth via Capacitor BLE plugin |
| Sonner | Toast notification component |

### 4.2 Detection System

| Technology | Purpose |
|:---|:---|
| YOLO26n-pose / YOLO11n-pose | Lightweight pose detection model, outputs 17 COCO keypoints |
| OpenCV (cv2) | Camera capture, image encoding, display window |
| picamera2 | Raspberry Pi native camera library (replaces OpenCV) |
| websockets | Python WebSocket server library |
| dbus-next | D-Bus async library for Raspberry Pi BLE GATT Server |
| bleak | BLE client library (optional for Windows) |
| NumPy | Keypoint data processing and math calculations |

### 4.3 Fall Detection Algorithm

| Rule | Logic | Threshold |
|:---|:---|:---:|
| Aspect Ratio | Bounding box width / height | > 1.2 |
| Trunk Angle | Shoulder-hip line angle to horizontal | > 55 deg |
| Head Drop | Head-hip distance / shoulder-hip distance | < 0.75 |
| Keypoint Confidence | Number of visible keypoints | < 8 |
| Area Change | Current area / recent average area | > 2.5x or < 0.4x |

**Temporal Verification:**
- Sliding window: 8 frames
- Trigger threshold: at least 4 frames must trigger rules
- Cooldown: 45 frames (~1.5s at 30fps)

---

## 5. Project Structure

```
FallDetectionProject/
├── README.md                       # English documentation
├── README_zh.md                    # Chinese documentation
│
├── AndroidClient/                  # Android client application
│   ├── src/
│   │   ├── contexts/
│   │   │   └── AlertContext.tsx     # Core state management
│   │   ├── pages/
│   │   │   └── DashboardPage.tsx   # Main page UI
│   │   ├── lib/
│   │   │   ├── coze.ts             # Coze API client
│   │   │   ├── websocket.ts        # WebSocket client
│   │   │   └── bluetooth.ts        # BLE operations
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript type definitions
│   │   └── db/
│   │       └── supabase.ts         # Supabase client
│   ├── android/                    # Android native project
│   ├── package.json
│   └── app-debug.apk               # Pre-built APK
│
└── FallDetection/                  # Fall detection system
    ├── fall_detect_windows.py      # Windows local version
    ├── fall_detect_raspi.py        # Raspberry Pi version
    ├── yolo26n-pose.pt             # YOLO pose detection model
    └── requirements.txt            # Python dependencies
```

---

## License

This project is for educational and research purposes only.
