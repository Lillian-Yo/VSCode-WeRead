import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getAccountMetaManager } from './accountMetaManager';
import { getCookieManager, SimpleBrowserAuthPayload } from '../auth';
import { getConfiguredOutputPath } from '../utils';
import { AccountId } from '../types/account';

const APP_PREFIX = 'weread.vscode';
const LEGACY_COOKIE_KEY = `${APP_PREFIX}.cookies`;
const LEGACY_SIMPLE_BROWSER_AUTH_KEY = `${APP_PREFIX}.simpleBrowserAuth`;
const LEGACY_AUTH_META_KEY = `${APP_PREFIX}.authMeta`;
const MIGRATED_KEY = `${APP_PREFIX}.multiAccountMigrated`;
const SNAPSHOT_KEY = `${APP_PREFIX}.multiAccountMigrationSnapshot`;

const LEGACY_STORAGE_KEYS = [
  'weread.books',
  'weread.notes',
  'weread.syncState',
  'weread.dailyAgg',
  'weread.index.version',
  'weread.index.snapshot',
  'weread.index.scanState',
] as const;

type MigrationSnapshot = {
  accountId: AccountId;
  previousActiveAccountId?: string;
  movedFsEntries: string[];
  copiedStorageKeys: string[];
};

export class AccountMigrationService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async checkNeedMigration(): Promise<boolean> {
    if (this.context.globalState.get<boolean>(MIGRATED_KEY, false)) {
      return false;
    }
    if (getAccountMetaManager().listAccounts().length > 0) {
      return false;
    }
    const secrets = await this.context.secrets.keys();
    const hasLegacySecret = secrets.includes(LEGACY_COOKIE_KEY) || secrets.includes(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
    const hasLegacyStorage = LEGACY_STORAGE_KEYS.some((key) => this.context.globalState.get(key) !== undefined);
    return hasLegacySecret || hasLegacyStorage;
  }

  async migrateSingleToMultiAccount(): Promise<{ success: boolean; accountId?: AccountId; error?: string }> {
    const cookieManager = getCookieManager();
    const accountManager = getAccountMetaManager();
    const accountId = await this.resolveAccountId();
    if (!accountId) {
      return { success: false, error: '无法识别历史账号标识，迁移已跳过' };
    }

    const snapshot: MigrationSnapshot = {
      accountId,
      previousActiveAccountId: cookieManager.getActiveAccountId(),
      movedFsEntries: [],
      copiedStorageKeys: [],
    };
    await this.context.globalState.update(SNAPSHOT_KEY, snapshot);

    try {
      await accountManager.addAccount({
        accountId,
        userId: cookieManager.getUserInfo()?.userId || accountId,
        displayName: cookieManager.getUserInfo()?.name || '微信读书用户',
        avatar: cookieManager.getUserInfo()?.avatar,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      });
      await accountManager.setActiveAccountId(accountId);
      await cookieManager.setActiveAccountId(accountId);

      const legacyCookies = await this.context.secrets.get(LEGACY_COOKIE_KEY);
      if (legacyCookies) {
        await cookieManager.saveCookiesForAccount(accountId, legacyCookies);
        await this.context.secrets.delete(LEGACY_COOKIE_KEY);
      }

      const legacySimpleAuthRaw = await this.context.secrets.get(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
      if (legacySimpleAuthRaw) {
        try {
          const payload = JSON.parse(legacySimpleAuthRaw) as SimpleBrowserAuthPayload;
          await cookieManager.saveSimpleBrowserAuthForAccount(accountId, {
            cookies: payload.cookies,
            token: payload.token,
            refreshToken: payload.refreshToken,
            session: payload.session,
            expiresAt: payload.expiresAt,
          });
        } catch {
          // ignore malformed legacy data
        }
        await this.context.secrets.delete(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
      }

      const legacyAuthMeta = this.context.globalState.get<unknown>(LEGACY_AUTH_META_KEY);
      if (legacyAuthMeta) {
        await cookieManager.updateAuthMeta(legacyAuthMeta as Record<string, unknown>, accountId);
        await this.context.globalState.update(LEGACY_AUTH_META_KEY, undefined);
      }

      for (const key of LEGACY_STORAGE_KEYS) {
        const legacyValue = this.context.globalState.get<unknown>(key);
        if (legacyValue === undefined) {
          continue;
        }
        const scopedKey = `${key}.${accountId}`;
        if (this.context.globalState.get(scopedKey) !== undefined) {
          continue;
        }
        await this.context.globalState.update(scopedKey, legacyValue);
        snapshot.copiedStorageKeys.push(scopedKey);
      }

      const movedFsEntries = await this.moveLegacyOutputToAccountDir(accountId);
      snapshot.movedFsEntries.push(...movedFsEntries);
      await this.context.globalState.update(SNAPSHOT_KEY, snapshot);

      await this.context.globalState.update(MIGRATED_KEY, true);
      return { success: true, accountId };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知迁移错误';
      await this.rollbackMigration();
      return { success: false, accountId, error: message };
    }
  }

  async rollbackMigration(): Promise<void> {
    const snapshot = this.context.globalState.get<MigrationSnapshot>(SNAPSHOT_KEY);
    if (!snapshot) {
      return;
    }

    const outputPath = getConfiguredOutputPath();
    if (outputPath) {
      const accountRoot = path.join(outputPath, 'accounts', snapshot.accountId);
      for (const name of snapshot.movedFsEntries) {
        const from = path.join(accountRoot, name);
        const to = path.join(outputPath, name);
        try {
          if (await this.pathExists(from) && !(await this.pathExists(to))) {
            await fs.promises.rename(from, to);
          }
        } catch {
          // ignore best-effort rollback failure
        }
      }
    }

    for (const key of snapshot.copiedStorageKeys) {
      await this.context.globalState.update(key, undefined);
    }

    await getAccountMetaManager().removeAccount(snapshot.accountId);
    if (snapshot.previousActiveAccountId) {
      await getAccountMetaManager().setActiveAccountId(snapshot.previousActiveAccountId);
      await getCookieManager().setActiveAccountId(snapshot.previousActiveAccountId);
    } else {
      await getCookieManager().clearActiveAccountId();
    }

    await this.context.globalState.update(MIGRATED_KEY, undefined);
    await this.context.globalState.update(SNAPSHOT_KEY, undefined);
  }

  private async resolveAccountId(): Promise<AccountId | undefined> {
    const userInfo = getCookieManager().getUserInfo();
    const userId = String(userInfo?.userId || '').trim();
    if (userId) {
      return userId;
    }
    const lastFields = await getCookieManager().getLastCookieLoginFields();
    const wrVid = String(lastFields?.wrVid || '').trim();
    if (wrVid) {
      return wrVid;
    }
    return undefined;
  }

  private async moveLegacyOutputToAccountDir(accountId: AccountId): Promise<string[]> {
    const outputPath = getConfiguredOutputPath();
    if (!outputPath) {
      return [];
    }
    const entries = await fs.promises.readdir(outputPath, { withFileTypes: true }).catch(() => []);
    const accountRoot = path.join(outputPath, 'accounts', accountId);
    await fs.promises.mkdir(accountRoot, { recursive: true });
    const moved: string[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (name === 'accounts') {
        continue;
      }
      const from = path.join(outputPath, name);
      const to = path.join(accountRoot, name);
      if (await this.pathExists(to)) {
        continue;
      }
      await fs.promises.rename(from, to).catch(() => undefined);
      if (await this.pathExists(to)) {
        moved.push(name);
      }
    }
    return moved;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.promises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}

let accountMigrationServiceInstance: AccountMigrationService | undefined;

export function initializeAccountMigrationService(context: vscode.ExtensionContext): AccountMigrationService {
  accountMigrationServiceInstance = new AccountMigrationService(context);
  return accountMigrationServiceInstance;
}

export function getAccountMigrationService(): AccountMigrationService {
  if (!accountMigrationServiceInstance) {
    throw new Error('AccountMigrationService not initialized');
  }
  return accountMigrationServiceInstance;
}
