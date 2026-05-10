import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import {
  checkBluetoothSupport,
  connectFallDetectDevice,
  disconnectBle,
  enableBluetooth,
  initializeBle,
  isBluetoothEnabled,
  listenForImageNotifications,
  requestImage,
  scanAndConnectBle,
  stopBleScan,
} from '@/lib/bluetooth';
import type { CozeTestResult } from '@/lib/coze';
import { runCozeWorkflow } from '@/lib/coze';
import { wsClient } from '@/lib/websocket';
import type { AlertRecord, ApiConfig, DeviceSettings, FallDetectDevice } from '@/types';

interface AlertContextType {
  alerts: AlertRecord[];
  currentAlert: AlertRecord | null;
  device: DeviceSettings | null;
  apiConfig: ApiConfig | null;
  isEmergency: boolean;
  isConnected: boolean;
  isScanning: boolean;
  showEmergency: boolean;
  bleImageAlert: string | null;
  discoveredDevices: FallDetectDevice[];
  isScanningDevices: boolean;
  // WebSocket
  wsConnected: boolean;
  connectWs: (ip: string, port: number) => Promise<void>;
  disconnectWs: () => void;
  getSavedWsAddress: () => { ip: string; port: number } | null;
  // 原有方法
  loadAlerts: () => Promise<void>;
  loadDevice: () => Promise<void>;
  loadApiConfig: () => Promise<void>;
  connectDevice: () => Promise<void>;
  disconnectDevice: () => Promise<void>;
  connectFallDetect: (deviceId: string, deviceName: string) => Promise<void>;
  scanFallDetectDevices: () => Promise<void>;
  stopScanDevices: () => Promise<void>;
  requestDeviceImage: () => Promise<void>;
  saveApiConfig: (cfg: { token: string; workflow_id: string; base_url: string }) => Promise<void>;
  testApi: (imageUrl: string, paramName?: string) => Promise<CozeTestResult>;
  dismissEmergency: () => void;
  dismissBleImage: () => void;
  simulateAlert: () => Promise<void>;
  simulateFullAlert: (imageUrl: string, paramName?: string, onStepChange?: (step: number) => void) => Promise<void>;
  deleteAlert: (id: string) => Promise<void>;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [currentAlert, setCurrentAlert] = useState<AlertRecord | null>(null);
  const [device, setDevice] = useState<DeviceSettings | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [isEmergency, setIsEmergency] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [bleImageAlert, setBleImageAlert] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<FallDetectDevice[]>([]);
  const [isScanningDevices, setIsScanningDevices] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const cleanupNotificationsRef = useRef<(() => void) | null>(null);
  const vibrationRef = useRef<number | null>(null);
  const handleFallImageRef = useRef<((imageBase64: string) => void) | null>(null);
  const currentAlertIdRef = useRef<string | null>(null);

  const triggerVibration = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      const pattern = [500, 200, 500, 200, 500, 200, 1000];
      navigator.vibrate(pattern);
      const interval = window.setInterval(() => {
        navigator.vibrate(pattern);
      }, 3000);
      vibrationRef.current = interval;
    }
  }, []);

  const stopVibration = useCallback(() => {
    if (vibrationRef.current) {
      clearInterval(vibrationRef.current);
      vibrationRef.current = null;
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(0);
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    const { data, error } = await supabase
      .from('alert_records')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('加载警报记录失败:', error);
      return;
    }
    setAlerts(Array.isArray(data) ? data : []);
  }, []);

  const loadDevice = useCallback(async () => {
    const { data, error } = await supabase
      .from('device_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('加载设备设置失败:', error);
      return;
    }
    if (data) {
      setDevice(data);
      setIsConnected(data.is_connected);
    }
  }, []);

  const loadApiConfig = useCallback(async () => {
    const { data, error } = await supabase
      .from('api_config')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('加载API配置失败:', error);
      return;
    }
    if (data) {
      setApiConfig(data);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
    loadDevice();
    loadApiConfig();

    // 初始化 BLE（仅在 Capacitor 原生环境）
    const initBle = async () => {
      const check = checkBluetoothSupport();
      if (check.isCapacitor) {
        try {
          await initializeBle();
          console.log('BLE 初始化成功');
        } catch (err) {
          console.error('BLE 初始化失败:', err);
        }
      }
    };
    initBle();

    // 初始化 WebSocket 监听
    wsClient.onAlert((alert) => {
      if (alert.test) {
        toast.info('收到测试告警图片');
      }
      // 走完整检测流程：疑似→Coze确认→紧急/降级
      if (handleFallImageRef.current) {
        handleFallImageRef.current(alert.image);
      }
    });
    wsClient.onStatusChange((connected) => {
      setWsConnected(connected);
    });
  }, [loadAlerts, loadDevice, loadApiConfig, triggerVibration]);

  // Keep ref in sync with currentAlert
  currentAlertIdRef.current = currentAlert?.id ?? null;

  useEffect(() => {
    const channel = supabase
      .channel('alert-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alert_records' },
        (payload) => {
          const newAlert = payload.new as AlertRecord;
          setAlerts((prev) => [newAlert, ...prev]);
          setCurrentAlert(newAlert);
          if (newAlert.status === 'emergency') {
            setIsEmergency(true);
            setShowEmergency(true);
            triggerVibration();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'alert_records' },
        (payload) => {
          const updated = payload.new as AlertRecord;
          setAlerts((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a))
          );
          if (currentAlertIdRef.current === updated.id) {
            setCurrentAlert(updated);
          }
          if (updated.status === 'emergency') {
            setIsEmergency(true);
            setShowEmergency(true);
            triggerVibration();
          }
        }
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [triggerVibration]);

  const connectDevice = useCallback(async () => {
    setIsScanning(true);
    try {
      // 先检测环境兼容性
      const check = checkBluetoothSupport();
      if (!check.supported) {
        toast.error(check.message);
        return;
      }

      let deviceId = '';
      let deviceName = '边缘设备';

      if (check.isCapacitor) {
        // Capacitor 原生环境：使用 BLE 插件
        try {
          // 先检查蓝牙是否启用
          const enabled = await isBluetoothEnabled();
          if (!enabled) {
            toast.info('正在启用蓝牙...');
            await enableBluetooth();
          }

          const bleDevice = await scanAndConnectBle();
          if (bleDevice) {
            deviceId = bleDevice.deviceId;
            deviceName = bleDevice.name || '边缘设备';
          } else {
            toast.error('未找到蓝牙设备');
            return;
          }
        } catch (err: any) {
          if (err?.message?.includes('cancelled') || err?.message?.includes('cancel')) {
            toast.info('已取消蓝牙搜索');
          } else {
            toast.error(`蓝牙连接失败: ${err?.message || '请重试'}`);
          }
          return;
        }
      } else {
        // Web 环境：使用 Web Bluetooth API
        const btDevice = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
        });
        if (btDevice) {
          deviceId = btDevice.id;
          deviceName = btDevice.name || '边缘设备';
        } else {
          return;
        }
      }

      // 保存设备信息到数据库
      if (deviceId && device?.id) {
        await supabase
          .from('device_settings')
          .update({
            device_id: deviceId,
            device_name: deviceName,
            is_connected: true,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', device.id);
        setIsConnected(true);
        toast.success('蓝牙设备已连接');
        await loadDevice();
      } else if (deviceId && !device?.id) {
        // 如果没有现有设备记录，创建一个新记录
        const { error: insertError } = await supabase
          .from('device_settings')
          .insert({
            device_id: deviceId,
            device_name: deviceName,
            is_connected: true,
            connected_at: new Date().toISOString(),
          });
        if (!insertError) {
          setIsConnected(true);
          toast.success('蓝牙设备已连接');
          await loadDevice();
        }
      }
    } catch (err: any) {
      console.error('连接设备失败:', err);
      if (err?.name === 'NotFoundError') {
        toast.error('未找到蓝牙设备，请确保边缘设备已开启蓝牙并处于可发现状态');
      } else if (err?.name === 'SecurityError') {
        toast.error('蓝牙权限被拒绝，请在弹窗中点击「允许」以授权访问');
      } else if (err?.name === 'AbortError') {
        toast.info('已取消蓝牙搜索');
      } else {
        toast.error('连接设备失败，请重试');
      }
    } finally {
      setIsScanning(false);
    }
  }, [device, loadDevice]);

  const disconnectDevice = useCallback(async () => {
    if (device?.id) {
      // 如果在 Capacitor 环境中，先断开 BLE 连接
      if (device.device_id) {
        const check = checkBluetoothSupport();
        if (check.isCapacitor) {
          try {
            await disconnectBle(device.device_id);
          } catch (err) {
            console.error('断开 BLE 连接失败:', err);
          }
        }
      }

      await supabase
        .from('device_settings')
        .update({
          is_connected: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', device.id);
      setIsConnected(false);
      setBleImageAlert(null);
      toast.success('设备已断开连接');
      await loadDevice();
    }
  }, [device, loadDevice]);

  const saveApiConfig = useCallback(async (cfg: { token: string; workflow_id: string; base_url: string }) => {
    if (apiConfig?.id) {
      await supabase
        .from('api_config')
        .update({
          token: cfg.token,
          workflow_id: cfg.workflow_id,
          base_url: cfg.base_url,
          updated_at: new Date().toISOString(),
        })
        .eq('id', apiConfig.id);
    } else {
      await supabase.from('api_config').insert({
        token: cfg.token,
        workflow_id: cfg.workflow_id,
        base_url: cfg.base_url,
      });
    }
    toast.success('API配置已保存');
    await loadApiConfig();
  }, [apiConfig, loadApiConfig]);

  const testApi = useCallback(async (imageUrl: string, paramName = 'image'): Promise<CozeTestResult> => {
    if (!apiConfig || !apiConfig.token || !apiConfig.workflow_id) {
      return { success: false, error: 'API配置不完整' };
    }
    return runCozeWorkflow(apiConfig, imageUrl, paramName);
  }, [apiConfig]);

  const dismissEmergency = useCallback(() => {
    setShowEmergency(false);
    stopVibration();
  }, [stopVibration]);

  const dismissBleImage = useCallback(() => {
    setBleImageAlert(null);
  }, []);

  const scanFallDetectDevicesFn = useCallback(async () => {
    const check = checkBluetoothSupport();
    if (!check.supported) {
      toast.error(check.message);
      return;
    }

    setIsScanningDevices(true);
    setDiscoveredDevices([]);

    try {
      if (check.isCapacitor) {
        const enabled = await isBluetoothEnabled();
        if (!enabled) {
          await enableBluetooth();
        }
      }

      const { scanFallDetectDevices: scanFn } = await import('@/lib/bluetooth');
      await scanFn((device) => {
        setDiscoveredDevices((prev) => {
          if (prev.some((d) => d.deviceId === device.deviceId)) return prev;
          return [...prev, device];
        });
      }, 8000);

      setTimeout(() => {
        setIsScanningDevices(false);
      }, 8500);
    } catch (err: any) {
      console.error('扫描失败:', err);
      toast.error(`扫描失败: ${err?.message || '请重试'}`);
      setIsScanningDevices(false);
    }
  }, []);

  const stopScanDevicesFn = useCallback(async () => {
    try {
      await stopBleScan();
    } catch {}
    setIsScanningDevices(false);
  }, []);

  const connectFallDetectFn = useCallback(async (deviceId: string, deviceName: string) => {
    try {
      await connectFallDetectDevice(deviceId, (id) => {
        console.log('跌倒检测设备断开:', id);
        setIsConnected(false);
        setBleImageAlert(null);
        toast.warning('跌倒检测设备已断开');
      });

      // 开始监听图片通知
      const cleanup = await listenForImageNotifications(
        deviceId,
        (imageBase64) => {
          // 收到跌倒图片 → 走完整检测流程
          setBleImageAlert(`data:image/jpeg;base64,${imageBase64}`);
          if (handleFallImageRef.current) {
            handleFallImageRef.current(imageBase64);
          }
        },
        (status) => {
          if (status === 'FALL_ALERT') {
            toast.warning('设备检测到疑似跌倒...');
          }
        },
      );

      cleanupNotificationsRef.current = cleanup;

      // 保存设备信息
      if (device?.id) {
        await supabase
          .from('device_settings')
          .update({
            device_id: deviceId,
            device_name: deviceName,
            is_connected: true,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', device.id);
      } else {
        await supabase.from('device_settings').insert({
          device_id: deviceId,
          device_name: deviceName,
          is_connected: true,
          connected_at: new Date().toISOString(),
        });
      }

      setIsConnected(true);
      toast.success(`已连接到 ${deviceName}`);
      await loadDevice();
    } catch (err: any) {
      console.error('连接失败:', err);
      toast.error(`连接失败: ${err?.message || '请重试'}`);
    }
  }, [device, loadDevice]);

  const requestDeviceImageFn = useCallback(async () => {
    if (!device?.device_id) {
      toast.error('未连接设备');
      return;
    }
    try {
      await requestImage(device.device_id);
      toast.info('已请求设备发送图片');
    } catch (err: any) {
      toast.error(`请求失败: ${err?.message || '请重试'}`);
    }
  }, [device]);

  const connectWs = useCallback(async (ip: string, port: number) => {
    const url = `ws://${ip}:${port}`;
    try {
      await wsClient.connect(url);
      setWsConnected(true);
      // 保存 IP/端口到 localStorage
      try {
        localStorage.setItem('ws_address', JSON.stringify({ ip, port }));
      } catch {}
      toast.success(`已连接到 ${ip}:${port}`);
    } catch (err: any) {
      setWsConnected(false);
      toast.error(`连接失败: ${err?.message || '请检查 IP 和端口'}`);
      throw err;
    }
  }, []);

  const disconnectWs = useCallback(() => {
    wsClient.disconnect();
    setWsConnected(false);
    toast.success('已断开 WebSocket 连接');
  }, []);

  const getSavedWsAddress = useCallback((): { ip: string; port: number } | null => {
    try {
      const saved = localStorage.getItem('ws_address');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  }, []);

  // Use refs for state that handleFallImage needs, to avoid TDZ issues
  const apiConfigRef = useRef(apiConfig);
  apiConfigRef.current = apiConfig;
  const triggerVibrationRef = useRef(triggerVibration);
  triggerVibrationRef.current = triggerVibration;

  // Define handleFallImage as a regular function stored in a ref
  handleFallImageRef.current = async (imageBase64: string) => {
    const imgSrc = `data:image/jpeg;base64,${imageBase64}`;

    const { data, error } = await supabase
      .from('alert_records')
      .insert({
        status: 'suspected',
        location: '设备检测',
        posture: '疑似跌倒',
        image_url: imgSrc,
      })
      .select()
      .single();
    if (error) {
      console.error('创建警报失败:', error);
      toast.error('创建警报失败');
      return;
    }
    setCurrentAlert(data);
    toast.info('接收到疑似跌倒画面，正在分析...');

    // Upload image to Supabase Storage
    let imageUrl: string | null = null;
    try {
      const byteChars = atob(imageBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      const fileName = `fall_${Date.now()}.jpg`;
      const { data: upData, error: upErr } = await supabase.storage
        .from('fall-detection-images')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
      if (!upErr && upData) {
        const { data: urlData } = supabase.storage.from('fall-detection-images').getPublicUrl(upData.path);
        imageUrl = urlData.publicUrl;
      }
    } catch (err) {
      console.error('图片上传异常:', err);
    }

    if (imageUrl) {
      await supabase.from('alert_records').update({ image_url: imageUrl }).eq('id', data.id);
    }

    // Call Coze API
    const cfg = apiConfigRef.current;
    const hasCoze = cfg && cfg.token.trim().length > 0 && cfg.workflow_id.trim().length > 0;
    if (hasCoze) {
      toast.info('正在调用Coze模型分析图片...');
      const result = await runCozeWorkflow(cfg, imageUrl || imgSrc, 'image');
      if (result.success && result.confirmed) {
        const updatedEmergency = { ...data, status: 'emergency' as const, confirmed_at: new Date().toISOString(), api_confirmed: true, posture: result.posture || '确认跌倒' };
        await supabase.from('alert_records').update({
          status: 'emergency',
          confirmed_at: updatedEmergency.confirmed_at,
          api_confirmed: true,
          posture: updatedEmergency.posture,
        }).eq('id', data.id);
        setCurrentAlert(updatedEmergency);
        setIsEmergency(true);
        setShowEmergency(true);
        triggerVibrationRef.current();
        toast.error('模型确认：跌倒属实，已触发紧急预警');
      } else if (result.success && !result.confirmed) {
        const updatedNormal = { ...data, status: 'normal' as const, confirmed_at: new Date().toISOString(), api_confirmed: true, posture: result.posture || '未确认跌倒' };
        await supabase.from('alert_records').update({
          status: 'normal',
          confirmed_at: updatedNormal.confirmed_at,
          api_confirmed: true,
          posture: updatedNormal.posture,
        }).eq('id', data.id);
        setCurrentAlert(updatedNormal);
        toast.info('模型判定：非跌倒情况，已降级为一般状态');
      } else {
        toast.error(`API调用失败: ${result.error}`);
      }
    } else {
      toast.warning('未配置Coze API，保持疑似状态');
    }
  };

  const deleteAlert = useCallback(async (id: string) => {
    const { error } = await supabase.from('alert_records').delete().eq('id', id);
    if (error) {
      console.error('删除警报失败:', error);
      toast.error('删除失败');
      return;
    }
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    if (currentAlert?.id === id) setCurrentAlert(null);
    toast.success('已删除');
  }, [currentAlert?.id]);

  const simulateAlert = useCallback(async () => {
    const hasCoze = apiConfig && apiConfig.token.trim().length > 0 && apiConfig.workflow_id.trim().length > 0;
    const { data, error } = await supabase
      .from('alert_records')
      .insert({
        status: 'suspected',
        location: '客厅',
        posture: '摔倒姿态',
        image_url: null,
      })
      .select()
      .single();
    if (error) {
      console.error('创建警报失败:', error);
      toast.error('创建警报失败');
      return;
    }
    setCurrentAlert(data);
    toast.info('接收到疑似跌倒画面');

    if (hasCoze) {
      toast.info('正在调用Coze模型确认...');
      const result = await runCozeWorkflow(apiConfig, '');
      if (result.success && result.confirmed) {
        const { error: upErr } = await supabase
          .from('alert_records')
          .update({
            status: 'emergency',
            confirmed_at: new Date().toISOString(),
            api_confirmed: true,
            posture: result.posture || '确认跌倒',
          })
          .eq('id', data.id);
        if (!upErr) {
          setIsEmergency(true);
          setShowEmergency(true);
          triggerVibration();
        }
      } else if (!result.success) {
        toast.error(`API调用失败: ${result.error}`);
      } else {
        toast.info('模型判定未确认跌倒，保持疑似状态');
      }
    } else {
      toast.warning('未配置Coze API，无法进一步确认');
    }
  }, [apiConfig, triggerVibration]);

  const simulateFullAlert = useCallback(async (imageUrl: string, paramName = 'image', onStepChange?: (step: number) => void) => {
    const setStep = (step: number) => {
      if (onStepChange) onStepChange(step);
    };

    // 1. 模拟连接设备
    setStep(1);
    if (!isConnected) {
      if (device?.id) {
        await supabase
          .from('device_settings')
          .update({
            is_connected: true,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', device.id);
      }
      setIsConnected(true);
      toast.success('模拟设备已连接');
    }

    // 2. 创建疑似警报
    setStep(2);
    const { data, error } = await supabase
      .from('alert_records')
      .insert({
        status: 'suspected',
        location: '客厅',
        posture: '摔倒姿态',
        image_url: imageUrl,
      })
      .select()
      .single();
    if (error) {
      console.error('创建警报失败:', error);
      toast.error('创建警报失败');
      return;
    }
    setCurrentAlert(data);
    toast.info('接收到疑似跌倒画面');

    // 3. 调用Coze API确认
    setStep(3);
    const hasCoze = apiConfig && apiConfig.token.trim().length > 0 && apiConfig.workflow_id.trim().length > 0;
    if (hasCoze) {
      toast.info('正在调用Coze模型分析图片...');
      const result = await runCozeWorkflow(apiConfig, imageUrl, paramName);
      if (result.success && result.confirmed) {
        const { error: upErr } = await supabase
          .from('alert_records')
          .update({
            status: 'emergency',
            confirmed_at: new Date().toISOString(),
            api_confirmed: true,
            posture: result.posture || '确认跌倒',
          })
          .eq('id', data.id);
        if (!upErr) {
          setIsEmergency(true);
          setShowEmergency(true);
          triggerVibration();
          toast.success('模型确认：跌倒属实，已触发紧急预警');
        }
      } else if (!result.success) {
        toast.error(`API调用失败: ${result.error}`);
      } else {
        toast.info('模型判定未确认跌倒，保持疑似状态');
      }
    } else {
      toast.warning('未配置Coze API，跳过图片分析');
    }

    // 4. 完成
    setStep(4);
  }, [apiConfig, device, isConnected, triggerVibration]);

  const value: AlertContextType = {
    alerts,
    currentAlert,
    device,
    apiConfig,
    isEmergency,
    isConnected,
    isScanning,
    showEmergency,
    bleImageAlert,
    discoveredDevices,
    isScanningDevices,
    wsConnected,
    connectWs,
    disconnectWs,
    getSavedWsAddress,
    loadAlerts,
    loadDevice,
    loadApiConfig,
    connectDevice,
    disconnectDevice,
    connectFallDetect: connectFallDetectFn,
    scanFallDetectDevices: scanFallDetectDevicesFn,
    stopScanDevices: stopScanDevicesFn,
    requestDeviceImage: requestDeviceImageFn,
    saveApiConfig,
    testApi,
    dismissEmergency,
    dismissBleImage,
    simulateAlert,
    simulateFullAlert,
    deleteAlert,
  };

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
};

export const useAlert = () => {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlert must be used within AlertProvider');
  return ctx;
};
