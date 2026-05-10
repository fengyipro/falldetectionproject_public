CREATE TABLE alert_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  image_url text,
  location text DEFAULT '未知位置',
  posture text DEFAULT '未知姿态',
  status text NOT NULL DEFAULT 'suspected',
  confirmed_at timestamptz,
  api_confirmed boolean DEFAULT false
);

CREATE TABLE device_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name text NOT NULL DEFAULT '树莓派设备',
  device_id text,
  connected_at timestamptz,
  is_connected boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO device_settings (device_name, is_connected) VALUES ('树莓派设备', false);
INSERT INTO api_config (api_url) VALUES ('');