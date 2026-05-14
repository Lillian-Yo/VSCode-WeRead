/**
 * HTTP 客户端封装
 */

const BASE_URL = 'https://i.weread.qq.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;
const fetchFn = (globalThis as any).fetch as (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
  body?: unknown;
}

export class ApiClient {
  private cookies: string = '';

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'WeRead/7.0.0 (iPhone; iOS 16.0; Scale/3.00)',
      'Accept': 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (this.cookies) {
      headers.Cookie = this.cookies;
      const session = this.extractSessionFromCookies(this.cookies);
      if (session) {
        headers['x-vid'] = session.vid;
        headers['x-skey'] = session.skey;
      }
    }

    return headers;
  }

  private buildUrl(url: string, params?: Record<string, string | number | boolean | undefined>): string {
    const resolved = /^https?:\/\//i.test(url) ? new URL(url) : new URL(url, BASE_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          resolved.searchParams.set(key, String(value));
        }
      }
    }
    return resolved.toString();
  }

  private async request<T>(
    method: 'GET' | 'POST',
    url: string,
    config?: RequestConfig
  ): Promise<T> {
    const timeout = config?.timeout ?? DEFAULT_TIMEOUT;
    const requestUrl = this.buildUrl(url, config?.params);
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        console.log(`[API Request] ${method} ${requestUrl}`);
        const response = await fetchFn(requestUrl, {
          method,
          headers: this.buildHeaders(config?.headers),
          body: method === 'POST' && config?.body !== undefined ? JSON.stringify(config.body) : undefined,
          signal: controller.signal,
        });

        const rawText = await response.text();
        const data = rawText ? JSON.parse(rawText) : undefined;

        if (!response.ok) {
          throw this.handleHttpError(response.status, data);
        }

        console.log(`[API Response] ${response.status} ${requestUrl}`);
        return data as T;
      } catch (error) {
        const normalizedError = this.handleError(error);
        lastError = normalizedError;
        if (attempt >= MAX_RETRIES) {
          console.error('[API Response Error]', normalizedError.message);
          throw normalizedError;
        }
        console.log(`[API Retry] ${requestUrl} (attempt ${attempt}/${MAX_RETRIES})`);
        await this.delay(RETRY_DELAY * attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new Error('未知错误');
  }

  private handleHttpError(status: number, data: any): Error {
    switch (status) {
      case 401:
        return new Error('登录已过期，请重新登录');
      case 403:
        return new Error('没有权限访问该资源');
      case 404:
        return new Error('请求的资源不存在');
      case 500:
        return new Error('服务器内部错误');
      default:
        return new Error(data?.message || `请求失败 (${status})`);
    }
  }

  private handleError(error: any): Error {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new Error('网络请求超时，请稍后重试');
      }
      if (error.message) {
        return error;
      }
    }
    return new Error('网络请求失败，请检查网络连接');
  }

  private extractSessionFromCookies(
    cookies: string
  ): { vid: string; skey: string } | undefined {
    const vidMatch = cookies.match(/(?:^|;\s*)wr_vid=([^;]+)/);
    const skeyMatch = cookies.match(/(?:^|;\s*)wr_skey=([^;]+)/);
    if (!vidMatch || !skeyMatch) {
      return undefined;
    }
    return {
      vid: this.safeDecodeCookieValue(vidMatch[1]),
      skey: this.safeDecodeCookieValue(skeyMatch[1]),
    };
  }

  private safeDecodeCookieValue(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  public setCookies(cookies: string): void {
    this.cookies = cookies;
  }

  public getCookies(): string {
    return this.cookies;
  }

  public clearCookies(): void {
    this.cookies = '';
  }

  public async get<T>(url: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('GET', url, config);
  }

  public async post<T>(url: string, data?: any, config?: RequestConfig): Promise<T> {
    return this.request<T>('POST', url, { ...config, body: data });
  }
}

// 导出单例
export const apiClient = new ApiClient();
