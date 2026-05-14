import * as vscode from 'vscode';
import { ACCOUNT_META_VERSION, AccountId, AccountProfile, AccountsMeta } from '../types/account';

const APP_PREFIX = 'weread.vscode';
export const ACCOUNTS_META_KEY = `${APP_PREFIX}.accounts.meta`;
export const ACTIVE_ACCOUNT_ID_KEY = `${APP_PREFIX}.activeAccountId`;

function normalizeAccountProfile(profile: AccountProfile): AccountProfile {
  const now = Date.now();
  return {
    accountId: String(profile.accountId || '').trim(),
    userId: profile.userId ? String(profile.userId).trim() : undefined,
    wrVid: profile.wrVid ? String(profile.wrVid).trim() : undefined,
    displayName: String(profile.displayName || '').trim() || '微信读书用户',
    avatar: profile.avatar ? String(profile.avatar).trim() : undefined,
    createdAt: Number(profile.createdAt || now),
    lastUsedAt: Number(profile.lastUsedAt || now),
  };
}

export class AccountMetaManager {
  private readonly globalState: vscode.Memento;

  constructor(context: vscode.ExtensionContext) {
    this.globalState = context.globalState;
  }

  listAccounts(): AccountProfile[] {
    const meta = this.getAccountsMeta();
    return [...meta.accounts].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  async addAccount(profile: AccountProfile): Promise<void> {
    const normalized = normalizeAccountProfile(profile);
    if (!normalized.accountId) {
      throw new Error('无效账号：accountId 不能为空');
    }
    const meta = this.getAccountsMeta();
    const existingIndex = meta.accounts.findIndex((item) => item.accountId === normalized.accountId);
    if (existingIndex >= 0) {
      const existing = meta.accounts[existingIndex];
      meta.accounts[existingIndex] = {
        ...existing,
        ...normalized,
        createdAt: existing.createdAt || normalized.createdAt,
        lastUsedAt: Date.now(),
      };
    } else {
      meta.accounts.push({
        ...normalized,
        createdAt: normalized.createdAt || Date.now(),
        lastUsedAt: normalized.lastUsedAt || Date.now(),
      });
    }
    await this.globalState.update(ACCOUNTS_META_KEY, meta);
  }

  async updateAccount(accountId: AccountId, patch: Partial<AccountProfile>): Promise<void> {
    const id = String(accountId || '').trim();
    if (!id) {
      throw new Error('无效账号：accountId 不能为空');
    }
    const meta = this.getAccountsMeta();
    const index = meta.accounts.findIndex((item) => item.accountId === id);
    if (index < 0) {
      throw new Error(`账号不存在：${id}`);
    }
    const current = meta.accounts[index];
    meta.accounts[index] = normalizeAccountProfile({
      ...current,
      ...patch,
      accountId: id,
      createdAt: current.createdAt,
      lastUsedAt: patch.lastUsedAt || Date.now(),
    });
    await this.globalState.update(ACCOUNTS_META_KEY, meta);
  }

  async removeAccount(accountId: AccountId): Promise<void> {
    const id = String(accountId || '').trim();
    if (!id) {
      return;
    }
    const meta = this.getAccountsMeta();
    const nextAccounts = meta.accounts.filter((item) => item.accountId !== id);
    await this.globalState.update(ACCOUNTS_META_KEY, {
      version: ACCOUNT_META_VERSION,
      accounts: nextAccounts,
    } as AccountsMeta);
    if (this.getActiveAccountId() === id) {
      await this.clearActiveAccountId();
    }
  }

  async setActiveAccountId(accountId: AccountId): Promise<void> {
    const id = String(accountId || '').trim();
    if (!id) {
      throw new Error('无效账号：accountId 不能为空');
    }
    await this.globalState.update(ACTIVE_ACCOUNT_ID_KEY, id);
    const meta = this.getAccountsMeta();
    const index = meta.accounts.findIndex((item) => item.accountId === id);
    if (index >= 0) {
      meta.accounts[index] = {
        ...meta.accounts[index],
        lastUsedAt: Date.now(),
      };
      await this.globalState.update(ACCOUNTS_META_KEY, meta);
    }
  }

  getActiveAccountId(): AccountId | undefined {
    const raw = this.globalState.get<string>(ACTIVE_ACCOUNT_ID_KEY);
    const id = String(raw || '').trim();
    return id || undefined;
  }

  async clearActiveAccountId(): Promise<void> {
    await this.globalState.update(ACTIVE_ACCOUNT_ID_KEY, undefined);
  }

  private getAccountsMeta(): AccountsMeta {
    const raw = this.globalState.get<AccountsMeta>(ACCOUNTS_META_KEY);
    if (!raw || !Array.isArray(raw.accounts)) {
      return {
        version: ACCOUNT_META_VERSION,
        accounts: [],
      };
    }
    return {
      version: ACCOUNT_META_VERSION,
      accounts: raw.accounts
        .map((item) => normalizeAccountProfile(item))
        .filter((item) => !!item.accountId),
    };
  }
}

let accountMetaManagerInstance: AccountMetaManager | undefined;

export function initializeAccountMetaManager(context: vscode.ExtensionContext): AccountMetaManager {
  accountMetaManagerInstance = new AccountMetaManager(context);
  return accountMetaManagerInstance;
}

export function getAccountMetaManager(): AccountMetaManager {
  if (!accountMetaManagerInstance) {
    throw new Error('AccountMetaManager not initialized');
  }
  return accountMetaManagerInstance;
}
