"use strict";
/**
 * HTTP 客户端封装
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiClient = exports.ApiClient = void 0;
const BASE_URL = 'https://i.weread.qq.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;
const fetchFn = globalThis.fetch;
class ApiClient {
    constructor() {
        this.cookies = '';
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    buildHeaders(extraHeaders) {
        const headers = {
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
    buildUrl(url, params) {
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
    async request(method, url, config) {
        const timeout = config?.timeout ?? DEFAULT_TIMEOUT;
        const requestUrl = this.buildUrl(url, config?.params);
        let lastError;
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
                return data;
            }
            catch (error) {
                const normalizedError = this.handleError(error);
                lastError = normalizedError;
                if (attempt >= MAX_RETRIES) {
                    console.error('[API Response Error]', normalizedError.message);
                    throw normalizedError;
                }
                console.log(`[API Retry] ${requestUrl} (attempt ${attempt}/${MAX_RETRIES})`);
                await this.delay(RETRY_DELAY * attempt);
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw lastError ?? new Error('未知错误');
    }
    handleHttpError(status, data) {
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
    handleError(error) {
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
    extractSessionFromCookies(cookies) {
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
    safeDecodeCookieValue(value) {
        try {
            return decodeURIComponent(value);
        }
        catch {
            return value;
        }
    }
    setCookies(cookies) {
        this.cookies = cookies;
    }
    getCookies() {
        return this.cookies;
    }
    clearCookies() {
        this.cookies = '';
    }
    async get(url, config) {
        return this.request('GET', url, config);
    }
    async post(url, data, config) {
        return this.request('POST', url, { ...config, body: data });
    }
}
exports.ApiClient = ApiClient;
// 导出单例
exports.apiClient = new ApiClient();
//# sourceMappingURL=client.js.map