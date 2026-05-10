import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bluetooth,
  BluetoothOff,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Edit2,
  Eye,
  EyeOff,
  Home,
  Image as ImageIcon,
  Link2,
  MapPin,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Signal,
  Trash2,
  Upload,
  User,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/db/supabase';
import { checkBluetoothSupport } from '@/lib/bluetooth';
import type { AlertRecord } from '@/types';

const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('monitor');
  const [selectedAlert, setSelectedAlert] = useState<AlertRecord | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [apiToken, setApiToken] = useState('');
  const [apiWorkflowId, setApiWorkflowId] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.coze.cn');
  const [apiSaved, setApiSaved] = useState(false);
  const [testImage, setTestImage] = useState<string | null>(null);
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testImageUrl, setTestImageUrl] = useState<string | null>(null);
  const [testUploading, setTestUploading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    confirmed?: boolean;
    posture?: string;
    raw?: string;
    allEvents?: string;
    error?: string;
  } | null>(null);
  const [workflowParamName, setWorkflowParamName] = useState('image');
  const [showToken, setShowToken] = useState(false);

  // 模拟演示状态
  const [simulateImage, setSimulateImage] = useState<string | null>(null);
  const [simulateImageUrl, setSimulateImageUrl] = useState<string | null>(null);
  const [simulateUploading, setSimulateUploading] = useState(false);
  const [simulateRunning, setSimulateRunning] = useState(false);
  const [simulateStep, setSimulateStep] = useState(0);
  const [simulateParamName, setSimulateParamName] = useState('image');
  const [showDeviceListDialog, setShowDeviceListDialog] = useState(false);
  const [selectedScanDevice, setSelectedScanDevice] = useState<string | null>(null);
  const [wsIp, setWsIp] = useState('');
  const [wsPort, setWsPort] = useState('8765');
  const [wsConnecting, setWsConnecting] = useState(false);
  const [deviceTab, setDeviceTab] = useState('ble');
  const [simulatePanelOpen, setSimulatePanelOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  const [btCheck, setBtCheck] = useState(checkBluetoothSupport());
  useEffect(() => {
    setBtCheck(checkBluetoothSupport());
  }, []);

  const {
    alerts,
    currentAlert,
    device,
    apiConfig,
    isEmergency,
    isConnected,
    isScanning,
    bleImageAlert,
    discoveredDevices,
    isScanningDevices,
    wsConnected,
    connectWs,
    disconnectWs,
    getSavedWsAddress,
    connectDevice,
    disconnectDevice,
    connectFallDetect,
    scanFallDetectDevices,
    stopScanDevices,
    requestDeviceImage,
    simulateAlert,
    simulateFullAlert,
    saveApiConfig,
    testApi,
    loadDevice,
    dismissBleImage,
    deleteAlert,
  } = useAlert();

  // Auto-fill saved WS address when opening device dialog
  useEffect(() => {
    if (showDeviceListDialog && deviceTab === 'ws') {
      const saved = getSavedWsAddress();
      if (saved) {
        if (!wsIp) setWsIp(saved.ip);
        if (!wsPort || wsPort === '8765') setWsPort(String(saved.port));
      }
    }
  }, [showDeviceListDialog, deviceTab, getSavedWsAddress]);

  const hasCoze =
    apiConfig &&
    apiConfig.token.trim().length > 0 &&
    apiConfig.workflow_id.trim().length > 0;

  React.useEffect(() => {
    if (apiConfig) {
      setApiToken(apiConfig.token);
      setApiWorkflowId(apiConfig.workflow_id);
      setApiBaseUrl(apiConfig.base_url || 'https://api.coze.cn');
    }
  }, [apiConfig]);

  const handleSaveApi = async () => {
    await saveApiConfig({
      token: apiToken.trim(),
      workflow_id: apiWorkflowId.trim(),
      base_url: apiBaseUrl.trim(),
    });
    setApiSaved(true);
    setTimeout(() => setApiSaved(false), 2000);
  };

  const handleSaveName = async () => {
    if (!device?.id || !editingName.trim()) return;
    await supabase
      .from('device_settings')
      .update({ device_name: editingName.trim(), updated_at: new Date().toISOString() })
      .eq('id', device.id);
    setIsEditing(false);
    toast.success('设备名称已更新');
    await loadDevice();
  };

  const handleDeleteDevice = async () => {
    if (!device?.id) return;
    await supabase
      .from('device_settings')
      .update({
        device_id: null,
        is_connected: false,
        connected_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', device.id);
    toast.success('设备已移除');
    await loadDevice();
  };

  const startEdit = () => {
    setEditingName(device?.device_name || '');
    setIsEditing(true);
  };

  const isApiValid =
    apiToken.trim().length > 0 &&
    apiWorkflowId.trim().length > 0 &&
    apiBaseUrl.trim().startsWith('http');

  const compressImage = (file: File, maxWidth = 1200, quality = 0.85): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('图片压缩失败'));
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败'));
      };
      img.src = url;
    });
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setTestFile(file);
    setTestResult(null);

    // 生成本地预览
    const reader = new FileReader();
    reader.onload = (ev) => {
      setTestImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    // 上传图片到 Supabase Storage，获取公开 URL
    setTestUploading(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `test_${Date.now()}_${safeName}.${ext}`;
    supabase.storage
      .from('fall-detection-images')
      .upload(fileName, file, {
        contentType: file.type || 'image/jpeg',
        cacheControl: '3600',
        upsert: true,
      })
      .then(({ data: upData, error: upErr }) => {
        if (upErr) {
          toast.error(`图片上传失败: ${upErr.message}`);
          setTestUploading(false);
          return;
        }
        const { data: urlData } = supabase.storage
          .from('fall-detection-images')
          .getPublicUrl(upData?.path || fileName);
        setTestImageUrl(urlData.publicUrl);
        toast.success('图片已上传');
        setTestUploading(false);
      })
      .catch(() => {
        toast.error('图片上传过程出错');
        setTestUploading(false);
      });
  };

  const handleTestApi = async () => {
    if (!testImageUrl) {
      toast.warning('请先上传测试图片并等待上传完成');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await testApi(testImageUrl, workflowParamName);
      setTestResult(result);
      if (result.success) {
        toast.success('API测试成功');
      } else {
        toast.error(`测试失败: ${result.error}`);
      }
    } catch {
      toast.error('测试过程出错');
    } finally {
      setTestLoading(false);
    }
  };

  const handleSimulateImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 本地预览
    const reader = new FileReader();
    reader.onload = (ev) => {
      setSimulateImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    // 上传图片到 Storage
    setSimulateUploading(true);
    try {
      const compressed = await compressImage(file, 1200, 0.85);
      const fileName = `sim_${Date.now()}.jpg`;
      const { data: upData, error: upErr } = await supabase.storage
        .from('fall-detection-images')
        .upload(fileName, compressed, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: true,
        });
      if (upErr) {
        toast.error(`图片上传失败: ${upErr.message}`);
        setSimulateUploading(false);
        return;
      }
      const { data: urlData } = supabase.storage
        .from('fall-detection-images')
        .getPublicUrl(upData?.path || fileName);
      setSimulateImageUrl(urlData.publicUrl);
      toast.success('模拟图片已上传');
      setSimulateUploading(false);
    } catch {
      toast.error('图片上传过程出错');
      setSimulateUploading(false);
    }
  };

  const handleRunSimulation = async () => {
    if (!simulateImageUrl) {
      toast.warning('请先上传模拟图片');
      return;
    }
    setSimulateRunning(true);
    setSimulateStep(1);
    try {
      await simulateFullAlert(simulateImageUrl, simulateParamName, (step) => {
        setSimulateStep(step);
      });
    } catch {
      toast.error('模拟流程出错');
    } finally {
      setSimulateRunning(false);
    }
  };

  const stepLabels = ['准备', '连接设备', '接收画面', '模型确认', '完成'];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">跌倒检测预警</h1>
            <p className="text-xs text-muted-foreground mt-0.5">实时监控 · 智能预警</p>
          </div>
          <div className="flex items-center gap-2">
            {wsConnected ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <Wifi className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">局域网已连接</span>
              </div>
            ) : isConnected ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <Bluetooth className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">蓝牙已连接</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                <BluetoothOff className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">未连接</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Main Content */}
      <div className="flex-1 p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-4 h-11 mb-4 bg-card border border-border rounded-lg p-1">
            <TabsTrigger
              value="monitor"
              className="flex items-center justify-center gap-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md"
            >
              <Home className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">监控</span>
            </TabsTrigger>
            <TabsTrigger
              value="records"
              className="flex items-center justify-center gap-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">记录</span>
            </TabsTrigger>
            <TabsTrigger
              value="device"
              className="flex items-center justify-center gap-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md"
            >
              <Bluetooth className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">设备</span>
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="flex items-center justify-center gap-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">设置</span>
            </TabsTrigger>
          </TabsList>

          {/* 监控页 */}
          <TabsContent value="monitor" className="space-y-4 mt-0">
            {isConnected && !hasCoze && (
              <div className="bg-warning/10 rounded-xl border border-warning/30 p-3 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-warning">未配置Coze API</p>
                  <p className="text-xs text-warning/80 mt-0.5">
                    请到设置页配置Coze工作流API，否则无法确认跌倒是否属实
                  </p>
                </div>
              </div>
            )}

            {currentAlert ? (
              <div
                className={`bg-card rounded-xl border-2 overflow-hidden ${
                  isEmergency ? 'border-destructive' : currentAlert.status === 'normal' ? 'border-emerald-300 dark:border-emerald-700' : 'border-warning'
                }`}
              >
                <div
                  className={`flex items-center gap-2 px-4 py-2 ${
                    isEmergency ? 'bg-destructive/10' : currentAlert.status === 'normal' ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-warning/10'
                  }`}
                >
                  {isEmergency ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-destructive" />
                      <span className="text-sm font-bold text-destructive">紧急情况</span>
                    </>
                  ) : currentAlert.status === 'normal' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="text-sm font-bold text-emerald-600">一般情况</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4 text-warning" />
                      <span className="text-sm font-bold text-warning">疑似情况</span>
                    </>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div className="text-xs text-muted-foreground">
                    {currentAlert.created_at
                      ? format(new Date(currentAlert.created_at), 'yyyy年MM月dd日 HH:mm:ss', {
                          locale: zhCN,
                        })
                      : ''}
                  </div>
                  {currentAlert.image_url ? (
                    <div className="aspect-[4/3] w-full rounded-lg overflow-hidden bg-muted">
                      <img
                        src={currentAlert.image_url}
                        alt="监控画面"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="aspect-[4/3] w-full rounded-lg bg-muted flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">暂无画面</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-muted rounded-lg p-2.5">
                      <span className="text-muted-foreground">位置</span>
                      <p className="font-medium text-foreground mt-0.5">{currentAlert.location}</p>
                    </div>
                    <div className="bg-muted rounded-lg p-2.5">
                      <span className="text-muted-foreground">姿态</span>
                      <p className="font-medium text-foreground mt-0.5">{currentAlert.posture}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-card rounded-xl border border-border p-6 text-center space-y-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-muted flex items-center justify-center">
                  <Activity className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">暂无警报</p>
                  <p className="text-xs text-muted-foreground mt-1">系统运行正常，未检测到异常</p>
                </div>
              </div>
            )}

            {/* 统一连接状态卡片 */}
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {wsConnected ? (
                    <Wifi className="w-4 h-4 text-emerald-600" />
                  ) : isConnected ? (
                    <Bluetooth className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Radio className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {wsConnected ? '局域网已连接' : isConnected ? '蓝牙已连接' : '设备未连接'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isConnected && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={requestDeviceImage}
                      className="h-8 text-xs"
                    >
                      <ImageIcon className="w-3.5 h-3.5 mr-1" />
                      请求图片
                    </Button>
                  )}
                  {wsConnected && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={disconnectWs}
                      className="h-8 text-xs"
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      断开
                    </Button>
                  )}
                </div>
              </div>
              {wsConnected ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-emerald-600">局域网推送通道就绪，等待跌倒告警...</span>
                </div>
              ) : isConnected ? (
                <p className="text-xs text-muted-foreground">
                  设备: {device?.device_name || '已连接'} · 蓝牙通道就绪
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  请到设备页连接边缘设备（蓝牙或局域网）
                </p>
              )}
            </div>

            {/* BLE 实时图片告警 */}
            {bleImageAlert && isConnected && (
              <div className="bg-card rounded-xl border-2 border-destructive overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-destructive/10">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                    <span className="text-sm font-bold text-destructive">BLE 跌倒检测图片</span>
                  </div>
                  <button
                    onClick={dismissBleImage}
                    className="p-1 rounded-md hover:bg-destructive/20"
                  >
                    <X className="w-4 h-4 text-destructive" />
                  </button>
                </div>
                <div className="p-4">
                  <div className="aspect-[4/3] w-full rounded-lg overflow-hidden bg-muted">
                    <img
                      src={bleImageAlert}
                      alt="跌倒检测图片"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {format(new Date(), 'yyyy年MM月dd日 HH:mm:ss', { locale: zhCN })}
                  </p>
                </div>
              </div>
            )}

            {!isConnected && !wsConnected && (
              <div className="bg-card rounded-xl border border-border p-4 text-center space-y-3">
                <BluetoothOff className="w-10 h-10 mx-auto text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">设备未连接</p>
                  <p className="text-xs text-muted-foreground mt-1">请切换到设备页连接边缘设备</p>
                </div>
              </div>
            )}

            {/* 模拟演示面板 */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                onClick={() => setSimulatePanelOpen(!simulatePanelOpen)}
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">模拟演示</h3>
                  {!simulatePanelOpen && (
                    <span className="text-xs text-muted-foreground">连接设备 → 接收图片 → 模型确认 → 触发预警</span>
                  )}
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${simulatePanelOpen ? 'rotate-180' : ''}`} />
              </button>
              {simulatePanelOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">

              {/* 步骤指示器 */}
              <div className="flex items-center gap-1">
                {stepLabels.slice(1).map((label, idx) => {
                  const stepNum = idx + 1;
                  const isActive = simulateStep >= stepNum;
                  const isCurrent = simulateStep === stepNum && simulateRunning;
                  return (
                    <React.Fragment key={label}>
                      <div
                        className={`flex-1 h-1.5 rounded-full transition-colors ${
                          isActive ? 'bg-primary' : 'bg-muted'
                        } ${isCurrent ? 'animate-pulse' : ''}`}
                        title={label}
                      />
                      {idx < stepLabels.length - 2 && (
                        <div className="w-1 h-1 rounded-full bg-muted" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                {stepLabels.slice(1).map((label, idx) => {
                  const stepNum = idx + 1;
                  const isActive = simulateStep >= stepNum;
                  return (
                    <span key={label} className={isActive ? 'text-primary font-medium' : ''}>
                      {label}
                    </span>
                  );
                })}
              </div>

              {/* 图片上传 */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">选择模拟图片</label>
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    id="simulate-image"
                    className="hidden"
                    onChange={handleSimulateImageSelect}
                  />
                  <label
                    htmlFor="simulate-image"
                    className="flex flex-col items-center justify-center gap-2 w-full h-32 rounded-lg border-2 border-dashed border-border bg-muted cursor-pointer active:opacity-70 transition-opacity overflow-hidden"
                  >
                    {simulateImage ? (
                      <img
                        src={simulateImage}
                        alt="模拟图片预览"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">点击选择图片</span>
                      </>
                    )}
                  </label>
                </div>
                {simulateUploading && (
                  <p className="text-xs text-muted-foreground">图片上传中...</p>
                )}
              </div>

              {/* 工作流参数名 */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">工作流输入参数名</label>
                <Input
                  value={simulateParamName}
                  onChange={(e) => setSimulateParamName(e.target.value)}
                  placeholder="例如: image"
                  className="h-9 text-sm"
                />
              </div>

              {/* 运行按钮 */}
              <Button
                onClick={handleRunSimulation}
                disabled={!simulateImageUrl || simulateRunning}
                className="w-full h-10 bg-primary text-primary-foreground rounded-lg font-medium text-sm active:opacity-70 disabled:opacity-50"
              >
                {simulateRunning ? (
                  <>
                    <Activity className="w-4 h-4 mr-1.5 animate-spin" />
                    模拟运行中...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-1.5" />
                    运行完整模拟
                  </>
                )}
              </Button>

              <p className="text-[10px] text-muted-foreground">
                模拟流程：连接设备 → 接收图片 → 调用Coze API → 触发预警
              </p>
              </div>
              )}
            </div>
          </TabsContent>

          {/* 记录页 */}
          <TabsContent value="records" className="space-y-3 mt-0">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-foreground">警报记录</h2>
              <span className="text-xs text-muted-foreground">共 {alerts.length} 条</span>
            </div>
            {alerts.length === 0 ? (
              <div className="bg-card rounded-xl border border-border p-8 text-center">
                <Activity className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-3">暂无警报记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="bg-card rounded-xl border border-border overflow-hidden"
                  >
                    <button
                      onClick={() => setSelectedAlert(alert)}
                      className="w-full text-left p-4 active:opacity-70 transition-opacity"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2">
                            {alert.status === 'emergency' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium">
                                <AlertTriangle className="w-3 h-3" />
                                紧急
                              </span>
                            ) : alert.status === 'normal' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-medium">
                                <CheckCircle2 className="w-3 h-3" />
                                一般
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-medium">
                                <Activity className="w-3 h-3" />
                                疑似
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {alert.created_at
                                ? format(new Date(alert.created_at), 'MM-dd HH:mm', { locale: zhCN })
                                : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-foreground">
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="truncate">{alert.location}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <User className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="truncate">{alert.posture}</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                      </div>
                      {alert.image_url && (
                        <div className="mt-3 aspect-[16/9] w-full rounded-lg overflow-hidden bg-muted">
                          <img
                            src={alert.image_url}
                            alt="监控画面"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                    </button>
                    <div className="border-t border-border px-4 py-2 flex justify-end">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await deleteAlert(alert.id);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* 设备页 */}
          <TabsContent value="device" className="space-y-4 mt-0">
            {/* 当前连接方式 */}
            {(isConnected || wsConnected) && (
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    {wsConnected ? <Wifi className="w-5 h-5" /> : <Bluetooth className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {wsConnected ? '局域网连接' : '蓝牙连接'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {wsConnected
                        ? '通过 WiFi 局域网接收检测数据'
                        : `设备: ${device?.device_name || '已连接'}`}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs text-emerald-600">已连接</span>
                  </div>
                </div>
              </div>
            )}

            {/* 已连接设备卡片 */}
            {device?.device_id || device?.is_connected ? (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          isConnected
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {isConnected ? (
                          <Bluetooth className="w-6 h-6" />
                        ) : (
                          <BluetoothOff className="w-6 h-6" />
                        )}
                      </div>
                      <div className="min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="h-8 text-sm w-40"
                              autoFocus
                            />
                            <button
                              onClick={handleSaveName}
                              className="p-1 rounded-md hover:bg-muted active:opacity-70"
                            >
                              <Save className="w-4 h-4 text-emerald-600" />
                            </button>
                            <button
                              onClick={() => setIsEditing(false)}
                              className="p-1 rounded-md hover:bg-muted active:opacity-70"
                            >
                              <X className="w-4 h-4 text-muted-foreground" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-foreground truncate">
                              {device.device_name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {isConnected ? (
                                <>
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  <span className="text-xs text-emerald-600">已连接</span>
                                </>
                              ) : (
                                <>
                                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">未连接</span>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {!isEditing && (
                      <button
                        onClick={startEdit}
                        className="p-2 rounded-md hover:bg-muted active:opacity-70"
                      >
                        <Edit2 className="w-4 h-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>

                  {device?.device_id && (
                    <div className="bg-muted rounded-lg p-2.5">
                      <p className="text-[10px] text-muted-foreground">设备 ID</p>
                      <p className="text-xs font-mono text-foreground mt-0.5 truncate">
                        {device.device_id}
                      </p>
                    </div>
                  )}
                </div>

                <div className="border-t border-border p-3 flex gap-2">
                  {isConnected ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={disconnectDevice}
                        className="flex-1 h-9 border-border rounded-lg text-xs"
                      >
                        <BluetoothOff className="w-3.5 h-3.5 mr-1" />
                        断开
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowDeviceListDialog(true)}
                        className="flex-1 h-9 border-border rounded-lg text-xs"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        更换
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => setShowDeviceListDialog(true)}
                      disabled={isScanning}
                      className="flex-1 h-9 bg-primary text-primary-foreground rounded-lg text-xs font-medium"
                    >
                      <Bluetooth className="w-3.5 h-3.5 mr-1" />
                      {isScanning ? '搜索中...' : '重新连接'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={handleDeleteDevice}
                    className="h-9 px-3 text-destructive rounded-lg text-xs hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              /* 未添加设备 - 空状态 */
              <div className="bg-card rounded-xl border border-border p-6 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Bluetooth className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">添加跌倒检测设备</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    通过蓝牙或局域网连接边缘设备以接收实时跌倒检测
                  </p>
                </div>
                <Button
                  onClick={() => setShowDeviceListDialog(true)}
                  disabled={isScanning}
                  className="w-full h-11 bg-primary text-primary-foreground rounded-lg font-medium text-sm"
                >
                  <Search className="w-4 h-4 mr-1.5" />
                  {isScanning ? '搜索中...' : '搜索设备'}
                </Button>
              </div>
            )}

            {/* 蓝牙兼容性提示 */}
            {!btCheck.supported && !btCheck.isCapacitor && (
              <div className="bg-warning/10 rounded-xl border border-warning/20 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-warning shrink-0" />
                  <p className="text-xs font-medium text-warning">蓝牙连接不可用</p>
                </div>
                <p className="text-xs text-muted-foreground pl-6">{btCheck.message}</p>
              </div>
            )}

            {/* 连接步骤引导 */}
            {btCheck.supported && !isConnected && !device?.device_id && (
              <div className="bg-card rounded-xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">连接步骤</h3>
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
                    <p className="text-xs text-muted-foreground">确保 Raspberry Pi 已开启并运行跌倒检测程序</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
                    <p className="text-xs text-muted-foreground">点击「搜索设备」，在列表中选择你的设备</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
                    <p className="text-xs text-muted-foreground">连接成功后，设备检测到跌倒会自动推送图片</p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-card rounded-xl border border-border p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">说明</h3>
              <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                <li>本应用仅支持连接一台边缘设备</li>
                <li>连接新设备前需断开当前设备</li>
                <li>设备检测到跌倒时会自动通过蓝牙推送图片</li>
                <li>首次连接需要授予蓝牙权限</li>
              </ul>
            </div>
          </TabsContent>

          {/* 设置页 */}
          <TabsContent value="settings" className="space-y-4 mt-0">
            {/* 使用引导按钮 */}
            <button
              onClick={() => { setOnboardingStep(0); setShowOnboarding(true); }}
              className="w-full bg-primary/10 rounded-xl border border-primary/20 p-4 flex items-center gap-3 active:opacity-70 transition-opacity"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground">使用引导</p>
                <p className="text-xs text-muted-foreground mt-0.5">首次使用？按步骤配置 API 和设备连接</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
            </button>

            <div className="bg-card rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Link2 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Coze工作流配置</h3>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Token (PAT)</label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={apiToken}
                      onChange={(e) => setApiToken(e.target.value)}
                      placeholder="pat_xxxxxxxxxxxxxxxx"
                      className="h-11 text-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Workflow ID</label>
                  <Input
                    value={apiWorkflowId}
                    onChange={(e) => setApiWorkflowId(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxx"
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Base URL</label>
                  <Input
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder="https://api.coze.cn"
                    className="h-11 text-sm"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  配置Coze工作流API参数，用于跌倒检测确认
                </p>
              </div>
              <Button
                onClick={handleSaveApi}
                disabled={!isApiValid}
                className="w-full h-11 bg-primary text-primary-foreground rounded-lg font-medium text-sm active:opacity-70 disabled:opacity-50"
              >
                {apiSaved ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                    已保存
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-1.5" />
                    保存配置
                  </>
                )}
              </Button>
            </div>

            <div className="bg-card rounded-xl border border-border p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-primary" />
                API测试
              </h3>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">工作流输入参数名</label>
                <Input
                  value={workflowParamName}
                  onChange={(e) => setWorkflowParamName(e.target.value)}
                  placeholder="例如: image / input_image / photo"
                  className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">必须与Coze工作流中配置的输入变量名一致</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">上传测试图片</label>
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="w-full h-24 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center bg-muted/50">
                    {testUploading ? (
                      <span className="text-xs text-muted-foreground">图片上传中...</span>
                    ) : testImage ? (
                      <img
                        src={testImage}
                        alt="测试图片"
                        className="h-20 w-auto object-contain rounded"
                      />
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-muted-foreground mb-1" />
                        <span className="text-xs text-muted-foreground">点击选择图片</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <Button
                onClick={handleTestApi}
                disabled={!isApiValid || !testImageUrl || testLoading || testUploading}
                className="w-full h-11 bg-primary text-primary-foreground rounded-lg font-medium text-sm active:opacity-70 disabled:opacity-50"
              >
                {testUploading ? '上传中...' : testLoading ? '测试中...' : '测试API'}
              </Button>

              {testResult && (
                <div className="bg-muted rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {testResult.success ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="text-xs font-medium text-emerald-600">测试成功</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-destructive" />
                        <span className="text-xs font-medium text-destructive">测试失败</span>
                      </>
                    )}
                  </div>
                  {testResult.success && (
                    <div className="text-xs space-y-1">
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">确认结果:</span>
                        <span className={testResult.confirmed ? 'text-destructive font-medium' : 'text-foreground'}>
                          {testResult.confirmed ? '确认跌倒' : '未确认跌倒'}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">姿态:</span>
                        <span className="text-foreground">{testResult.posture || '未知'}</span>
                      </div>
                    </div>
                  )}
                  {testResult.error && (
                    <p className="text-xs text-destructive">{testResult.error}</p>
                  )}
                  {testResult.raw && (
                    <details className="text-xs">
                      <summary className="text-muted-foreground cursor-pointer">查看原始响应</summary>
                      <pre className="mt-1 p-2 bg-background rounded text-muted-foreground whitespace-pre-wrap break-all">
                        {testResult.raw}
                      </pre>
                    </details>
                  )}
                  {testResult.allEvents && (
                    <details className="text-xs">
                      <summary className="text-muted-foreground cursor-pointer">查看完整事件流（调试）</summary>
                      <pre className="mt-1 p-2 bg-background rounded text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                        {testResult.allEvents}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>

            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">当前状态</h3>
              <div className="flex items-center gap-2">
                {hasCoze ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs text-emerald-600">Coze API已配置</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-warning" />
                    <span className="text-xs text-warning">尚未配置Coze API</span>
                  </>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      {/* Alert Detail Dialog */}
      <Dialog open={!!selectedAlert} onOpenChange={() => setSelectedAlert(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">警报详情</DialogTitle>
          </DialogHeader>
          {selectedAlert && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2">
                {selectedAlert.status === 'emergency' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-destructive/10 text-destructive text-sm font-medium">
                    <AlertTriangle className="w-4 h-4" />
                    紧急情况
                  </span>
                ) : selectedAlert.status === 'normal' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    一般情况
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warning/10 text-warning text-sm font-medium">
                    <Activity className="w-4 h-4" />
                    疑似情况
                  </span>
                )}
              </div>
              {selectedAlert.image_url && (
                <div className="aspect-video w-full rounded-lg overflow-hidden bg-muted">
                  <img
                    src={selectedAlert.image_url}
                    alt="监控画面"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="space-y-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">时间：</span>
                  <span className="text-foreground">
                    {selectedAlert.created_at
                      ? format(new Date(selectedAlert.created_at), 'yyyy年MM月dd日 HH:mm:ss', {
                          locale: zhCN,
                        })
                      : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">地点：</span>
                  <span className="text-foreground">{selectedAlert.location}</span>
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">确认姿态：</span>
                  <span className="text-foreground font-medium">
                    {selectedAlert.status === 'emergency' ? (
                      <span className="text-destructive">{selectedAlert.posture}</span>
                    ) : (
                      selectedAlert.posture
                    )}
                  </span>
                </div>
                {selectedAlert.confirmed_at && (
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">确认时间：</span>
                    <span className="text-foreground">
                      {format(new Date(selectedAlert.confirmed_at), 'yyyy年MM月dd日 HH:mm:ss', {
                        locale: zhCN,
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 设备列表 Dialog */}
      <Dialog open={showDeviceListDialog} onOpenChange={setShowDeviceListDialog}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" />
              连接跌倒检测设备
            </DialogTitle>
          </DialogHeader>

          <Tabs value={deviceTab} onValueChange={setDeviceTab} className="pt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="ble" className="text-xs">
                <Bluetooth className="w-3.5 h-3.5 mr-1" />
                蓝牙连接
              </TabsTrigger>
              <TabsTrigger value="ws" className="text-xs">
                <Wifi className="w-3.5 h-3.5 mr-1" />
                局域网连接
              </TabsTrigger>
            </TabsList>

            {/* 蓝牙 Tab */}
            <TabsContent value="ble" className="space-y-4 mt-4">
              <div className="flex gap-2">
                <Button
                  onClick={scanFallDetectDevices}
                  disabled={isScanningDevices}
                  className="flex-1 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
                >
                  {isScanningDevices ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                      扫描中...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 mr-1.5" />
                      开始扫描
                    </>
                  )}
                </Button>
                {isScanningDevices && (
                  <Button
                    variant="outline"
                    onClick={stopScanDevices}
                    className="h-10 border-border rounded-lg text-sm"
                  >
                    停止
                  </Button>
                )}
              </div>

              {isScanningDevices && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  正在搜索附近的跌倒检测设备...
                </div>
              )}

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {discoveredDevices.length === 0 && !isScanningDevices && (
                  <div className="text-center py-6">
                    <Bluetooth className="w-8 h-8 mx-auto text-muted-foreground" />
                    <p className="text-xs text-muted-foreground mt-2">
                      点击「开始扫描」搜索附近的设备
                    </p>
                  </div>
                )}

                {discoveredDevices.length === 0 && isScanningDevices && (
                  <div className="text-center py-6">
                    <RefreshCw className="w-8 h-8 mx-auto text-muted-foreground animate-spin" />
                    <p className="text-xs text-muted-foreground mt-2">
                      正在搜索，请确保设备已开启蓝牙...
                    </p>
                  </div>
                )}

                {discoveredDevices.map((dev) => (
                  <button
                    key={dev.deviceId}
                    onClick={() => setSelectedScanDevice(dev.deviceId)}
                    className={`w-full text-left rounded-xl border p-3 transition-all ${
                      selectedScanDevice === dev.deviceId
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          selectedScanDevice === dev.deviceId
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Bluetooth className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{dev.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{dev.deviceId}</p>
                      </div>
                      {selectedScanDevice === dev.deviceId && (
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <Button
                onClick={async () => {
                  if (!selectedScanDevice) {
                    toast.warning('请先选择一个设备');
                    return;
                  }
                  const dev = discoveredDevices.find((d) => d.deviceId === selectedScanDevice);
                  if (!dev) return;
                  setShowDeviceListDialog(false);
                  await connectFallDetect(dev.deviceId, dev.name);
                  setSelectedScanDevice(null);
                }}
                disabled={!selectedScanDevice}
                className="w-full h-10 bg-primary text-primary-foreground rounded-lg font-medium text-sm disabled:opacity-50"
              >
                <Bluetooth className="w-4 h-4 mr-1.5" />
                连接选中设备
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[10px]">
                  <span className="bg-background px-2 text-muted-foreground">或</span>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  setShowDeviceListDialog(false);
                  connectDevice();
                }}
                className="w-full h-10 border-border rounded-lg text-sm"
              >
                <Bluetooth className="w-4 h-4 mr-1.5" />
                使用系统蓝牙选择器
              </Button>
            </TabsContent>

            {/* 局域网 Tab */}
            <TabsContent value="ws" className="space-y-4 mt-4">
              {wsConnected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-emerald-600">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    已连接到局域网推送服务
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      disconnectWs();
                    }}
                    className="w-full h-10 border-border rounded-lg text-sm"
                  >
                    <X className="w-4 h-4 mr-1.5" />
                    断开连接
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">电脑 IP 地址</label>
                      <Input
                        placeholder="192.168.1.100"
                        value={wsIp}
                        onChange={(e) => setWsIp(e.target.value)}
                        className="h-10 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">端口号</label>
                      <Input
                        placeholder="8765"
                        value={wsPort}
                        onChange={(e) => setWsPort(e.target.value)}
                        className="h-10 text-sm"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    请确保手机和电脑连接到同一个 WiFi 网络。在电脑端运行 fall_detect_windows.py 后，
                    终端会显示局域网 WebSocket 地址 (如 ws://192.168.1.100:8765)，
                    将 IP 和端口填入上方即可。
                  </p>

                  <Button
                    onClick={async () => {
                      if (!wsIp.trim()) {
                        toast.warning('请输入电脑 IP 地址');
                        return;
                      }
                      const port = parseInt(wsPort) || 8765;
                      setWsConnecting(true);
                      try {
                        await connectWs(wsIp.trim(), port);
                        setShowDeviceListDialog(false);
                      } catch {
                        // error toast already shown in connectWs
                      } finally {
                        setWsConnecting(false);
                      }
                    }}
                    disabled={wsConnecting || !wsIp.trim()}
                    className="w-full h-11 bg-primary text-primary-foreground rounded-lg font-medium text-sm disabled:opacity-50"
                  >
                    {wsConnecting ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                        连接中...
                      </>
                    ) : (
                      <>
                        <Wifi className="w-4 h-4 mr-1.5" />
                        连接
                      </>
                    )}
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* 使用引导 Dialog */}
      <Dialog open={showOnboarding} onOpenChange={setShowOnboarding}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              使用引导
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* 步骤指示器 */}
            <div className="flex items-center gap-1">
              {['配置API', '连接设备', '测试验证'].map((label, idx) => (
                <React.Fragment key={label}>
                  <div className={`flex-1 text-center text-xs py-1.5 rounded-full ${
                    onboardingStep === idx ? 'bg-primary text-primary-foreground font-medium' :
                    onboardingStep > idx ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    {label}
                  </div>
                  {idx < 2 && <div className="w-2 h-0.5 bg-muted" />}
                </React.Fragment>
              ))}
            </div>

            {/* 步骤内容 */}
            {onboardingStep === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-foreground font-medium">第 1 步：配置 Coze 工作流 API</p>
                <div className="bg-muted rounded-lg p-3 space-y-2 text-xs text-muted-foreground">
                  <p>你需要准备以下信息：</p>
                  <ul className="list-disc list-inside space-y-1.5">
                    <li><strong>Token (PAT)</strong>：在 Coze 平台生成的个人访问令牌，以 <code>pat_</code> 开头</li>
                    <li><strong>Workflow ID</strong>：你的 Coze 工作流 ID，如 <code>xxxxxxxxxxxxxxxxxxxx</code></li>
                    <li><strong>Base URL</strong>：API 地址，国内用户使用 <code>https://api.coze.cn</code></li>
                  </ul>
                  <p className="mt-2">配置完成后，点击下方按钮跳转到设置页填写。</p>
                </div>
                <Button
                  onClick={() => { setShowOnboarding(false); setActiveTab('settings'); }}
                  className="w-full h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
                >
                  前往设置页配置
                </Button>
              </div>
            )}

            {onboardingStep === 1 && (
              <div className="space-y-3">
                <p className="text-sm text-foreground font-medium">第 2 步：连接边缘设备</p>
                <div className="bg-muted rounded-lg p-3 space-y-2 text-xs text-muted-foreground">
                  <p>支持两种连接方式：</p>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <Bluetooth className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-foreground font-medium">蓝牙连接</p>
                        <p>在设备页点击「搜索设备」，选择你的 Raspberry Pi</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Wifi className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-foreground font-medium">局域网连接</p>
                        <p>输入电脑的 IP 地址和端口号（如 <code>192.168.1.100:8765</code>）</p>
                        <p>IP 和端口只需输入一次，之后会自动保存</p>
                      </div>
                    </div>
                  </div>
                </div>
                <Button
                  onClick={() => { setShowOnboarding(false); setActiveTab('device'); setShowDeviceListDialog(true); }}
                  className="w-full h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
                >
                  前往设备页连接
                </Button>
              </div>
            )}

            {onboardingStep === 2 && (
              <div className="space-y-3">
                <p className="text-sm text-foreground font-medium">第 3 步：测试验证</p>
                <div className="bg-muted rounded-lg p-3 space-y-2 text-xs text-muted-foreground">
                  <p>你可以通过以下方式测试完整流程：</p>
                  <ul className="list-disc list-inside space-y-1.5">
                    <li>在监控页展开「模拟演示」面板，上传图片运行模拟</li>
                    <li>在电脑端运行检测程序后按 <code>t</code> 键发送测试告警</li>
                    <li>在设置页使用「API测试」验证 Coze 工作流</li>
                  </ul>
                  <p className="mt-2">收到告警后，系统会自动调用 AI 模型确认是否为真实跌倒。</p>
                </div>
                <Button
                  onClick={() => { setShowOnboarding(false); setActiveTab('monitor'); setSimulatePanelOpen(true); }}
                  className="w-full h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
                >
                  前往监控页测试
                </Button>
              </div>
            )}

            {/* 导航按钮 */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setOnboardingStep(Math.max(0, onboardingStep - 1))}
                disabled={onboardingStep === 0}
                className="flex-1 h-10 border-border rounded-lg text-sm"
              >
                上一步
              </Button>
              {onboardingStep < 2 ? (
                <Button
                  onClick={() => setOnboardingStep(onboardingStep + 1)}
                  className="flex-1 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
                >
                  下一步
                </Button>
              ) : (
                <Button
                  onClick={() => setShowOnboarding(false)}
                  className="flex-1 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
                >
                  完成
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;
