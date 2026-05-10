/**
 * WebSocket 通信模块
 * 用于局域网内接收 fall_detect_windows 推送的跌倒告警
 */

export interface FallAlert {
  type: 'fall_alert';
  timestamp: string;
  image: string; // base64 编码的 JPEG
  rules: Record<string, { triggered: boolean; value: number; threshold: number }>;
  confidence: number;
  visible_points: number;
  test?: boolean;
}

type AlertCallback = (alert: FallAlert) => void;
type StatusCallback = (connected: boolean) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private url: string = '';
  private alertCallback: AlertCallback | null = null;
  private statusCallback: StatusCallback | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect: boolean = false;
  private reconnectDelay: number = 3000;
  private settled: boolean = false;

  async connect(url: string): Promise<void> {
    this.disconnect();
    this.url = url;
    this.shouldReconnect = true;
    this.settled = false;

    // Step 1: HTTP 健康检查 (端口 = WS端口 + 1)
    const match = url.match(/^ws:\/\/(.+):(\d+)$/);
    if (match) {
      const host = match[1];
      const wsPort = parseInt(match[2]);
      const httpPort = wsPort + 1;
      const httpUrl = `http://${host}:${httpPort}`;
      console.log(`[WS] HTTP 健康检查: ${httpUrl}`);
      try {
        const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
        const text = await resp.text();
        console.log(`[WS] HTTP 响应: ${text}`);
      } catch (err: any) {
        throw new Error(
          `网络不通 (${httpUrl}): ${err?.message || '无法连接到电脑'}. ` +
          `请检查: 1) 手机和电脑在同一WiFi  2) 电脑防火墙放行端口 ${httpPort}`
        );
      }
    }

    // Step 2: WebSocket 连接
    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      const settle = (fn: () => void) => {
        if (this.settled) return;
        this.settled = true;
        fn();
      };

      const timeout = setTimeout(() => {
        settle(() => {
          console.error(`[WS] 连接超时: ${url}`);
          if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
          }
          reject(new Error(
            `WebSocket 连接超时. HTTP 健康检查通过但 WebSocket 连接失败. ` +
            `请确认电脑防火墙已放行端口 ${match ? match[2] : '8765'}`
          ));
        });
      }, 8000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        console.log('[WS] 已连接:', url);
        this.statusCallback?.(true);
        settle(resolve);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as FallAlert;
          if (data.type === 'fall_alert') {
            this.alertCallback?.(data);
          }
        } catch (err) {
          console.warn('[WS] 消息解析失败:', err);
        }
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        console.log('[WS] 已断开');
        this.statusCallback?.(false);
        settle(() => reject(new Error('WebSocket 连接被关闭')));
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        console.error('[WS] 连接错误');
        this.statusCallback?.(false);
        settle(() => {
          if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
          }
          reject(new Error(
            `WebSocket 连接失败. 请确认: ` +
            `1) 电脑防火墙已放行端口 ${match ? match[2] : '8765'}  ` +
            `2) fall_detect_windows.py 正在运行`
          ));
        });
      };
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.settled = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.statusCallback?.(false);
  }

  onAlert(callback: AlertCallback): void {
    this.alertCallback = callback;
  }

  onStatusChange(callback: StatusCallback): void {
    this.statusCallback = callback;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect && this.url) {
        console.log('[WS] 尝试重连...');
        this.connect(this.url).catch(() => {});
      }
    }, this.reconnectDelay);
  }
}

// 单例
export const wsClient = new WsClient();
