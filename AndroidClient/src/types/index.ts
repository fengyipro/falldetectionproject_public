export interface Option {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  withCount?: boolean;
}

export interface AlertRecord {
  id: string;
  created_at: string;
  image_url: string | null;
  location: string;
  posture: string;
  status: 'suspected' | 'emergency' | 'normal';
  confirmed_at: string | null;
  api_confirmed: boolean;
}

export interface DeviceSettings {
  id: string;
  device_name: string;
  device_id: string | null;
  connected_at: string | null;
  is_connected: boolean;
  updated_at: string;
}

export interface ApiConfig {
  id: string;
  api_url: string;
  token: string;
  workflow_id: string;
  base_url: string;
  created_at: string;
  updated_at: string;
}

export interface BluetoothDevice {
  id: string;
  name: string;
}

export interface FallDetectDevice {
  deviceId: string;
  name: string;
  rssi?: number;
}

export interface BleImageAlert {
  imageBase64: string;
  timestamp: string;
  status: 'FALL_ALERT' | 'NORMAL';
}

export interface WsDevice {
  ip: string;
  port: number;
  connected: boolean;
}
