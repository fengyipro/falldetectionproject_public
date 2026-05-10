ALTER TABLE alert_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_alert_records" ON alert_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_device_settings" ON device_settings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_api_config" ON api_config FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE alert_records;