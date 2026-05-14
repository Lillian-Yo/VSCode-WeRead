"use strict";
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
exports.getAccountMigrationService = exports.initializeAccountMigrationService = exports.AccountMigrationService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const accountMetaManager_1 = require("./accountMetaManager");
const auth_1 = require("../auth");
const utils_1 = require("../utils");
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
];
class AccountMigrationService {
    constructor(context) {
        this.context = context;
    }
    async checkNeedMigration() {
        if (this.context.globalState.get(MIGRATED_KEY, false)) {
            return false;
        }
        if ((0, accountMetaManager_1.getAccountMetaManager)().listAccounts().length > 0) {
            return false;
        }
        const secrets = await this.context.secrets.keys();
        const hasLegacySecret = secrets.includes(LEGACY_COOKIE_KEY) || secrets.includes(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
        const hasLegacyStorage = LEGACY_STORAGE_KEYS.some((key) => this.context.globalState.get(key) !== undefined);
        return hasLegacySecret || hasLegacyStorage;
    }
    async migrateSingleToMultiAccount() {
        const cookieManager = (0, auth_1.getCookieManager)();
        const accountManager = (0, accountMetaManager_1.getAccountMetaManager)();
        const accountId = await this.resolveAccountId();
        if (!accountId) {
            return { success: false, error: '无法识别历史账号标识，迁移已跳过' };
        }
        const snapshot = {
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
                    const payload = JSON.parse(legacySimpleAuthRaw);
                    await cookieManager.saveSimpleBrowserAuthForAccount(accountId, {
                        cookies: payload.cookies,
                        token: payload.token,
                        refreshToken: payload.refreshToken,
                        session: payload.session,
                        expiresAt: payload.expiresAt,
                    });
                }
                catch {
                    // ignore malformed legacy data
                }
                await this.context.secrets.delete(LEGACY_SIMPLE_BROWSER_AUTH_KEY);
            }
            const legacyAuthMeta = this.context.globalState.get(LEGACY_AUTH_META_KEY);
            if (legacyAuthMeta) {
                await cookieManager.updateAuthMeta(legacyAuthMeta, accountId);
                await this.context.globalState.update(LEGACY_AUTH_META_KEY, undefined);
            }
            for (const key of LEGACY_STORAGE_KEYS) {
                const legacyValue = this.context.globalState.get(key);
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '未知迁移错误';
            await this.rollbackMigration();
            return { success: false, accountId, error: message };
        }
    }
    async rollbackMigration() {
        const snapshot = this.context.globalState.get(SNAPSHOT_KEY);
        if (!snapshot) {
            return;
        }
        const outputPath = (0, utils_1.getConfiguredOutputPath)();
        if (outputPath) {
            const accountRoot = path.join(outputPath, 'accounts', snapshot.accountId);
            for (const name of snapshot.movedFsEntries) {
                const from = path.join(accountRoot, name);
                const to = path.join(outputPath, name);
                try {
                    if (await this.pathExists(from) && !(await this.pathExists(to))) {
                        await fs.promises.rename(from, to);
                    }
                }
                catch {
                    // ignore best-effort rollback failure
                }
            }
        }
        for (const key of snapshot.copiedStorageKeys) {
            await this.context.globalState.update(key, undefined);
        }
        await (0, accountMetaManager_1.getAccountMetaManager)().removeAccount(snapshot.accountId);
        if (snapshot.previousActiveAccountId) {
            await (0, accountMetaManager_1.getAccountMetaManager)().setActiveAccountId(snapshot.previousActiveAccountId);
            await (0, auth_1.getCookieManager)().setActiveAccountId(snapshot.previousActiveAccountId);
        }
        else {
            await (0, auth_1.getCookieManager)().clearActiveAccountId();
        }
        await this.context.globalState.update(MIGRATED_KEY, undefined);
        await this.context.globalState.update(SNAPSHOT_KEY, undefined);
    }
    async resolveAccountId() {
        const userInfo = (0, auth_1.getCookieManager)().getUserInfo();
        const userId = String(userInfo?.userId || '').trim();
        if (userId) {
            return userId;
        }
        const lastFields = await (0, auth_1.getCookieManager)().getLastCookieLoginFields();
        const wrVid = String(lastFields?.wrVid || '').trim();
        if (wrVid) {
            return wrVid;
        }
        return undefined;
    }
    async moveLegacyOutputToAccountDir(accountId) {
        const outputPath = (0, utils_1.getConfiguredOutputPath)();
        if (!outputPath) {
            return [];
        }
        const entries = await fs.promises.readdir(outputPath, { withFileTypes: true }).catch(() => []);
        const accountRoot = path.join(outputPath, 'accounts', accountId);
        await fs.promises.mkdir(accountRoot, { recursive: true });
        const moved = [];
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
    async pathExists(targetPath) {
        try {
            await fs.promises.access(targetPath);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.AccountMigrationService = AccountMigrationService;
let accountMigrationServiceInstance;
function initializeAccountMigrationService(context) {
    accountMigrationServiceInstance = new AccountMigrationService(context);
    return accountMigrationServiceInstance;
}
exports.initializeAccountMigrationService = initializeAccountMigrationService;
function getAccountMigrationService() {
    if (!accountMigrationServiceInstance) {
        throw new Error('AccountMigrationService not initialized');
    }
    return accountMigrationServiceInstance;
}
exports.getAccountMigrationService = getAccountMigrationService;
//# sourceMappingURL=accountMigrationService.js.map