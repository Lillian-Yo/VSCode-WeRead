"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountMetaManager = exports.initializeAccountMetaManager = exports.AccountMetaManager = exports.ACTIVE_ACCOUNT_ID_KEY = exports.ACCOUNTS_META_KEY = void 0;
const account_1 = require("../types/account");
const APP_PREFIX = 'weread.vscode';
exports.ACCOUNTS_META_KEY = `${APP_PREFIX}.accounts.meta`;
exports.ACTIVE_ACCOUNT_ID_KEY = `${APP_PREFIX}.activeAccountId`;
function normalizeAccountProfile(profile) {
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
class AccountMetaManager {
    constructor(context) {
        this.globalState = context.globalState;
    }
    listAccounts() {
        const meta = this.getAccountsMeta();
        return [...meta.accounts].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    }
    async addAccount(profile) {
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
        }
        else {
            meta.accounts.push({
                ...normalized,
                createdAt: normalized.createdAt || Date.now(),
                lastUsedAt: normalized.lastUsedAt || Date.now(),
            });
        }
        await this.globalState.update(exports.ACCOUNTS_META_KEY, meta);
    }
    async updateAccount(accountId, patch) {
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
        await this.globalState.update(exports.ACCOUNTS_META_KEY, meta);
    }
    async removeAccount(accountId) {
        const id = String(accountId || '').trim();
        if (!id) {
            return;
        }
        const meta = this.getAccountsMeta();
        const nextAccounts = meta.accounts.filter((item) => item.accountId !== id);
        await this.globalState.update(exports.ACCOUNTS_META_KEY, {
            version: account_1.ACCOUNT_META_VERSION,
            accounts: nextAccounts,
        });
        if (this.getActiveAccountId() === id) {
            await this.clearActiveAccountId();
        }
    }
    async setActiveAccountId(accountId) {
        const id = String(accountId || '').trim();
        if (!id) {
            throw new Error('无效账号：accountId 不能为空');
        }
        await this.globalState.update(exports.ACTIVE_ACCOUNT_ID_KEY, id);
        const meta = this.getAccountsMeta();
        const index = meta.accounts.findIndex((item) => item.accountId === id);
        if (index >= 0) {
            meta.accounts[index] = {
                ...meta.accounts[index],
                lastUsedAt: Date.now(),
            };
            await this.globalState.update(exports.ACCOUNTS_META_KEY, meta);
        }
    }
    getActiveAccountId() {
        const raw = this.globalState.get(exports.ACTIVE_ACCOUNT_ID_KEY);
        const id = String(raw || '').trim();
        return id || undefined;
    }
    async clearActiveAccountId() {
        await this.globalState.update(exports.ACTIVE_ACCOUNT_ID_KEY, undefined);
    }
    getAccountsMeta() {
        const raw = this.globalState.get(exports.ACCOUNTS_META_KEY);
        if (!raw || !Array.isArray(raw.accounts)) {
            return {
                version: account_1.ACCOUNT_META_VERSION,
                accounts: [],
            };
        }
        return {
            version: account_1.ACCOUNT_META_VERSION,
            accounts: raw.accounts
                .map((item) => normalizeAccountProfile(item))
                .filter((item) => !!item.accountId),
        };
    }
}
exports.AccountMetaManager = AccountMetaManager;
let accountMetaManagerInstance;
function initializeAccountMetaManager(context) {
    accountMetaManagerInstance = new AccountMetaManager(context);
    return accountMetaManagerInstance;
}
exports.initializeAccountMetaManager = initializeAccountMetaManager;
function getAccountMetaManager() {
    if (!accountMetaManagerInstance) {
        throw new Error('AccountMetaManager not initialized');
    }
    return accountMetaManagerInstance;
}
exports.getAccountMetaManager = getAccountMetaManager;
//# sourceMappingURL=accountMetaManager.js.map