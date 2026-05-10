import { CozeAPI } from '@coze/api';
import type { ApiConfig } from '@/types';

export interface CozeTestResult {
  success: boolean;
  confirmed?: boolean;
  posture?: string;
  raw?: string;
  allEvents?: string;
  error?: string;
}

function createClient(config: Pick<ApiConfig, 'token' | 'base_url'>) {
  return new CozeAPI({
    token: config.token,
    baseURL: config.base_url || 'https://api.coze.cn',
    allowPersonalAccessTokenInBrowser: true,
  });
}

function extractValue(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) return record[key];
  }
  for (const key of keys) {
    for (const k of Object.keys(record)) {
      const v = record[k];
      if (v && typeof v === 'object') {
        const nested = v as Record<string, unknown>;
        if (key in nested) return nested[key];
      }
    }
  }
  return undefined;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getFallResultFromObj(obj: unknown): { confirmed: boolean; posture: string } | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  if (!('fall_detection_result' in record)) return null;

  const val = record['fall_detection_result'];
  let num = -1;
  if (typeof val === 'number') num = val;
  else if (typeof val === 'string') num = parseInt(val.trim(), 10);
  else if (typeof val === 'boolean') num = val ? 1 : 0;

  if (Number.isNaN(num)) return null;
  const isFall = num === 1;
  return {
    confirmed: isFall,
    posture: isFall ? '确认跌倒' : '未确认跌倒',
  };
}

function resolveFallResult(value: unknown): { confirmed: boolean; posture: string } | null {
  // 1. 直接对象
  const direct = getFallResultFromObj(value);
  if (direct) return direct;

  // 2. 字符串 JSON
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      const fromJson = getFallResultFromObj(parsed);
      if (fromJson) return fromJson;

      // 嵌套 data / content 字段
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        if ('data' in record) {
          const data = record.data;
          if (typeof data === 'string') {
            try {
              const inner = JSON.parse(data);
              const fromInner = getFallResultFromObj(inner);
              if (fromInner) return fromInner;
            } catch {
              // ignore
            }
          }
          const fromData = getFallResultFromObj(data);
          if (fromData) return fromData;
        }
        if ('content' in record) {
          const content = record.content;
          if (typeof content === 'string') {
            try {
              const inner = JSON.parse(content);
              const fromInner = getFallResultFromObj(inner);
              if (fromInner) return fromInner;
            } catch {
              // ignore
            }
          }
          const fromContent = getFallResultFromObj(content);
          if (fromContent) return fromContent;
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. 对象嵌套 data / content
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('data' in record) {
      const data = record.data;
      if (typeof data === 'string') {
        try {
          const inner = JSON.parse(data);
          const fromInner = getFallResultFromObj(inner);
          if (fromInner) return fromInner;
        } catch {
          // ignore
        }
      }
      const fromData = getFallResultFromObj(data);
      if (fromData) return fromData;
    }
    if ('content' in record) {
      const content = record.content;
      if (typeof content === 'string') {
        try {
          const inner = JSON.parse(content);
          const fromInner = getFallResultFromObj(inner);
          if (fromInner) return fromInner;
        } catch {
          // ignore
        }
      }
      const fromContent = getFallResultFromObj(content);
      if (fromContent) return fromContent;
    }
  }

  return null;
}

export async function runCozeWorkflow(
  config: Pick<ApiConfig, 'token' | 'base_url' | 'workflow_id'>,
  imageUrl: string,
  paramName = 'image'
): Promise<CozeTestResult> {
  try {
    const client = createClient(config);
    const parameters: Record<string, string> = {};
    parameters[paramName] = imageUrl;
    const res = await client.workflows.runs.stream({
      workflow_id: config.workflow_id,
      parameters,
    });

    let lastData: unknown = '';
    const allEvents: unknown[] = [];
    const messageEvents: unknown[] = [];

    for await (const item of res) {
      if (typeof item === 'string') {
        lastData = item;
        allEvents.push({ type: 'string', value: item });
      } else if (item && typeof item === 'object') {
        const anyItem = item as unknown as Record<string, unknown>;
        allEvents.push(anyItem);
        if (anyItem.event === 'message') {
          messageEvents.push(anyItem);
        }
        if (anyItem.data !== undefined) {
          lastData = anyItem.data;
        }
        if (anyItem.event === 'message' && anyItem.data !== undefined) {
          lastData = anyItem.data;
        }
      }
    }

    // 取最后一个 message 事件作为最终数据
    if (messageEvents.length > 0) {
      const lastMsg = messageEvents[messageEvents.length - 1] as Record<string, unknown>;
      if (lastMsg.data !== undefined) {
        lastData = lastMsg.data;
      }
    }

    const rawText = safeStringify(lastData);
    const allEventsText = safeStringify(allEvents);

    let confirmed = false;
    let posture = '未知姿态';

    // 1. 优先解析 fall_detection_result
    const fallResult = resolveFallResult(lastData);
    if (fallResult) {
      confirmed = fallResult.confirmed;
      posture = fallResult.posture;
    }

    // 2. 兜底：通用 confirmed/posture 字段
    if (posture === '未知姿态') {
      const confirmedVal = extractValue(lastData, 'confirmed', 'is_fall', 'fall_detected');
      if (typeof confirmedVal === 'boolean') {
        confirmed = confirmedVal;
      } else if (typeof confirmedVal === 'string') {
        confirmed = /^(true|yes|1|是|确认)/i.test(confirmedVal.trim());
      } else if (typeof confirmedVal === 'number') {
        confirmed = confirmedVal === 1;
      }

      const postureVal = extractValue(lastData, 'posture', 'pose', 'action', 'result');
      if (typeof postureVal === 'string') {
        posture = postureVal;
      }
    }

    // 3. JSON 文本解析
    if (posture === '未知姿态') {
      try {
        const parsed = JSON.parse(rawText);
        const fr = resolveFallResult(parsed);
        if (fr) {
          confirmed = fr.confirmed;
          posture = fr.posture;
        }
      } catch {
        // rawText 不是 JSON
      }
    }

    // 4. 最终兜底：文本关键词
    if (posture === '未知姿态') {
      const lower = rawText.toLowerCase();
      if (lower.includes('确认跌倒') || lower.includes('摔倒') || lower.includes('fall')) {
        confirmed = true;
        posture = '确认跌倒';
      }
      if (lower.includes('未') || lower.includes('no') || lower.includes('false')) {
        confirmed = false;
      }
    }

    return { success: true, confirmed, posture, raw: rawText, allEvents: allEventsText };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '调用失败',
    };
  }
}
