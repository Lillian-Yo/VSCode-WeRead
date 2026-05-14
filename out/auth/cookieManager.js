"use strict";
/**
 * Cookie 管理
 * 使用 VSCode SecretStorage 安全存储登录凭证
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCookieManager = exports.initializeCookieManager = exports.CookieManager = void 0;
const api_1 = require("../api");
const APP_PREFIX = 'weread.vscode';
const LEGACY_COOKIE_KEY = `${APP_PREFIX}.cookies`;
const USER_INFO_KEY = `${APP_PREFIX}.userInfo`;
const LAST_COOKIE_LOGIN_FIELDS_KEY = `${APP_PREFIX}.lastCookieLoginFields`;
const LEGACY_AUTH_META_KEY = `${APP_PREFIX}.authMeta`;
const LOGIN_STATE_KEY = `${APP_PREFIX}.loggedIn`;
const LEGACY_SIMPLE_BROWSER_AUTH_KEY = `${APP_PREFIX}.simpleBrowserAuth`;
const ACTIVE_ACCOUNT_ID_KEY = `${APP_PREFIX}.activeAccountId`;
const fetchFn = globalThis.fetch;
class CookieManager {
    constructor(context) {
        this.secretStorage = context.secrets;
        this.globalState = context.globalState;
    }
    /**
     * 保存 Cookie
     */
    async saveCookies(cookies) {
        const activeAccountId = this.getActiveAccountId();
        if (!activeAccountId) {
            await this.secretStorage.store(LEGACY_COOKIE_KEY, cookies);
            api_1.apiClient.setCookies(cookies);
            await this.setLoggedInState(true);
            return;
        }
        await this.saveCookiesForAccount(activeAccountId, cookies);
    }
    async saveCookiesForAccount(accountId, cookies) {
        const key = this.getAccountCookieKey(accountId);
        await this.secretStorage.store(key, cookies);
        if (this.getActiveAccountId() === this.normalizeAccountId(accountId)) {
            api_1.apiClient.setCookies(cookies);
        }
        await this.setLoggedInState(true);
    }
    /**
     * 获取 Cookie
     */
    async getCookies() {
        const activeAccountId = this.getActiveAccountId();
        const cookies = activeAccountId
            ? await this.getCookiesForAccount(activeAccountId)
            : await this.secretStorage.get(LEGACY_COOKIE_KEY);
        if (cookies) {
            api_1.apiClient.setCookies(cookies);
        }
        return cookies;
    }
    async getCookiesForAccount(accountId) {
        const key = this.getAccountCookieKey(accountId);
        return this.secretStorage.get(key);
    }
    /**
     * 清除 Cookie
     */
    async clearCookies() {
        const activeAccountId = this.getActiveAccountId();
        if (!activeAccountId) {
            await this.secretStorage.delete(LEGACY_COOKIE_KEY);
            api_1.apiClient.clearCookies();
            await this.setLoggedInState(false);
            return;
        }
        await this.clearCookiesForAccount(activeAccountId);
    }
    async clearCookiesForAccount(accountId) {
        const key = this.getAccountCookieKey(accountId);
        await this.secretStorage.delete(key);
        if (this.getActiveAccountId() === this.normalizeAccountId(accountId)) {
            api_1.apiClient.clearCookies();
            await this.setLoggedInState(false);
        }
    }
    async setActiveAccountId(accountId) {
        const id = this.normalizeAccountId(accountId);
        if (!id) {
            throw new Error('无效账号：accountId 不能为空');
        }
        this.simpleBrowserAuthCache = undefined;
        await this.globalState.update(ACTIVE_ACCOUNT_ID_KEY, id);
    }
    getActiveAccountId() {
        const raw = this.globalState.get(ACTIVE_ACCOUNT_ID_KEY);
        const normalized = this.normalizeAccountId(raw);
        return normalized || undefined;
    }
    async clearActiveAccountId() {
        this.simpleBrowserAuthCache = undefined;
        await this.globalState.update(ACTIVE_ACCOUNT_ID_KEY, undefined);
    }
    async saveSimpleBrowserAuth(payload) {
        const activeAccountId = this.getActiveAccountId();
        if (!activeAccountId) {
            const normalized = {
                cookies: payload.cookies,
                session: payload.session,
                token: payload.token,
                refreshToken: payload.refreshToken,
                expiresAt: payload.expiresAt,
                savedAt: Date.now(),
            };
            await this.secretStorage.store(LEGACY_SIMPLE_BROWSER_AUTH_KEY, JSON.stringify(normalized));
            this.simpleBrowserAuthCache = normalized;
            await this.setLoggedInState(true);
            return;
        }
        await this.saveSimpleBrowserAuthForAccount(activeAccountId, payload);
    }
    async saveSimpleBrowserAuthForAccount(accountId, payload) {
        const normalized = {
            cookies: payload.cookies,
            session: payload.session,
            token: payload.token,
            refreshToken: payload.refreshToken,
            expiresAt: payload.expiresAt,
            savedAt: Date.now(),
        };
        const key = this.getAccountSimpleBrowserAuthKey(accountId);
        await this.secretStorage.store(key, JSON.stringify(normalized));
        if (this.getActiveAccountId() === this.normalizeAccountId(accountId)) {
            this.simpleBrowserAuthCache = normalized;
        }
        await this.setLoggedInState(true);
    }
    async getSimpleBrowserAuth() {
        const activeAccountId = this.getActiveAccountId();
        if (activeAccountId) {
            return this.getSimpleBrowserAuthForAccount(activeAccountId);
        }
        if (this.simpleBrowserAuthCache) {
            return this.simpleBrowserAuthCache;
        }
        const raw = await this.secretStorage.get(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
        if (!raw) {
            return undefined;
        }
        const parsed = this.parseSimpleBrowserAuth(raw);
        if (parsed) {
            this.simpleBrowserAuthCache = parsed;
        }
        return parsed;
    }
    async getSimpleBrowserAuthForAccount(accountId) {
        const normalizedAccountId = this.normalizeAccountId(accountId);
        if (!normalizedAccountId) {
            return undefined;
        }
        if (this.getActiveAccountId() === normalizedAccountId && this.simpleBrowserAuthCache) {
            return this.simpleBrowserAuthCache;
        }
        const raw = await this.secretStorage.get(this.getAccountSimpleBrowserAuthKey(normalizedAccountId));
        if (!raw) {
            return undefined;
        }
        const result = this.parseSimpleBrowserAuth(raw);
        if (result && this.getActiveAccountId() === normalizedAccountId) {
            this.simpleBrowserAuthCache = result;
        }
        return result;
    }
    async clearSimpleBrowserAuth() {
        const activeAccountId = this.getActiveAccountId();
        if (!activeAccountId) {
            this.simpleBrowserAuthCache = undefined;
            await this.secretStorage.delete(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
            await this.setLoggedInState(false);
            return;
        }
        await this.clearSimpleBrowserAuthForAccount(activeAccountId);
    }
    async clearSimpleBrowserAuthForAccount(accountId) {
        const normalizedAccountId = this.normalizeAccountId(accountId);
        if (!normalizedAccountId) {
            return;
        }
        if (this.getActiveAccountId() === normalizedAccountId) {
            this.simpleBrowserAuthCache = undefined;
            await this.setLoggedInState(false);
        }
        await this.secretStorage.delete(this.getAccountSimpleBrowserAuthKey(normalizedAccountId));
    }
    async setLoggedInState(loggedIn) {
        await this.globalState.update(LOGIN_STATE_KEY, loggedIn);
    }
    getLoggedInState() {
        return !!this.globalState.get(LOGIN_STATE_KEY, false);
    }
    /**
     * 保存用户信息
     */
    async saveUserInfo(userInfo) {
        await this.globalState.update(USER_INFO_KEY, userInfo);
    }
    /**
     * 保存最近一次粘贴 Cookie 登录输入
     */
    async saveLastCookieLoginFields(fields) {
        await this.secretStorage.store(LAST_COOKIE_LOGIN_FIELDS_KEY, JSON.stringify(fields));
    }
    /**
     * 获取最近一次粘贴 Cookie 登录输入
     */
    async getLastCookieLoginFields() {
        const raw = await this.secretStorage.get(LAST_COOKIE_LOGIN_FIELDS_KEY);
        if (!raw) {
            return undefined;
        }
        try {
            const parsed = JSON.parse(raw);
            const wrVid = String(parsed.wrVid || '').trim();
            const wrSkey = String(parsed.wrSkey || '').trim();
            if (!wrVid || !wrSkey) {
                return undefined;
            }
            return { wrVid, wrSkey };
        }
        catch {
            return undefined;
        }
    }
    async getAuthMeta(accountId) {
        const activeAccountId = accountId || this.getActiveAccountId();
        const key = activeAccountId ? this.getAccountAuthMetaKey(activeAccountId) : LEGACY_AUTH_META_KEY;
        const raw = this.globalState.get(key, {});
        return {
            lastVerifiedAt: Number(raw.lastVerifiedAt || 0),
            lastRefreshAt: Number(raw.lastRefreshAt || 0),
            refreshFailureCount: Number(raw.refreshFailureCount || 0),
            refreshBackoffUntil: Number(raw.refreshBackoffUntil || 0),
        };
    }
    async updateAuthMeta(patch, accountId) {
        const activeAccountId = accountId || this.getActiveAccountId();
        const key = activeAccountId ? this.getAccountAuthMetaKey(activeAccountId) : LEGACY_AUTH_META_KEY;
        const current = await this.getAuthMeta(activeAccountId);
        await this.globalState.update(key, {
            ...current,
            ...patch,
        });
    }
    /**
     * 获取用户信息
     */
    getUserInfo() {
        return this.globalState.get(USER_INFO_KEY);
    }
    /**
     * 清除用户信息
     */
    async clearUserInfo() {
        await this.globalState.update(USER_INFO_KEY, undefined);
    }
    /**
     * 检查是否已登录
     */
    async isLoggedIn() {
        const cookies = await this.getCookies();
        return !!cookies && cookies.length > 0;
    }
    /**
     * 初始化（从存储加载 Cookie）
     */
    async initialize() {
        const cookies = await this.getCookies();
        if (cookies) {
            api_1.apiClient.setCookies(cookies);
            await this.setLoggedInState(true);
            return;
        }
        await this.setLoggedInState(false);
    }
    /**
     * 向官方网页请求刷新 Cookie（主要刷新 wr_skey）
     */
    async refreshCookiesFromServer() {
        const current = await this.getCookies();
        if (!current) {
            return;
        }
        const response = await fetchFn('https://weread.qq.com/', {
            method: 'HEAD',
            headers: { Cookie: current },
        });
        const setCookie = response.headers.getSetCookie?.() ??
            response.headers
                .get('set-cookie')
                ?.split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
                .map((item) => item.trim()) ??
            [];
        if (setCookie.length === 0) {
            return;
        }
        const merged = this.mergeCookieString(current, setCookie);
        if (merged && merged !== current) {
            await this.saveCookies(merged);
        }
    }
    mergeCookieString(current, setCookie) {
        const map = new Map();
        for (const pair of current.split(';')) {
            const [rawName, ...rawValueParts] = pair.trim().split('=');
            if (!rawName) {
                continue;
            }
            map.set(rawName.trim(), rawValueParts.join('=').trim());
        }
        for (const line of setCookie) {
            const firstPart = line.split(';')[0];
            const idx = firstPart.indexOf('=');
            if (idx <= 0) {
                continue;
            }
            const name = firstPart.slice(0, idx).trim();
            const value = firstPart.slice(idx + 1).trim();
            if (!name) {
                continue;
            }
            map.set(name, value);
        }
        return Array.from(map.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }
    /**
     * 登出
     */
    async logout() {
        const activeAccountId = this.getActiveAccountId();
        if (activeAccountId) {
            await this.clearCookiesForAccount(activeAccountId);
            await this.clearSimpleBrowserAuthForAccount(activeAccountId);
        }
        else {
            await this.clearCookies();
            await this.clearSimpleBrowserAuth();
        }
        await this.clearUserInfo();
        const currentAccountId = this.getActiveAccountId();
        if (currentAccountId) {
            await this.globalState.update(this.getAccountAuthMetaKey(currentAccountId), undefined);
        }
        else {
            await this.globalState.update(LEGACY_AUTH_META_KEY, undefined);
        }
        await this.globalState.update(LOGIN_STATE_KEY, false);
    }
    parseSimpleBrowserAuth(raw) {
        try {
            const parsed = JSON.parse(raw);
            const cookies = String(parsed.cookies || '').trim();
            if (!cookies) {
                return undefined;
            }
            return {
                cookies,
                session: parsed.session ? String(parsed.session).trim() : undefined,
                token: parsed.token ? String(parsed.token).trim() : undefined,
                refreshToken: parsed.refreshToken ? String(parsed.refreshToken).trim() : undefined,
                expiresAt: Number(parsed.expiresAt || 0) || undefined,
                savedAt: Number(parsed.savedAt || Date.now()),
            };
        }
        catch {
            return undefined;
        }
    }
    getAccountCookieKey(accountId) {
        const normalized = this.normalizeAccountId(accountId);
        if (!normalized) {
            throw new Error('无效账号：accountId 不能为空');
        }
        return `${APP_PREFIX}.${normalized}.cookies`;
    }
    getAccountSimpleBrowserAuthKey(accountId) {
        const normalized = this.normalizeAccountId(accountId);
        if (!normalized) {
            throw new Error('无效账号：accountId 不能为空');
        }
        return `${APP_PREFIX}.${normalized}.simpleBrowserAuth`;
    }
    getAccountAuthMetaKey(accountId) {
        const normalized = this.normalizeAccountId(accountId);
        if (!normalized) {
            throw new Error('无效账号：accountId 不能为空');
        }
        return `${APP_PREFIX}.${normalized}.authMeta`;
    }
    normalizeAccountId(accountId) {
        return String(accountId || '').trim();
    }
}
exports.CookieManager = CookieManager;
let cookieManagerInstance;
function initializeCookieManager(context) {
    cookieManagerInstance = new CookieManager(context);
    return cookieManagerInstance;
}
exports.initializeCookieManager = initializeCookieManager;
function getCookieManager() {
    if (!cookieManagerInstance) {
        throw new Error('CookieManager not initialized');
    }
    return cookieManagerInstance;
}
exports.getCookieManager = getCookieManager;
//# sourceMappingURL=cookieManager.js.map