/**
 * Cookie 管理
 * 使用 VSCode SecretStorage 安全存储登录凭证
 */

import * as vscode from 'vscode';
import { apiClient } from '../api';
import { AccountId } from '../types/account';

const APP_PREFIX = 'weread.vscode';
const LEGACY_COOKIE_KEY = `${APP_PREFIX}.cookies`;
const USER_INFO_KEY = `${APP_PREFIX}.userInfo`;
const LAST_COOKIE_LOGIN_FIELDS_KEY = `${APP_PREFIX}.lastCookieLoginFields`;
const LEGACY_AUTH_META_KEY = `${APP_PREFIX}.authMeta`;
const LOGIN_STATE_KEY = `${APP_PREFIX}.loggedIn`;
const LEGACY_SIMPLE_BROWSER_AUTH_KEY = `${APP_PREFIX}.simpleBrowserAuth`;
const ACTIVE_ACCOUNT_ID_KEY = `${APP_PREFIX}.activeAccountId`;
const fetchFn = (globalThis as any).fetch as (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  }
) => Promise<{
  headers: {
    getSetCookie?: () => string[];
    get(name: string): string | null;
  };
}>;

export interface UserInfo {
  userId: string;
  name: string;
  avatar: string;
}

export interface LastCookieLoginFields {
  wrVid: string;
  wrSkey: string;
}

export interface AuthMeta {
  lastVerifiedAt: number;
  lastRefreshAt: number;
  refreshFailureCount: number;
  refreshBackoffUntil: number;
}

export interface SimpleBrowserAuthPayload {
  cookies: string;
  session?: string;
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  savedAt: number;
}

export class CookieManager {
  private secretStorage: vscode.SecretStorage;
  private globalState: vscode.Memento;
  private simpleBrowserAuthCache: SimpleBrowserAuthPayload | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
    this.globalState = context.globalState;
  }

  /**
   * 保存 Cookie
   */
  async saveCookies(cookies: string): Promise<void> {
    const activeAccountId = this.getActiveAccountId();
    if (!activeAccountId) {
      await this.secretStorage.store(LEGACY_COOKIE_KEY, cookies);
      apiClient.setCookies(cookies);
      await this.setLoggedInState(true);
      return;
    }
    await this.saveCookiesForAccount(activeAccountId, cookies);
  }

  async saveCookiesForAccount(accountId: AccountId, cookies: string): Promise<void> {
    const key = this.getAccountCookieKey(accountId);
    await this.secretStorage.store(key, cookies);
    if (this.getActiveAccountId() === this.normalizeAccountId(accountId)) {
      apiClient.setCookies(cookies);
    }
    await this.setLoggedInState(true);
  }

  /**
   * 获取 Cookie
   */
  async getCookies(): Promise<string | undefined> {
    const activeAccountId = this.getActiveAccountId();
    const cookies = activeAccountId
      ? await this.getCookiesForAccount(activeAccountId)
      : await this.secretStorage.get(LEGACY_COOKIE_KEY);
    if (cookies) {
      apiClient.setCookies(cookies);
    }
    return cookies;
  }

  async getCookiesForAccount(accountId: AccountId): Promise<string | undefined> {
    const key = this.getAccountCookieKey(accountId);
    return this.secretStorage.get(key);
  }

  /**
   * 清除 Cookie
   */
  async clearCookies(): Promise<void> {
    const activeAccountId = this.getActiveAccountId();
    if (!activeAccountId) {
      await this.secretStorage.delete(LEGACY_COOKIE_KEY);
      apiClient.clearCookies();
      await this.setLoggedInState(false);
      return;
    }
    await this.clearCookiesForAccount(activeAccountId);
  }

  async clearCookiesForAccount(accountId: AccountId): Promise<void> {
    const key = this.getAccountCookieKey(accountId);
    await this.secretStorage.delete(key);
    if (this.getActiveAccountId() === this.normalizeAccountId(accountId)) {
      apiClient.clearCookies();
      await this.setLoggedInState(false);
    }
  }

  async setActiveAccountId(accountId: AccountId): Promise<void> {
    const id = this.normalizeAccountId(accountId);
    if (!id) {
      throw new Error('无效账号：accountId 不能为空');
    }
    this.simpleBrowserAuthCache = undefined;
    await this.globalState.update(ACTIVE_ACCOUNT_ID_KEY, id);
  }

  getActiveAccountId(): AccountId | undefined {
    const raw = this.globalState.get<string>(ACTIVE_ACCOUNT_ID_KEY);
    const normalized = this.normalizeAccountId(raw);
    return normalized || undefined;
  }

  async clearActiveAccountId(): Promise<void> {
    this.simpleBrowserAuthCache = undefined;
    await this.globalState.update(ACTIVE_ACCOUNT_ID_KEY, undefined);
  }

  async saveSimpleBrowserAuth(payload: Omit<SimpleBrowserAuthPayload, 'savedAt'>): Promise<void> {
    const activeAccountId = this.getActiveAccountId();
    if (!activeAccountId) {
      const normalized: SimpleBrowserAuthPayload = {
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

  async saveSimpleBrowserAuthForAccount(
    accountId: AccountId,
    payload: Omit<SimpleBrowserAuthPayload, 'savedAt'>
  ): Promise<void> {
    const normalized: SimpleBrowserAuthPayload = {
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

  async getSimpleBrowserAuth(): Promise<SimpleBrowserAuthPayload | undefined> {
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

  async getSimpleBrowserAuthForAccount(accountId: AccountId): Promise<SimpleBrowserAuthPayload | undefined> {
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

  async clearSimpleBrowserAuth(): Promise<void> {
    const activeAccountId = this.getActiveAccountId();
    if (!activeAccountId) {
      this.simpleBrowserAuthCache = undefined;
      await this.secretStorage.delete(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
      await this.setLoggedInState(false);
      return;
    }
    await this.clearSimpleBrowserAuthForAccount(activeAccountId);
  }

  async clearSimpleBrowserAuthForAccount(accountId: AccountId): Promise<void> {
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

  async setLoggedInState(loggedIn: boolean): Promise<void> {
    await this.globalState.update(LOGIN_STATE_KEY, loggedIn);
  }

  getLoggedInState(): boolean {
    return !!this.globalState.get<boolean>(LOGIN_STATE_KEY, false);
  }

  /**
   * 保存用户信息
   */
  async saveUserInfo(userInfo: UserInfo): Promise<void> {
    await this.globalState.update(USER_INFO_KEY, userInfo);
  }

  /**
   * 保存最近一次粘贴 Cookie 登录输入
   */
  async saveLastCookieLoginFields(fields: LastCookieLoginFields): Promise<void> {
    await this.secretStorage.store(LAST_COOKIE_LOGIN_FIELDS_KEY, JSON.stringify(fields));
  }

  /**
   * 获取最近一次粘贴 Cookie 登录输入
   */
  async getLastCookieLoginFields(): Promise<LastCookieLoginFields | undefined> {
    const raw = await this.secretStorage.get(LAST_COOKIE_LOGIN_FIELDS_KEY);
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<LastCookieLoginFields>;
      const wrVid = String(parsed.wrVid || '').trim();
      const wrSkey = String(parsed.wrSkey || '').trim();
      if (!wrVid || !wrSkey) {
        return undefined;
      }
      return { wrVid, wrSkey };
    } catch {
      return undefined;
    }
  }

  async getAuthMeta(accountId?: AccountId): Promise<AuthMeta> {
    const activeAccountId = accountId || this.getActiveAccountId();
    const key = activeAccountId ? this.getAccountAuthMetaKey(activeAccountId) : LEGACY_AUTH_META_KEY;
    const raw = this.globalState.get<Partial<AuthMeta>>(key, {});
    return {
      lastVerifiedAt: Number(raw.lastVerifiedAt || 0),
      lastRefreshAt: Number(raw.lastRefreshAt || 0),
      refreshFailureCount: Number(raw.refreshFailureCount || 0),
      refreshBackoffUntil: Number(raw.refreshBackoffUntil || 0),
    };
  }

  async updateAuthMeta(patch: Partial<AuthMeta>, accountId?: AccountId): Promise<void> {
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
  getUserInfo(): UserInfo | undefined {
    return this.globalState.get<UserInfo>(USER_INFO_KEY);
  }

  /**
   * 清除用户信息
   */
  async clearUserInfo(): Promise<void> {
    await this.globalState.update(USER_INFO_KEY, undefined);
  }

  /**
   * 检查是否已登录
   */
  async isLoggedIn(): Promise<boolean> {
    const cookies = await this.getCookies();
    return !!cookies && cookies.length > 0;
  }

  /**
   * 初始化（从存储加载 Cookie）
   */
  async initialize(): Promise<void> {
    const cookies = await this.getCookies();
    if (cookies) {
      apiClient.setCookies(cookies);
      await this.setLoggedInState(true);
      return;
    }
    await this.setLoggedInState(false);
  }

  /**
   * 向官方网页请求刷新 Cookie（主要刷新 wr_skey）
   */
  async refreshCookiesFromServer(): Promise<void> {
    const current = await this.getCookies();
    if (!current) {
      return;
    }

    const response = await fetchFn('https://weread.qq.com/', {
      method: 'HEAD',
      headers: { Cookie: current },
    });

    const setCookie =
      response.headers.getSetCookie?.() ??
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

  private mergeCookieString(current: string, setCookie: string[]): string {
    const map = new Map<string, string>();
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
  async logout(): Promise<void> {
    const activeAccountId = this.getActiveAccountId();
    if (activeAccountId) {
      await this.clearCookiesForAccount(activeAccountId);
      await this.clearSimpleBrowserAuthForAccount(activeAccountId);
    } else {
      await this.clearCookies();
      await this.clearSimpleBrowserAuth();
    }
    await this.clearUserInfo();
    const currentAccountId = this.getActiveAccountId();
    if (currentAccountId) {
      await this.globalState.update(this.getAccountAuthMetaKey(currentAccountId), undefined);
    } else {
      await this.globalState.update(LEGACY_AUTH_META_KEY, undefined);
    }
    await this.globalState.update(LOGIN_STATE_KEY, false);
  }

  private parseSimpleBrowserAuth(raw: string): SimpleBrowserAuthPayload | undefined {
    try {
      const parsed = JSON.parse(raw) as Partial<SimpleBrowserAuthPayload>;
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
    } catch {
      return undefined;
    }
  }

  private getAccountCookieKey(accountId: AccountId): string {
    const normalized = this.normalizeAccountId(accountId);
    if (!normalized) {
      throw new Error('无效账号：accountId 不能为空');
    }
    return `${APP_PREFIX}.${normalized}.cookies`;
  }

  private getAccountSimpleBrowserAuthKey(accountId: AccountId): string {
    const normalized = this.normalizeAccountId(accountId);
    if (!normalized) {
      throw new Error('无效账号：accountId 不能为空');
    }
    return `${APP_PREFIX}.${normalized}.simpleBrowserAuth`;
  }

  private getAccountAuthMetaKey(accountId: AccountId): string {
    const normalized = this.normalizeAccountId(accountId);
    if (!normalized) {
      throw new Error('无效账号：accountId 不能为空');
    }
    return `${APP_PREFIX}.${normalized}.authMeta`;
  }

  private normalizeAccountId(accountId: unknown): string {
    return String(accountId || '').trim();
  }
}

let cookieManagerInstance: CookieManager | undefined;

export function initializeCookieManager(context: vscode.ExtensionContext): CookieManager {
  cookieManagerInstance = new CookieManager(context);
  return cookieManagerInstance;
}

export function getCookieManager(): CookieManager {
  if (!cookieManagerInstance) {
    throw new Error('CookieManager not initialized');
  }
  return cookieManagerInstance;
}
