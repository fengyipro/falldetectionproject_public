import { BleClient, BleDevice, Data } from '@capacitor-community/bluetooth-le';

export interface BluetoothCheckResult {
  supported: boolean;
  secureContext: boolean;
  isIOS: boolean;
  isCapacitor: boolean;
  message: string;
}

// 检测是否在 Capacitor 环境中运行
function isCapacitorPlatform(): boolean {
  return typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
}

export function checkBluetoothSupport(): BluetoothCheckResult {
  const isCapacitor = isCapacitorPlatform();
  const isSecure =
    typeof window !== 'undefined' &&
    (window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost');
  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Capacitor 原生环境总是支持蓝牙
  if (isCapacitor) {
    return {
      supported: true,
      secureContext: true,
      isIOS,
      isCapacitor: true,
      message: '当前环境支持蓝牙连接（原生模式）',
    };
  }

  // Web 环境检测
  if (!isSecure) {
    return {
      supported: false,
      secureContext: false,
      isIOS,
      isCapacitor: false,
      message: '蓝牙连接需要在 HTTPS 安全环境下运行',
    };
  }

  if (isIOS) {
    return {
      supported: false,
      secureContext: isSecure,
      isIOS: true,
      isCapacitor: false,
      message: 'iOS 暂不支持蓝牙直连，请使用模拟演示功能测试完整流程',
    };
  }

  const hasAPI =
    typeof navigator !== 'undefined' &&
    !!(navigator as any).bluetooth;

  if (!hasAPI) {
    return {
      supported: false,
      secureContext: isSecure,
      isIOS,
      isCapacitor: false,
      message: '当前浏览器不支持蓝牙，建议使用 Android Chrome、Edge 或 Samsung Internet 浏览器',
    };
  }

  return {
    supported: true,
    secureContext: true,
    isIOS: false,
    isCapacitor: false,
    message: '当前环境支持蓝牙连接',
  };
}

// 初始化 BLE 客户端
export async function initializeBle(): Promise<void> {
  if (!isCapacitorPlatform()) {
    return;
  }

  try {
    await BleClient.initialize();
  } catch (error) {
    console.error('BLE 初始化失败:', error);
    throw error;
  }
}

// Capacitor BLE 扫描并连接设备
export async function scanAndConnectBle(
  onDeviceFound?: (device: BleDevice) => void
): Promise<BleDevice | null> {
  if (!isCapacitorPlatform()) {
    throw new Error('此函数仅在 Capacitor 原生环境中可用');
  }

  try {
    // 请求扫描并连接设备
    const device = await BleClient.requestDevice({
      // 可以配置服务 UUID 过滤器，如果知道目标设备的服务 UUID
      // services: ['your-service-uuid'],
      // 使用空配置扫描所有设备
      namePrefix: '',
    });

    if (device) {
      // 连接到设备
      await BleClient.connect(device.deviceId, (deviceId) => {
        console.log('设备断开连接:', deviceId);
      });

      if (onDeviceFound) {
        onDeviceFound(device);
      }

      return device;
    }

    return null;
  } catch (error: any) {
    console.error('BLE 扫描连接失败:', error);
    throw error;
  }
}

// 断开 BLE 设备连接
export async function disconnectBle(deviceId: string): Promise<void> {
  if (!isCapacitorPlatform()) {
    throw new Error('此函数仅在 Capacitor 原生环境中可用');
  }

  try {
    await BleClient.disconnect(deviceId);
  } catch (error) {
    console.error('断开连接失败:', error);
    throw error;
  }
}

// 启用蓝牙（Android 原生）
export async function enableBluetooth(): Promise<void> {
  if (!isCapacitorPlatform()) {
    throw new Error('此函数仅在 Capacitor 原生环境中可用');
  }

  try {
    await BleClient.enable();
  } catch (error) {
    console.error('启用蓝牙失败:', error);
    throw error;
  }
}

// 检查蓝牙是否启用
export async function isBluetoothEnabled(): Promise<boolean> {
  if (!isCapacitorPlatform()) {
    return false;
  }

  try {
    return await BleClient.isEnabled();
  } catch {
    return false;
  }
}

// ── 跌倒检测 BLE 图片传输协议 ──
// 与 Python 端 (fall_detect_windows.py / fall_detect_raspi.py) 共用协议常量
export const FALL_DETECT_SERVICE_UUID = '12345678-1234-5678-1234-56789abcdef0';
export const CHAR_IMAGE_UUID = '12345678-1234-5678-1234-56789abcdef1';
export const CHAR_CONTROL_UUID = '12345678-1234-5678-1234-56789abcdef2';
export const CHAR_STATUS_UUID = '12345678-1234-5678-1234-56789abcdef3';

export interface FallDetectDevice {
  deviceId: string;
  name: string;
  rssi?: number;
}

export interface ImageChunkState {
  buffer: Uint8Array;
  expectedSeq: number;
  isReceiving: boolean;
  startTime: number;
}

// 扫描跌倒检测设备 (带服务过滤)
export async function scanFallDetectDevices(
  onDeviceFound: (device: FallDetectDevice) => void,
  scanDuration: number = 5000,
): Promise<void> {
  if (!isCapacitorPlatform()) {
    throw new Error('此函数仅在 Capacitor 原生环境中可用');
  }

  try {
    await BleClient.requestLEScan(
      {
        services: [FALL_DETECT_SERVICE_UUID],
      },
      (result) => {
        if (result.device.name) {
          onDeviceFound({
            deviceId: result.device.deviceId,
            name: result.device.name,
            rssi: result.rssi,
          });
        }
      },
    );

    // 扫描指定时长后停止
    setTimeout(async () => {
      await BleClient.stopLEScan();
    }, scanDuration);
  } catch (error: any) {
    console.error('BLE 扫描失败:', error);
    throw error;
  }
}

// 停止 BLE 扫描
export async function stopBleScan(): Promise<void> {
  if (!isCapacitorPlatform()) return;
  try {
    await BleClient.stopLEScan();
  } catch (error) {
    console.error('停止扫描失败:', error);
  }
}

// 连接到跌倒检测设备
export async function connectFallDetectDevice(
  deviceId: string,
  onDisconnect?: (deviceId: string) => void,
): Promise<void> {
  if (!isCapacitorPlatform()) {
    throw new Error('此函数仅在 Capacitor 原生环境中可用');
  }

  try {
    await BleClient.connect(deviceId, (id) => {
      console.log('跌倒检测设备断开:', id);
      if (onDisconnect) onDisconnect(id);
    });
    console.log('已连接到跌倒检测设备:', deviceId);
  } catch (error: any) {
    console.error('连接跌倒检测设备失败:', error);
    throw error;
  }
}

// 监听图片数据通知 (分块接收并重组)
export async function listenForImageNotifications(
  deviceId: string,
  onImageReceived: (imageBase64: string) => void,
  onStatusReceived?: (status: string) => void,
): Promise<() => void> {
  if (!isCapacitorPlatform()) {
    throw new Error('此函数仅在 Capacitor 原生环境中可用');
  }

  const chunkState: ImageChunkState = {
    buffer: new Uint8Array(0),
    expectedSeq: 0,
    isReceiving: false,
    startTime: 0,
  };

  // 监听图片数据 Characteristic
  await BleClient.startNotifications(deviceId, FALL_DETECT_SERVICE_UUID, CHAR_IMAGE_UUID, (value: Data) => {
    const data = new Uint8Array(value.buffer);
    if (data.length < 4) return;

    // 解析头部: flags(1) + reserved(1) + seq(2)
    const flags = data[0];
    const seq = data[1] | (data[2] << 8);
    const chunk = data.slice(4);

    const isStart = (flags & 0x01) !== 0;
    const isEnd = (flags & 0x02) !== 0;

    if (isStart) {
      chunkState.buffer = new Uint8Array(0);
      chunkState.expectedSeq = 0;
      chunkState.isReceiving = true;
      chunkState.startTime = Date.now();
    }

    if (!chunkState.isReceiving) return;

    // 追加数据
    const newBuffer = new Uint8Array(chunkState.buffer.length + chunk.length);
    newBuffer.set(chunkState.buffer);
    newBuffer.set(chunk, chunkState.buffer.length);
    chunkState.buffer = newBuffer;
    chunkState.expectedSeq = seq + 1;

    // 超时检查 (10秒)
    if (Date.now() - chunkState.startTime > 10000) {
      chunkState.isReceiving = false;
      console.warn('图片接收超时, 已丢弃');
      return;
    }

    if (isEnd) {
      chunkState.isReceiving = false;
      // 转换为 base64
      const base64 = arrayBufferToBase64(chunkState.buffer.buffer);
      onImageReceived(base64);
    }
  });

  // 监听状态 Characteristic
  if (onStatusReceived) {
    await BleClient.startNotifications(deviceId, FALL_DETECT_SERVICE_UUID, CHAR_STATUS_UUID, (value: Data) => {
      const text = new TextDecoder().decode(value.buffer);
      onStatusReceived(text.trim());
    });
  }

  // 返回清理函数
  return async () => {
    try {
      await BleClient.stopNotifications(deviceId, FALL_DETECT_SERVICE_UUID, CHAR_IMAGE_UUID);
    } catch {}
    try {
      await BleClient.stopNotifications(deviceId, FALL_DETECT_SERVICE_UUID, CHAR_STATUS_UUID);
    } catch {}
  };
}

// 向设备发送控制命令
export async function sendControlCommand(deviceId: string, command: string): Promise<void> {
  if (!isCapacitorPlatform()) {
    throw new Error('此函数仅在 Capacitor 原生环境中可用');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(command);
  await BleClient.write(deviceId, FALL_DETECT_SERVICE_UUID, CHAR_CONTROL_UUID, data);
}

// 请求设备发送当前图片
export async function requestImage(deviceId: string): Promise<void> {
  await sendControlCommand(deviceId, 'GET_IMAGE');
}

// ArrayBuffer 转 Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
