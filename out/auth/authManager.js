"use strict";
/**
 * 认证管理器
 * 统一管理登录状态和用户认证
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthManager = exports.initializeAuthManager = exports.AuthManager = void 0;
const vscode = __importStar(require("vscode"));
const qrLogin_1 = require("./qrLogin");
const api_1 = require("../api");
const i18n_1 = require("../i18n");
const accountMetaManager_1 = require("../services/accountMetaManager");
class AuthManager {
    constructor(cookieManager) {
        this._onDidChangeLoginState = new vscode.EventEmitter();
        this.refreshSchedulerTimers = new Map();
        this.refreshInFlights = new Map();
        this.onDidChangeLoginState = this._onDidChangeLoginState.event;
        this.cookieManager = cookieManager;
        this.qrLoginManager = new qrLogin_1.QRLoginManager(cookieManager);
    }
    /**
     * 初始化认证状态
     */
    async initialize() {
        await this.cookieManager.initialize();
        // 检查登录状态
        const isLoggedIn = await this.checkLoginStatus();
        if (isLoggedIn) {
            this.scheduleProactiveRefresh(this.cookieManager.getActiveAccountId());
        }
        this._onDidChangeLoginState.fire(isLoggedIn);
    }
    async switchAccount(accountId) {
        await this.cookieManager.setActiveAccountId(accountId);
        await (0, accountMetaManager_1.getAccountMetaManager)().setActiveAccountId(accountId);
        await this.cookieManager.getCookies();
        this._onDidChangeLoginState.fire(await this.checkLoginStatus());
    }
    async listAccounts() {
        return (0, accountMetaManager_1.getAccountMetaManager)().listAccounts();
    }
    async removeAccount(accountId) {
        const normalized = String(accountId || '').trim();
        if (!normalized) {
            return;
        }
        const wasActive = this.cookieManager.getActiveAccountId() === normalized;
        await this.cookieManager.clearCookiesForAccount(normalized);
        await this.cookieManager.clearSimpleBrowserAuthForAccount(normalized);
        await (0, accountMetaManager_1.getAccountMetaManager)().removeAccount(normalized);
        this.stopProactiveRefresh(normalized);
        if (wasActive) {
            const next = (0, accountMetaManager_1.getAccountMetaManager)().listAccounts()[0]?.accountId;
            if (next) {
                await this.switchAccount(next);
            }
            else {
                await this.cookieManager.clearActiveAccountId();
                await this.cookieManager.clearUserInfo();
                this._onDidChangeLoginState.fire(false);
            }
        }
    }
    async checkLoginStatusForAccount(accountId, options) {
        return this.runWithAccount(accountId, async () => this.checkLoginStatus(options));
    }
    async logoutAccount(accountId) {
        const normalized = String(accountId || '').trim();
        if (!normalized) {
            return;
        }
        await this.cookieManager.clearCookiesForAccount(normalized);
        await this.cookieManager.clearSimpleBrowserAuthForAccount(normalized);
        await this.cookieManager.updateAuthMeta({ lastVerifiedAt: 0, lastRefreshAt: 0, refreshFailureCount: 0, refreshBackoffUntil: 0 }, normalized);
        this.stopProactiveRefresh(normalized);
        if (this.cookieManager.getActiveAccountId() === normalized) {
            await this.cookieManager.clearUserInfo();
            this._onDidChangeLoginState.fire(false);
        }
    }
    /**
     * 检查登录状态
     */
    async checkLoginStatus(options) {
        const strict = options?.strict === true;
        const accountId = this.cookieManager.getActiveAccountId();
        const hasCookies = await this.cookieManager.isLoggedIn();
        if (!hasCookies) {
            await this.cookieManager.clearUserInfo();
            await this.cookieManager.clearSimpleBrowserAuth();
            this.stopProactiveRefresh(accountId);
            return false;
        }
        const now = Date.now();
        const meta = await this.cookieManager.getAuthMeta(accountId);
        if (!strict && now - meta.lastVerifiedAt < AuthManager.VERIFY_CACHE_MS) {
            this.scheduleProactiveRefresh(accountId);
            return true;
        }
        try {
            if (!strict) {
                await this.refreshCookiesWithRiskControl(now, undefined, accountId);
            }
            // 严格模式用于同步入口，必须做实时校验，不可依赖宽限
            let isValid = await (0, api_1.checkLoginStatus)();
            if (!isValid && strict) {
                await this.refreshCookiesWithRiskControl(now, { force: true }, accountId);
                isValid = await (0, api_1.checkLoginStatus)();
            }
            if (isValid) {
                await this.cookieManager.updateAuthMeta({ lastVerifiedAt: now }, accountId);
                this.scheduleProactiveRefresh(accountId);
                return true;
            }
            if (strict) {
                await this.cookieManager.clearUserInfo();
                await this.cookieManager.clearSimpleBrowserAuth();
                return false;
            }
            const withinGrace = await this.isWithinGracePeriod(now);
            if (!withinGrace) {
                await this.cookieManager.clearUserInfo();
                await this.cookieManager.clearSimpleBrowserAuth();
            }
            return withinGrace;
        }
        catch (error) {
            console.error('Check login status error:', error);
            if (strict) {
                return false;
            }
            const withinGrace = await this.isWithinGracePeriod(now);
            if (!withinGrace) {
                await this.cookieManager.clearUserInfo();
                await this.cookieManager.clearSimpleBrowserAuth();
            }
            return withinGrace;
        }
    }
    /**
     * 执行登录
     */
    async login() {
        const success = await this.qrLoginManager.startLogin();
        if (success) {
            await this.cookieManager.updateAuthMeta({
                lastVerifiedAt: Date.now(),
                refreshFailureCount: 0,
                refreshBackoffUntil: 0,
            }, this.cookieManager.getActiveAccountId());
            this.scheduleProactiveRefresh(this.cookieManager.getActiveAccountId());
            this.emitLoginStateWithRetry(true);
        }
        return success;
    }
    /**
     * 直接进入网页登录协议扫码方案
     */
    async loginByProtocol() {
        const success = await this.qrLoginManager.startProtocolLogin();
        if (success) {
            await this.cookieManager.updateAuthMeta({
                lastVerifiedAt: Date.now(),
                refreshFailureCount: 0,
                refreshBackoffUntil: 0,
            }, this.cookieManager.getActiveAccountId());
            this.scheduleProactiveRefresh(this.cookieManager.getActiveAccountId());
            this.emitLoginStateWithRetry(true);
        }
        return success;
    }
    /**
     * 直接进入粘贴 Cookie 方案
     */
    async loginByCookie() {
        const success = await this.qrLoginManager.startCookieLogin();
        if (success) {
            await this.cookieManager.updateAuthMeta({
                lastVerifiedAt: Date.now(),
                refreshFailureCount: 0,
                refreshBackoffUntil: 0,
            }, this.cookieManager.getActiveAccountId());
            this.scheduleProactiveRefresh(this.cookieManager.getActiveAccountId());
            this.emitLoginStateWithRetry(true);
        }
        return success;
    }
    /**
     * 执行登出
     */
    async logout() {
        this.clearLoginStateRetry();
        const activeAccountId = this.cookieManager.getActiveAccountId();
        if (activeAccountId) {
            await this.logoutAccount(activeAccountId);
        }
        else {
            await this.cookieManager.logout();
        }
        this._onDidChangeLoginState.fire(false);
        vscode.window.showInformationMessage((0, i18n_1.t)('auth_logout_success'));
    }
    /**
     * 获取当前用户信息
     */
    getCurrentUser() {
        return this.cookieManager.getUserInfo();
    }
    /**
     * 要求用户登录
     */
    async requireLogin() {
        const isLoggedIn = await this.checkLoginStatus();
        if (isLoggedIn) {
            return true;
        }
        const result = await vscode.window.showInformationMessage((0, i18n_1.t)('auth_require_login'), (0, i18n_1.t)('auth_login_now'), (0, i18n_1.t)('common_cancel'));
        if (result === (0, i18n_1.t)('auth_login_now')) {
            return await this.login();
        }
        return false;
    }
    /**
     * 更新 VSCode 上下文状态
     */
    async updateContext() {
        const hasCookies = await this.cookieManager.isLoggedIn();
        const isLoggedIn = hasCookies || await this.checkLoginStatus();
        await vscode.commands.executeCommand('setContext', 'weread:loggedIn', isLoggedIn);
    }
    emitLoginStateWithRetry(expectedState) {
        this.clearLoginStateRetry();
        this._onDidChangeLoginState.fire(expectedState);
        if (!expectedState) {
            return;
        }
        this.loginStateRetryTimer = setTimeout(() => {
            void this.revalidateAndBroadcastLoginState(expectedState);
        }, 1200);
    }
    async revalidateAndBroadcastLoginState(expectedState) {
        this.loginStateRetryTimer = undefined;
        try {
            const currentState = await this.checkLoginStatus();
            this._onDidChangeLoginState.fire(currentState);
            if (expectedState && !currentState) {
                this.loginStateRetryTimer = setTimeout(() => {
                    void this.revalidateAndBroadcastLoginState(expectedState);
                }, 2500);
            }
        }
        catch {
            this._onDidChangeLoginState.fire(expectedState);
            this.loginStateRetryTimer = setTimeout(() => {
                void this.revalidateAndBroadcastLoginState(expectedState);
            }, 2500);
        }
    }
    clearLoginStateRetry() {
        if (this.loginStateRetryTimer) {
            clearTimeout(this.loginStateRetryTimer);
            this.loginStateRetryTimer = undefined;
        }
    }
    async refreshCookiesWithRiskControl(now, options, accountId) {
        const targetAccountId = String(accountId || this.cookieManager.getActiveAccountId() || '').trim();
        if (!targetAccountId) {
            return;
        }
        const force = options?.force === true;
        const inFlight = this.refreshInFlights.get(targetAccountId);
        if (inFlight) {
            await inFlight;
            return;
        }
        const meta = await this.cookieManager.getAuthMeta(targetAccountId);
        if (now < meta.refreshBackoffUntil) {
            return;
        }
        if (!force && now - meta.lastRefreshAt < AuthManager.MIN_REFRESH_INTERVAL_MS) {
            return;
        }
        const task = (async () => {
            try {
                await this.runWithAccount(targetAccountId, () => this.cookieManager.refreshCookiesFromServer());
                await this.cookieManager.updateAuthMeta({
                    lastRefreshAt: Date.now(),
                    refreshFailureCount: 0,
                    refreshBackoffUntil: 0,
                }, targetAccountId);
            }
            catch {
                const latest = await this.cookieManager.getAuthMeta(targetAccountId);
                const nextFailure = latest.refreshFailureCount + 1;
                const backoff = Math.min(AuthManager.MAX_BACKOFF_MS, AuthManager.BASE_BACKOFF_MS * Math.pow(2, Math.max(0, nextFailure - 1)));
                const jitter = Math.floor(Math.random() * (10 * 60 * 1000));
                await this.cookieManager.updateAuthMeta({
                    refreshFailureCount: nextFailure,
                    refreshBackoffUntil: Date.now() + backoff + jitter,
                }, targetAccountId);
            }
        })();
        this.refreshInFlights.set(targetAccountId, task);
        try {
            await task;
        }
        finally {
            this.refreshInFlights.delete(targetAccountId);
        }
    }
    async isWithinGracePeriod(now) {
        const meta = await this.cookieManager.getAuthMeta();
        return now - meta.lastVerifiedAt <= AuthManager.VERIFY_GRACE_MS;
    }
    scheduleProactiveRefresh(accountId, delayMs) {
        const targetAccountId = String(accountId || this.cookieManager.getActiveAccountId() || '').trim();
        if (!targetAccountId) {
            return;
        }
        const current = this.refreshSchedulerTimers.get(targetAccountId);
        if (current) {
            clearTimeout(current);
            this.refreshSchedulerTimers.delete(targetAccountId);
        }
        const min = AuthManager.MIN_REFRESH_INTERVAL_MS;
        const max = AuthManager.MAX_REFRESH_INTERVAL_MS;
        const nextDelay = delayMs ?? Math.floor(Math.random() * (max - min + 1) + min);
        const timer = setTimeout(() => {
            void this.runProactiveRefreshTick(targetAccountId);
        }, nextDelay);
        this.refreshSchedulerTimers.set(targetAccountId, timer);
    }
    stopProactiveRefresh(accountId) {
        if (accountId) {
            const timer = this.refreshSchedulerTimers.get(accountId);
            if (timer) {
                clearTimeout(timer);
                this.refreshSchedulerTimers.delete(accountId);
            }
            return;
        }
        for (const timer of this.refreshSchedulerTimers.values()) {
            clearTimeout(timer);
        }
        this.refreshSchedulerTimers.clear();
    }
    async runProactiveRefreshTick(accountId) {
        const hasCookies = !!(await this.cookieManager.getCookiesForAccount(accountId));
        if (!hasCookies) {
            this.stopProactiveRefresh(accountId);
            return;
        }
        await this.refreshCookiesWithRiskControl(Date.now(), undefined, accountId);
        this.scheduleProactiveRefresh(accountId);
    }
    dispose() {
        this.clearLoginStateRetry();
        this.stopProactiveRefresh();
        this._onDidChangeLoginState.dispose();
    }
    async runWithAccount(accountId, run) {
        const normalized = String(accountId || '').trim();
        if (!normalized) {
            return run();
        }
        const prev = this.cookieManager.getActiveAccountId();
        if (prev === normalized) {
            return run();
        }
        await this.cookieManager.setActiveAccountId(normalized);
        try {
            return await run();
        }
        finally {
            if (prev) {
                await this.cookieManager.setActiveAccountId(prev);
                await this.cookieManager.getCookies();
            }
            else {
                await this.cookieManager.clearActiveAccountId();
            }
        }
    }
}
exports.AuthManager = AuthManager;
AuthManager.VERIFY_CACHE_MS = 10 * 60 * 1000;
AuthManager.VERIFY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
AuthManager.MIN_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;
AuthManager.MAX_REFRESH_INTERVAL_MS = 16 * 60 * 60 * 1000;
AuthManager.BASE_BACKOFF_MS = 30 * 60 * 1000;
AuthManager.MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
let authManagerInstance;
function initializeAuthManager(cookieManager) {
    authManagerInstance = new AuthManager(cookieManager);
    return authManagerInstance;
}
exports.initializeAuthManager = initializeAuthManager;
function getAuthManager() {
    if (!authManagerInstance) {
        throw new Error('AuthManager not initialized');
    }
    return authManagerInstance;
}
exports.getAuthManager = getAuthManager;
//# sourceMappingURL=authManager.js.map