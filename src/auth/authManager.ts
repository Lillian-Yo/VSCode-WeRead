/**
 * 认证管理器
 * 统一管理登录状态和用户认证
 */

import * as vscode from 'vscode';
import { CookieManager } from './cookieManager';
import { QRLoginManager } from './qrLogin';
import { checkLoginStatus } from '../api';
import { t } from '../i18n';
import { getAccountMetaManager } from '../services/accountMetaManager';
import { AccountId, AccountProfile } from '../types/account';

export class AuthManager implements vscode.Disposable {
  private static readonly VERIFY_CACHE_MS = 10 * 60 * 1000;
  private static readonly VERIFY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly MIN_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;
  private static readonly MAX_REFRESH_INTERVAL_MS = 16 * 60 * 60 * 1000;
  private static readonly BASE_BACKOFF_MS = 30 * 60 * 1000;
  private static readonly MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

  private cookieManager: CookieManager;
  private qrLoginManager: QRLoginManager;
  private _onDidChangeLoginState = new vscode.EventEmitter<boolean>();
  private loginStateRetryTimer?: NodeJS.Timeout;
  private refreshSchedulerTimers = new Map<AccountId, NodeJS.Timeout>();
  private refreshInFlights = new Map<AccountId, Promise<void>>();

  public readonly onDidChangeLoginState = this._onDidChangeLoginState.event;

  constructor(cookieManager: CookieManager) {
    this.cookieManager = cookieManager;
    this.qrLoginManager = new QRLoginManager(cookieManager);
  }

  /**
   * 初始化认证状态
   */
  async initialize(): Promise<void> {
    await this.cookieManager.initialize();

    // 检查登录状态
    const isLoggedIn = await this.checkLoginStatus();
    if (isLoggedIn) {
      this.scheduleProactiveRefresh(this.cookieManager.getActiveAccountId());
    }
    this._onDidChangeLoginState.fire(isLoggedIn);
  }

  async switchAccount(accountId: AccountId): Promise<void> {
    await this.cookieManager.setActiveAccountId(accountId);
    await getAccountMetaManager().setActiveAccountId(accountId);
    await this.cookieManager.getCookies();
    this._onDidChangeLoginState.fire(await this.checkLoginStatus());
  }

  async listAccounts(): Promise<AccountProfile[]> {
    return getAccountMetaManager().listAccounts();
  }

  async removeAccount(accountId: AccountId): Promise<void> {
    const normalized = String(accountId || '').trim();
    if (!normalized) {
      return;
    }
    const wasActive = this.cookieManager.getActiveAccountId() === normalized;
    await this.cookieManager.clearCookiesForAccount(normalized);
    await this.cookieManager.clearSimpleBrowserAuthForAccount(normalized);
    await getAccountMetaManager().removeAccount(normalized);
    this.stopProactiveRefresh(normalized);
    if (wasActive) {
      const next = getAccountMetaManager().listAccounts()[0]?.accountId;
      if (next) {
        await this.switchAccount(next);
      } else {
        await this.cookieManager.clearActiveAccountId();
        await this.cookieManager.clearUserInfo();
        this._onDidChangeLoginState.fire(false);
      }
    }
  }

  async checkLoginStatusForAccount(accountId: AccountId, options?: { strict?: boolean }): Promise<boolean> {
    return this.runWithAccount(accountId, async () => this.checkLoginStatus(options));
  }

  async logoutAccount(accountId: AccountId): Promise<void> {
    const normalized = String(accountId || '').trim();
    if (!normalized) {
      return;
    }
    await this.cookieManager.clearCookiesForAccount(normalized);
    await this.cookieManager.clearSimpleBrowserAuthForAccount(normalized);
    await this.cookieManager.updateAuthMeta(
      { lastVerifiedAt: 0, lastRefreshAt: 0, refreshFailureCount: 0, refreshBackoffUntil: 0 },
      normalized
    );
    this.stopProactiveRefresh(normalized);
    if (this.cookieManager.getActiveAccountId() === normalized) {
      await this.cookieManager.clearUserInfo();
      this._onDidChangeLoginState.fire(false);
    }
  }

  /**
   * 检查登录状态
   */
  async checkLoginStatus(options?: { strict?: boolean }): Promise<boolean> {
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
      let isValid = await checkLoginStatus();
      if (!isValid && strict) {
        await this.refreshCookiesWithRiskControl(now, { force: true }, accountId);
        isValid = await checkLoginStatus();
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
    } catch (error) {
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
  async login(): Promise<boolean> {
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
  async loginByProtocol(): Promise<boolean> {
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
  async loginByCookie(): Promise<boolean> {
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
  async logout(): Promise<void> {
    this.clearLoginStateRetry();
    const activeAccountId = this.cookieManager.getActiveAccountId();
    if (activeAccountId) {
      await this.logoutAccount(activeAccountId);
    } else {
      await this.cookieManager.logout();
    }
    this._onDidChangeLoginState.fire(false);
    vscode.window.showInformationMessage(t('auth_logout_success'));
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
  async requireLogin(): Promise<boolean> {
    const isLoggedIn = await this.checkLoginStatus();
    if (isLoggedIn) {
      return true;
    }

    const result = await vscode.window.showInformationMessage(
      t('auth_require_login'),
      t('auth_login_now'),
      t('common_cancel')
    );

    if (result === t('auth_login_now')) {
      return await this.login();
    }

    return false;
  }

  /**
   * 更新 VSCode 上下文状态
   */
  async updateContext(): Promise<void> {
    const hasCookies = await this.cookieManager.isLoggedIn();
    const isLoggedIn = hasCookies || await this.checkLoginStatus();
    await vscode.commands.executeCommand(
      'setContext',
      'weread:loggedIn',
      isLoggedIn
    );
  }

  private emitLoginStateWithRetry(expectedState: boolean): void {
    this.clearLoginStateRetry();
    this._onDidChangeLoginState.fire(expectedState);
    if (!expectedState) {
      return;
    }

    this.loginStateRetryTimer = setTimeout(() => {
      void this.revalidateAndBroadcastLoginState(expectedState);
    }, 1200);
  }

  private async revalidateAndBroadcastLoginState(expectedState: boolean): Promise<void> {
    this.loginStateRetryTimer = undefined;
    try {
      const currentState = await this.checkLoginStatus();
      this._onDidChangeLoginState.fire(currentState);
      if (expectedState && !currentState) {
        this.loginStateRetryTimer = setTimeout(() => {
          void this.revalidateAndBroadcastLoginState(expectedState);
        }, 2500);
      }
    } catch {
      this._onDidChangeLoginState.fire(expectedState);
      this.loginStateRetryTimer = setTimeout(() => {
        void this.revalidateAndBroadcastLoginState(expectedState);
      }, 2500);
    }
  }

  private clearLoginStateRetry(): void {
    if (this.loginStateRetryTimer) {
      clearTimeout(this.loginStateRetryTimer);
      this.loginStateRetryTimer = undefined;
    }
  }

  private async refreshCookiesWithRiskControl(
    now: number,
    options?: { force?: boolean },
    accountId?: AccountId
  ): Promise<void> {
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
      } catch {
        const latest = await this.cookieManager.getAuthMeta(targetAccountId);
        const nextFailure = latest.refreshFailureCount + 1;
        const backoff = Math.min(
          AuthManager.MAX_BACKOFF_MS,
          AuthManager.BASE_BACKOFF_MS * Math.pow(2, Math.max(0, nextFailure - 1))
        );
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
    } finally {
      this.refreshInFlights.delete(targetAccountId);
    }
  }

  private async isWithinGracePeriod(now: number): Promise<boolean> {
    const meta = await this.cookieManager.getAuthMeta();
    return now - meta.lastVerifiedAt <= AuthManager.VERIFY_GRACE_MS;
  }

  private scheduleProactiveRefresh(accountId?: AccountId, delayMs?: number): void {
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

  private stopProactiveRefresh(accountId?: AccountId): void {
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

  private async runProactiveRefreshTick(accountId: AccountId): Promise<void> {
    const hasCookies = !!(await this.cookieManager.getCookiesForAccount(accountId));
    if (!hasCookies) {
      this.stopProactiveRefresh(accountId);
      return;
    }
    await this.refreshCookiesWithRiskControl(Date.now(), undefined, accountId);
    this.scheduleProactiveRefresh(accountId);
  }

  dispose(): void {
    this.clearLoginStateRetry();
    this.stopProactiveRefresh();
    this._onDidChangeLoginState.dispose();
  }

  private async runWithAccount<T>(accountId: AccountId, run: () => Promise<T>): Promise<T> {
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
    } finally {
      if (prev) {
        await this.cookieManager.setActiveAccountId(prev);
        await this.cookieManager.getCookies();
      } else {
        await this.cookieManager.clearActiveAccountId();
      }
    }
  }
}

let authManagerInstance: AuthManager | undefined;

export function initializeAuthManager(cookieManager: CookieManager): AuthManager {
  authManagerInstance = new AuthManager(cookieManager);
  return authManagerInstance;
}

export function getAuthManager(): AuthManager {
  if (!authManagerInstance) {
    throw new Error('AuthManager not initialized');
  }
  return authManagerInstance;
}
