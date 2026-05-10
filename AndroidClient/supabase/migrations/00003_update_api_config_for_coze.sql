ALTER TABLE api_config ADD COLUMN token text DEFAULT '';
ALTER TABLE api_config ADD COLUMN workflow_id text DEFAULT '';
ALTER TABLE api_config ADD COLUMN base_url text DEFAULT '';

UPDATE api_config SET base_url = 'https://api.coze.cn', workflow_id = '' WHERE id IS NOT NULL;