"use strict";
/**
 * 命令模块
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
exports.registerCommands = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const auth_1 = require("../auth");
const services_1 = require("../services");
const providers_1 = require("../providers");
const exportService_1 = require("../services/exportService");
const localDataService_1 = require("../services/localDataService");
const migrationService_1 = require("../services/migrationService");
const storageService_1 = require("../services/storageService");
const accountMetaManager_1 = require("../services/accountMetaManager");
const accountMigrationService_1 = require("../services/accountMigrationService");
const config_1 = require("../config/config");
const bookDetail_1 = require("../views/bookDetail");
const insightsDashboard_1 = require("../views/insightsDashboard");
const noteRoamingView_1 = require("../views/noteRoamingView");
const indexService_1 = require("../services/indexService");
const search_1 = require("./search");
const i18n_1 = require("../i18n");
const utils_1 = require("../utils");
const debounceAsync_1 = require("../utils/debounceAsync");
const syncFlowGuard_1 = require("./syncFlowGuard");
const treeToggleState_1 = require("../providers/treeToggleState");
const runtimeExtension_1 = require("../runtimeExtension");
const bookshelfToggleLog_1 = require("../logging/bookshelfToggleLog");
const noteRoamingLog_1 = require("../logging/noteRoamingLog");
let operationOutput;
let syncStatusBarDisposable;
let syncStatusHideTimer;
/**
 * 注册所有命令
 */
function registerCommands(context, options = {}) {
    // 初始化书籍详情视图
    (0, bookDetail_1.initializeBookDetailView)(context.extensionUri);
    if (!operationOutput) {
        operationOutput = vscode.window.createOutputChannel('WeRead 操作日志');
    }
    context.subscriptions.push(operationOutput);
    const refreshLoginUi = async (loggedIn) => {
        const activeAccountId = (0, auth_1.getCookieManager)().getActiveAccountId();
        await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath(activeAccountId).catch(() => undefined);
        await vscode.commands.executeCommand('setContext', 'weread:loggedIn', loggedIn);
        (0, providers_1.getBookshelfProvider)().setLoggedIn(loggedIn);
        (0, providers_1.getLoginProvider)().refresh();
        (0, providers_1.getBookshelfProvider)().refresh();
        await (0, insightsDashboard_1.getInsightsDashboardView)().refreshIfVisible();
    };
    const syncActiveAccountSelection = async (accountId) => {
        const normalized = String(accountId || '').trim();
        if (!normalized) {
            throw new Error('无效账号：accountId 不能为空');
        }
        await Promise.allSettled([
            (0, auth_1.getCookieManager)().setActiveAccountId(normalized),
            (0, accountMetaManager_1.getAccountMetaManager)().setActiveAccountId(normalized),
        ]);
        return normalized;
    };
    const resolveOutputPathConfigTargets = (inspected) => {
        const targets = [vscode.ConfigurationTarget.Global];
        if (inspected?.workspaceValue !== undefined || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)) {
            targets.push(vscode.ConfigurationTarget.Workspace);
        }
        if (inspected?.workspaceFolderValue !== undefined) {
            targets.push(vscode.ConfigurationTarget.WorkspaceFolder);
        }
        return targets;
    };
    const ensureActiveAccountOrHint = async (sceneLabel, options) => {
        const activeAccountId = (0, auth_1.getCookieManager)().getActiveAccountId() || (0, accountMetaManager_1.getAccountMetaManager)().getActiveAccountId();
        if (activeAccountId) {
            return syncActiveAccountSelection(activeAccountId);
        }
        const accounts = (0, accountMetaManager_1.getAccountMetaManager)().listAccounts();
        if (accounts.length === 1 && accounts[0]?.accountId) {
            return syncActiveAccountSelection(accounts[0].accountId);
        }
        if (accounts.length === 0) {
            if (!options?.silentWhenMissing) {
                vscode.window.showInformationMessage(`${sceneLabel}前请先登录账号`);
            }
            return undefined;
        }
        const picked = await vscode.window.showQuickPick(accounts.map((item) => ({
            label: item.displayName || item.accountId,
            description: item.accountId,
            accountId: item.accountId,
        })), {
            placeHolder: `请选择用于${sceneLabel}的活跃账号`,
        });
        if (!picked?.accountId) {
            vscode.window.showWarningMessage(`未选择活跃账号，已取消${sceneLabel}`);
            return undefined;
        }
        return syncActiveAccountSelection(picked.accountId);
    };
    const ensurePanelAccessOrHint = async (sceneLabel) => {
        if (await ensureActiveAccountOrHint(sceneLabel, { silentWhenMissing: true })) {
            return true;
        }
        if (await (0, auth_1.getAuthManager)().checkLoginStatus()) {
            return true;
        }
        vscode.window.showInformationMessage(`${sceneLabel}前请先登录账号`);
        return false;
    };
    const writeOperationLog = (event, detail) => {
        const line = `[${new Date().toISOString()}] [${event}] ${detail}`;
        operationOutput?.appendLine(line);
    };
    const WE_READ_HOME_URL = 'https://weread.qq.com/';
    const WE_READ_LOGIN_URL = 'https://weread.qq.com/web/login';
    const WE_READ_UA = 'WeRead/7.0.0 (iPhone; iOS 16.0; Scale/3.00)';
    const fetchFn = globalThis.fetch;
    const measureWereadTtfb = async (timeoutMs = 3000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const start = Date.now();
        try {
            await fetchFn(WE_READ_HOME_URL, {
                method: 'HEAD',
                headers: { 'User-Agent': WE_READ_UA },
                signal: controller.signal,
            });
            return Date.now() - start;
        }
        finally {
            clearTimeout(timer);
        }
    };
    const buildAutoLoginUrl = (session, token) => {
        if (!session || !token) {
            return WE_READ_HOME_URL;
        }
        const url = new URL(WE_READ_LOGIN_URL);
        url.searchParams.set('wr_vid', session);
        url.searchParams.set('wr_skey', token);
        return url.toString();
    };
    const openSimpleBrowserWithRecovery = async (url, maxRetries = 2) => {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await vscode.commands.executeCommand('simpleBrowser.show', url);
                return;
            }
            catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    writeOperationLog('simpleBrowser.restart', `attempt=${attempt + 1}`);
                    continue;
                }
            }
        }
        throw lastError instanceof Error ? lastError : new Error('simpleBrowser.show 执行失败');
    };
    const clearSyncStatusDisplay = () => {
        if (syncStatusHideTimer) {
            clearTimeout(syncStatusHideTimer);
            syncStatusHideTimer = undefined;
        }
        syncStatusBarDisposable?.dispose();
        syncStatusBarDisposable = undefined;
        (0, providers_1.getBookshelfProvider)().setSyncing(false);
    };
    const showSyncStatusDisplay = (message) => {
        if (syncStatusHideTimer) {
            clearTimeout(syncStatusHideTimer);
            syncStatusHideTimer = undefined;
        }
        syncStatusBarDisposable?.dispose();
        syncStatusBarDisposable = vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
        (0, providers_1.getBookshelfProvider)().setSyncing(true, message);
    };
    const finishSyncStatusDisplayWithDelay = (message) => {
        syncStatusBarDisposable?.dispose();
        syncStatusBarDisposable = vscode.window.setStatusBarMessage(`$(check) ${message}`);
        (0, providers_1.getBookshelfProvider)().setSyncing(true, message);
        if (syncStatusHideTimer) {
            clearTimeout(syncStatusHideTimer);
        }
        syncStatusHideTimer = setTimeout(() => {
            clearSyncStatusDisplay();
        }, 3000);
    };
    const persistValidationStatus = async (status, reason) => {
        const config = vscode.workspace.getConfiguration('weread');
        await config.update('lastValidationStatus', status, true);
        await config.update('lastValidationFailReason', reason, true);
        const summary = status === 'passed'
            ? 'passed'
            : `failed: ${reason || '未知原因'}`;
        await config.update('lastValidationSummary', summary, true);
    };
    let accountMenuLoggedIn = false;
    let accountMenuCache = [];
    let accountMenuCacheAt = 0;
    let accountMenuPreloadTimer;
    let accountMenuPreloading;
    const accountMenuCacheTtlMs = 10000;
    const getLogoutLabel = () => {
        const user = (0, auth_1.getAuthManager)().getCurrentUser();
        if (!user) {
            return '登出（未知用户/未知ID）';
        }
        const name = String(user.name || '').trim() || '未知用户';
        const userId = String(user.userId || '').trim() || '未知ID';
        return `登出（${name}/${userId}）`;
    };
    const buildAccountMenuItems = (loggedIn) => {
        const accountsCount = (0, accountMetaManager_1.getAccountMetaManager)().listAccounts().length;
        const multiAccountEnabled = (0, config_1.getConfig)().multiAccountEnabled !== false;
        const logoutItem = { label: loggedIn ? getLogoutLabel() : '登录', action: 'weread.toggleLogin' };
        return [
            logoutItem,
            ...(multiAccountEnabled
                ? [
                    { label: '切换账号', action: 'weread.account.switch', description: '切换当前活跃账号' },
                    { label: '新增账号登录', action: 'weread.account.add', description: '登录并新增一个账号' },
                    { label: `管理账号（${accountsCount}）`, action: 'weread.account.manage', description: '查看并管理现有账号' },
                    { label: '删除账号', action: 'weread.account.remove', description: '删除账号并清理账号数据' },
                    { label: '紧急回滚到单账号模式', action: 'weread.multiAccount.disable' },
                ]
                : [
                    { label: '启用多账号模式', action: 'weread.multiAccount.enable' },
                    {
                        label: '紧急回滚到单账号模式（已禁用）',
                        action: 'weread.multiAccount.disable.noop',
                        disabled: true,
                        description: '当前已是单账号模式，无需回滚',
                    },
                ]),
            { label: '迁移历史数据到真源', action: 'weread.migrateMementoToFiles' },
            { label: '查看索引错误列表', action: 'weread.showIndexErrors' },
            { label: '打开微信读书官网', action: 'weread.openOfficialSite' },
            { label: '设置', action: 'weread.openSettings' },
        ];
    };
    const pickWithBack = async (items, placeHolder) => {
        const backItem = { label: '← 返回', description: '返回上一层菜单', __back: true };
        const picked = await vscode.window.showQuickPick([backItem, ...items.map((item) => ({ ...item, __back: false }))], { placeHolder });
        if (!picked) {
            return undefined;
        }
        if (picked.__back) {
            return '__back__';
        }
        const matched = items.find((item) => item.label === picked.label);
        return matched;
    };
    const preloadAccountMenu = async () => {
        if (accountMenuPreloading) {
            return accountMenuPreloading;
        }
        accountMenuPreloading = (async () => {
            accountMenuLoggedIn = await (0, auth_1.getAuthManager)().checkLoginStatus();
            accountMenuCache = buildAccountMenuItems(accountMenuLoggedIn);
            accountMenuCacheAt = Date.now();
            writeOperationLog('account.menu.preload', `size=${accountMenuCache.length}`);
        })().finally(() => {
            accountMenuPreloading = undefined;
        });
        return accountMenuPreloading;
    };
    const scheduleAccountMenuPreload = () => {
        if (accountMenuPreloadTimer) {
            clearTimeout(accountMenuPreloadTimer);
        }
        accountMenuPreloadTimer = setTimeout(() => {
            void preloadAccountMenu().catch(() => undefined);
        }, 200);
    };
    context.subscriptions.push(new vscode.Disposable(() => {
        if (accountMenuPreloadTimer) {
            clearTimeout(accountMenuPreloadTimer);
        }
    }));
    // 登录命令
    const loginCommand = vscode.commands.registerCommand('weread.login', async () => {
        const authManager = (0, auth_1.getAuthManager)();
        const success = await authManager.login();
        if (success) {
            accountMenuLoggedIn = true;
            accountMenuCache = buildAccountMenuItems(true);
            accountMenuCacheAt = Date.now();
            await refreshLoginUi(true);
        }
    });
    // 网页协议扫码登录（独立入口）
    const loginProtocolCommand = vscode.commands.registerCommand('weread.login.protocol', async () => {
        const authManager = (0, auth_1.getAuthManager)();
        const success = await authManager.loginByProtocol();
        if (success) {
            accountMenuLoggedIn = true;
            accountMenuCache = buildAccountMenuItems(true);
            accountMenuCacheAt = Date.now();
            await refreshLoginUi(true);
        }
    });
    // 粘贴 Cookie 登录（独立入口）
    const loginCookieCommand = vscode.commands.registerCommand('weread.login.cookie', async () => {
        const authManager = (0, auth_1.getAuthManager)();
        const success = await authManager.loginByCookie();
        if (success) {
            accountMenuLoggedIn = true;
            accountMenuCache = buildAccountMenuItems(true);
            accountMenuCacheAt = Date.now();
            await refreshLoginUi(true);
        }
    });
    // 登出命令
    const logoutCommand = vscode.commands.registerCommand('weread.logout', async () => {
        const authManager = (0, auth_1.getAuthManager)();
        if (!(await ensureActiveAccountOrHint('登出'))) {
            return;
        }
        await authManager.logout();
        accountMenuLoggedIn = false;
        accountMenuCache = buildAccountMenuItems(false);
        accountMenuCacheAt = Date.now();
        await refreshLoginUi(false);
        await authManager.updateContext();
    });
    const toggleLoginCommand = vscode.commands.registerCommand('weread.toggleLogin', async () => {
        const loggedIn = await (0, auth_1.getAuthManager)().checkLoginStatus();
        accountMenuLoggedIn = loggedIn;
        if (loggedIn) {
            await vscode.commands.executeCommand('weread.logout');
            return;
        }
        await vscode.commands.executeCommand('weread.login');
    });
    const ensureMultiAccountEnabled = () => {
        if ((0, config_1.getConfig)().multiAccountEnabled !== false) {
            return true;
        }
        vscode.window.showWarningMessage('当前已关闭多账号模式，请先执行“启用多账号模式”。');
        return false;
    };
    const switchAccountCommand = vscode.commands.registerCommand('weread.account.switch', async () => {
        if (!ensureMultiAccountEnabled()) {
            return;
        }
        const authManager = (0, auth_1.getAuthManager)();
        const accounts = await authManager.listAccounts();
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('当前没有可切换账号，请先登录');
            return;
        }
        const activeAccountId = (0, auth_1.getCookieManager)().getActiveAccountId();
        const picked = await pickWithBack(accounts.map((item) => ({
            label: item.displayName || item.accountId,
            description: item.accountId === activeAccountId ? `当前活跃 · ${item.accountId}` : item.accountId,
            accountId: item.accountId,
        })), '选择要切换的账号（↑↓选择，Enter确认，Esc返回）');
        if (!picked) {
            return;
        }
        if (picked === '__back__') {
            await vscode.commands.executeCommand('weread.accountMenu');
            return;
        }
        if (!picked.accountId) {
            return;
        }
        await authManager.switchAccount(picked.accountId);
        const loggedIn = await authManager.checkLoginStatus();
        await refreshLoginUi(loggedIn);
        accountMenuLoggedIn = loggedIn;
        accountMenuCache = buildAccountMenuItems(loggedIn);
        accountMenuCacheAt = Date.now();
        vscode.window.showInformationMessage(`已切换账号：${picked.label}`);
    });
    const addAccountCommand = vscode.commands.registerCommand('weread.account.add', async () => {
        if (!ensureMultiAccountEnabled()) {
            return;
        }
        await vscode.commands.executeCommand('weread.login');
    });
    const removeAccountCommand = vscode.commands.registerCommand('weread.account.remove', async (inputAccountId) => {
        if (!ensureMultiAccountEnabled()) {
            return;
        }
        const authManager = (0, auth_1.getAuthManager)();
        const accounts = await authManager.listAccounts();
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('当前没有可删除账号');
            return;
        }
        const accountId = String(inputAccountId || '').trim();
        const target = accountId
            ? accounts.find((item) => item.accountId === accountId)
            : undefined;
        const picked = target || (await pickWithBack(accounts.map((item) => ({
            label: item.displayName || item.accountId,
            description: item.accountId,
            accountId: item.accountId,
        })), '选择要删除的账号（↑↓选择，Enter确认，Esc返回）'));
        if (picked === '__back__') {
            await vscode.commands.executeCommand('weread.accountMenu');
            return;
        }
        const pickedAccountId = picked?.accountId;
        if (!pickedAccountId) {
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`确认删除账号 ${pickedAccountId} 吗？将同时清理该账号本地缓存与目录数据。`, { modal: true }, '确认删除');
        if (confirm !== '确认删除') {
            return;
        }
        await (0, storageService_1.getStorageService)().clearAll(pickedAccountId);
        const outputPath = (0, utils_1.getConfiguredOutputPath)();
        if (outputPath) {
            const accountDir = path.join(outputPath, 'accounts', pickedAccountId);
            await fs.promises.rm(accountDir, { recursive: true, force: true }).catch(() => undefined);
        }
        await authManager.removeAccount(pickedAccountId);
        const nextActive = (0, auth_1.getCookieManager)().getActiveAccountId();
        await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath(nextActive).catch(() => undefined);
        const loggedIn = await authManager.checkLoginStatus();
        await refreshLoginUi(loggedIn);
        accountMenuLoggedIn = loggedIn;
        accountMenuCache = buildAccountMenuItems(loggedIn);
        accountMenuCacheAt = Date.now();
        vscode.window.showInformationMessage(`已删除账号：${pickedAccountId}`);
    });
    const manageAccountCommand = vscode.commands.registerCommand('weread.account.manage', async () => {
        if (!ensureMultiAccountEnabled()) {
            return;
        }
        const authManager = (0, auth_1.getAuthManager)();
        const accounts = await authManager.listAccounts();
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('当前没有账号，请先登录');
            return;
        }
        const activeAccountId = (0, auth_1.getCookieManager)().getActiveAccountId();
        const picked = await pickWithBack(accounts.map((item) => ({
            label: item.displayName || item.accountId,
            description: item.accountId === activeAccountId ? `当前活跃 · ${item.accountId}` : item.accountId,
            accountId: item.accountId,
        })), '选择要管理的账号（↑↓选择，Enter确认，Esc返回）');
        if (!picked) {
            return;
        }
        if (picked === '__back__') {
            await vscode.commands.executeCommand('weread.accountMenu');
            return;
        }
        if (!picked.accountId) {
            return;
        }
        const action = await pickWithBack([
            { label: '切换到该账号', action: 'switch' },
            { label: '删除该账号', action: 'remove' },
        ], `账号 ${picked.accountId} - 选择操作（↑↓选择，Enter确认，Esc返回）`);
        if (!action) {
            return;
        }
        if (action === '__back__') {
            await vscode.commands.executeCommand('weread.accountMenu');
            return;
        }
        if (action.action === 'switch') {
            await authManager.switchAccount(picked.accountId);
            const loggedIn = await authManager.checkLoginStatus();
            await refreshLoginUi(loggedIn);
            accountMenuLoggedIn = loggedIn;
            accountMenuCache = buildAccountMenuItems(loggedIn);
            accountMenuCacheAt = Date.now();
            vscode.window.showInformationMessage(`已切换账号：${picked.label}`);
            return;
        }
        await vscode.commands.executeCommand('weread.account.remove', picked.accountId);
    });
    const disableMultiAccountCommand = vscode.commands.registerCommand('weread.multiAccount.disable', async () => {
        const confirm = await vscode.window.showWarningMessage('将关闭多账号模式并尝试回滚最近一次迁移，是否继续？', { modal: true }, '确认关闭');
        if (confirm !== '确认关闭') {
            return;
        }
        try {
            const cookieManager = (0, auth_1.getCookieManager)();
            const activeAccountId = cookieManager.getActiveAccountId();
            const userInfo = cookieManager.getUserInfo();
            const accountCookies = activeAccountId
                ? await cookieManager.getCookiesForAccount(activeAccountId)
                : undefined;
            const accountSimpleAuth = activeAccountId
                ? await cookieManager.getSimpleBrowserAuthForAccount(activeAccountId)
                : undefined;
            await (0, accountMigrationService_1.getAccountMigrationService)().rollbackMigration();
            if (activeAccountId && accountCookies) {
                await (0, accountMetaManager_1.getAccountMetaManager)().addAccount({
                    accountId: activeAccountId,
                    userId: userInfo?.userId || activeAccountId,
                    displayName: userInfo?.name || activeAccountId,
                    avatar: userInfo?.avatar,
                    createdAt: Date.now(),
                    lastUsedAt: Date.now(),
                });
                await (0, accountMetaManager_1.getAccountMetaManager)().setActiveAccountId(activeAccountId);
                await cookieManager.setActiveAccountId(activeAccountId);
                await cookieManager.saveCookiesForAccount(activeAccountId, accountCookies);
                if (accountSimpleAuth) {
                    await cookieManager.saveSimpleBrowserAuthForAccount(activeAccountId, {
                        cookies: accountSimpleAuth.cookies,
                        token: accountSimpleAuth.token,
                        refreshToken: accountSimpleAuth.refreshToken,
                        session: accountSimpleAuth.session,
                        expiresAt: accountSimpleAuth.expiresAt,
                    });
                }
                if (userInfo) {
                    await cookieManager.saveUserInfo(userInfo);
                }
                await cookieManager.setLoggedInState(true);
            }
            await (0, config_1.updateConfig)('multiAccountEnabled', false);
            const stillLoggedIn = await (0, auth_1.getAuthManager)().checkLoginStatus().catch(() => false);
            accountMenuLoggedIn = stillLoggedIn;
            accountMenuCache = buildAccountMenuItems(stillLoggedIn);
            accountMenuCacheAt = Date.now();
            await refreshLoginUi(stillLoggedIn);
            vscode.window.showInformationMessage('已关闭多账号模式并执行回滚。建议重启 VS Code 后继续使用。');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`关闭多账号模式失败：${message}`);
        }
    });
    const enableMultiAccountCommand = vscode.commands.registerCommand('weread.multiAccount.enable', async () => {
        await (0, config_1.updateConfig)('multiAccountEnabled', true);
        accountMenuCache = buildAccountMenuItems(accountMenuLoggedIn);
        accountMenuCacheAt = Date.now();
        vscode.window.showInformationMessage('已启用多账号模式。');
    });
    const disableMultiAccountNoopCommand = vscode.commands.registerCommand('weread.multiAccount.disable.noop', async () => {
        vscode.window.showInformationMessage('当前已处于单账号模式，无需回滚。');
    });
    const runSyncFlow = async () => {
        const authManager = (0, auth_1.getAuthManager)();
        const isLoggedIn = await authManager.checkLoginStatus({ strict: true });
        if (!isLoggedIn) {
            accountMenuLoggedIn = false;
            accountMenuCache = buildAccountMenuItems(false);
            accountMenuCacheAt = Date.now();
            try {
                await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath();
            }
            catch {
                // Fall through and use current cache count so the user still gets feedback.
            }
            await refreshLoginUi(false);
            const books = await (0, indexService_1.getIndexService)().queryBooks();
            const booksCount = books.length;
            const notesCount = (await Promise.all(books.map(async (book) => (await (0, indexService_1.getIndexService)().getNotesByBookId(book.bookId)).length))).reduce((sum, value) => sum + value, 0);
            vscode.window.showInformationMessage(booksCount > 0
                ? (0, i18n_1.t)('sync_not_logged_in_refreshed_with_local', { count: booksCount, notes: notesCount })
                : (0, i18n_1.t)('sync_not_logged_in_refreshed_empty'));
            return { skipped: true, reason: 'not_logged_in' };
        }
        if (!(await ensureActiveAccountOrHint('同步'))) {
            return { skipped: true, reason: 'no_active_account' };
        }
        const syncService = (0, services_1.getSyncService)();
        if (syncService.isSyncingInProgress()) {
            return { skipped: true, reason: 'sync_in_progress' };
        }
        // 显示进度通知
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: (0, i18n_1.t)('sync_title'),
            cancellable: false,
        }, async (progress) => {
            // 监听进度更新
            const disposable = syncService.onDidUpdateProgress((p) => {
                const bookProgress = `${p.syncedBooks ?? p.currentBookIndex}/${p.totalBooks}`;
                const notesProgress = `${p.syncedNotes ?? 0}/${p.totalNotes ?? 0}`;
                const syncMessage = (0, i18n_1.t)('sync_progress', {
                    book: bookProgress,
                    notes: notesProgress,
                    name: p.currentBookName ? ` · ${p.currentBookName}` : '',
                });
                showSyncStatusDisplay(syncMessage);
                progress.report({
                    increment: p.percentage,
                    message: syncMessage,
                });
            });
            showSyncStatusDisplay((0, i18n_1.t)('sync_progress_refresh'));
            progress.report({ increment: 3, message: (0, i18n_1.t)('sync_progress_refresh') });
            const result = await syncService.fullSync();
            disposable.dispose();
            if (result.success) {
                const doneMessage = result.syncedBooks === 0
                    ? (0, i18n_1.t)('sync_done_no_update')
                    : (0, i18n_1.t)('sync_done_with_update', { books: result.syncedBooks, notes: result.syncedNotes });
                finishSyncStatusDisplayWithDelay(doneMessage);
                vscode.window.showInformationMessage(doneMessage);
            }
            else {
                if ((0, syncFlowGuard_1.isSyncInProgressError)(result.error)) {
                    return { skipped: true, reason: 'sync_in_progress' };
                }
                finishSyncStatusDisplayWithDelay((0, i18n_1.t)('sync_failed', { error: result.error || (0, i18n_1.t)('common_unknown') }));
                vscode.window.showErrorMessage((0, i18n_1.t)('sync_failed', { error: result.error || (0, i18n_1.t)('common_unknown') }));
            }
            return result;
        });
    };
    const debouncedRunSyncFlow = (0, debounceAsync_1.createDebouncedAsync)(runSyncFlow, 500);
    // 同步命令（500ms 防抖，连续触发只执行一次）
    const syncCommand = vscode.commands.registerCommand('weread.sync', async () => {
        showSyncStatusDisplay((0, i18n_1.t)('sync_title'));
        const result = await debouncedRunSyncFlow();
        if ('skipped' in result && !(0, syncFlowGuard_1.isSyncInProgressSkip)(result)) {
            clearSyncStatusDisplay();
        }
        return result;
    });
    // 增量同步命令
    const incrementalSyncCommand = vscode.commands.registerCommand('weread.incrementalSync', async () => {
        const authManager = (0, auth_1.getAuthManager)();
        const isLoggedIn = await authManager.checkLoginStatus({ strict: true });
        if (!isLoggedIn) {
            vscode.window.showInformationMessage((0, i18n_1.t)('login_required_short'));
            return;
        }
        if (!(await ensureActiveAccountOrHint('增量同步'))) {
            return;
        }
        const syncService = (0, services_1.getSyncService)();
        if (syncService.isSyncingInProgress()) {
            return;
        }
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: (0, i18n_1.t)('incremental_sync_title'),
            cancellable: false,
        }, async (progress) => {
            const disposable = syncService.onDidUpdateProgress((p) => {
                const bookProgress = `${p.syncedBooks ?? p.currentBookIndex}/${p.totalBooks}`;
                const notesProgress = `${p.syncedNotes ?? 0}/${p.totalNotes ?? 0}`;
                const syncMessage = (0, i18n_1.t)('sync_progress', {
                    book: bookProgress,
                    notes: notesProgress,
                    name: p.currentBookName ? ` · ${p.currentBookName}` : '',
                });
                showSyncStatusDisplay(syncMessage);
                progress.report({
                    increment: p.percentage,
                    message: syncMessage,
                });
            });
            showSyncStatusDisplay((0, i18n_1.t)('incremental_sync_title'));
            const result = await syncService.incrementalSync();
            disposable.dispose();
            if (result.success) {
                if (result.syncedBooks === 0) {
                    finishSyncStatusDisplayWithDelay((0, i18n_1.t)('incremental_done_latest'));
                    vscode.window.showInformationMessage((0, i18n_1.t)('incremental_done_latest'));
                }
                else {
                    const doneMessage = (0, i18n_1.t)('incremental_done_with_update', { books: result.syncedBooks, notes: result.syncedNotes });
                    finishSyncStatusDisplayWithDelay(doneMessage);
                    vscode.window.showInformationMessage(doneMessage);
                }
            }
            else {
                if ((0, syncFlowGuard_1.isSyncInProgressError)(result.error)) {
                    return { skipped: true, reason: 'sync_in_progress' };
                }
                finishSyncStatusDisplayWithDelay((0, i18n_1.t)('sync_failed', { error: result.error || (0, i18n_1.t)('common_unknown') }));
                vscode.window.showErrorMessage((0, i18n_1.t)('sync_failed', { error: result.error || (0, i18n_1.t)('common_unknown') }));
            }
            return result;
        });
    });
    // 打开书架命令
    const openBookshelfCommand = vscode.commands.registerCommand('weread.openBookshelf', () => {
        vscode.commands.executeCommand('workbench.view.extension.weread-explorer');
    });
    // 全部折叠命令
    const collapseAllCommand = vscode.commands.registerCommand('weread.collapseAll', () => {
        try {
            const changed = (0, providers_1.getBookshelfProvider)().collapseAllCategories();
            (0, bookshelfToggleLog_1.logBookshelfToggle)(`command collapseAll changed=${changed}`);
            if (changed <= 0) {
                (0, bookshelfToggleLog_1.logBookshelfToggle)('command collapseAll no-op because no collapsible categories', 'WARN');
                vscode.window.showInformationMessage('当前没有可折叠的书架目录');
                return;
            }
            void (0, treeToggleState_1.syncBookshelfCollapsedContext)(true, 'command:collapseAll');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            (0, bookshelfToggleLog_1.logBookshelfToggle)(`command collapseAll failed: ${message}`, 'ERROR');
            vscode.window.showErrorMessage(`全部折叠失败：${message}`);
        }
    });
    const expandAllCommand = vscode.commands.registerCommand('weread.expandAll', async () => {
        try {
            const changed = (0, providers_1.getBookshelfProvider)().expandAllCategories();
            (0, bookshelfToggleLog_1.logBookshelfToggle)(`command expandAll changed=${changed}`);
            if (changed <= 0) {
                (0, bookshelfToggleLog_1.logBookshelfToggle)('command expandAll no-op because no collapsible categories', 'WARN');
                vscode.window.showInformationMessage('当前没有可展开的书架目录');
                return;
            }
            await (0, treeToggleState_1.syncBookshelfCollapsedContext)(false, 'command:expandAll');
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            (0, bookshelfToggleLog_1.logBookshelfToggle)(`command expandAll failed: ${message}`, 'ERROR');
            vscode.window.showErrorMessage(`全部展开失败：${message}`);
        }
    });
    const toggleCollapseAllCommand = vscode.commands.registerCommand('weread.toggleCollapseAll', async () => {
        (0, bookshelfToggleLog_1.logBookshelfToggle)(`command toggleCollapseAll allCollapsed=${(0, treeToggleState_1.isBookshelfAllCollapsed)()}`);
        if ((0, treeToggleState_1.isBookshelfAllCollapsed)()) {
            await vscode.commands.executeCommand('weread.expandAll');
            return;
        }
        await vscode.commands.executeCommand('weread.collapseAll');
        await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const showBookshelfToggleLogsCommand = vscode.commands.registerCommand('weread.showBookshelfToggleLogs', async () => {
        (0, bookshelfToggleLog_1.showBookshelfToggleLogs)(false);
    });
    const copyBookshelfToggleLogsCommand = vscode.commands.registerCommand('weread.copyBookshelfToggleLogs', async () => {
        const count = await (0, bookshelfToggleLog_1.copyBookshelfToggleLogs)();
        vscode.window.showInformationMessage(`已复制书架切换日志${count > 0 ? `（${count} 行）` : ''}`);
    });
    const clearBookshelfToggleLogsCommand = vscode.commands.registerCommand('weread.clearBookshelfToggleLogs', async () => {
        (0, bookshelfToggleLog_1.clearBookshelfToggleLogs)();
        (0, bookshelfToggleLog_1.showBookshelfToggleLogs)(true);
    });
    // 刷新书架命令
    // 打开书籍详情命令
    const openBookDetailCommand = vscode.commands.registerCommand('weread.openBookDetail', async (bookOrId) => {
        let bookId = '';
        if (typeof bookOrId === 'string') {
            bookId = bookOrId;
        }
        else if (bookOrId instanceof providers_1.BookTreeItem) {
            bookId = bookOrId.book.bookId;
        }
        if (!bookId) {
            vscode.window.showErrorMessage((0, i18n_1.t)('open_book_not_found'));
            return;
        }
        const book = await (0, indexService_1.getIndexService)().getBookById(bookId);
        if (!book) {
            vscode.window.showErrorMessage((0, i18n_1.t)('open_book_missing_local'));
            return;
        }
        const exportService = (0, exportService_1.getExportService)();
        const filePath = (await exportService.findBookNoteFilePath(book))
            || (await exportService.ensureAndGetBookNoteFilePath(book));
        if (!filePath) {
            vscode.window.showErrorMessage((0, i18n_1.t)('open_book_open_failed'));
            return;
        }
        try {
            await exportService.openExportedFile(filePath);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error || '');
            if (message) {
                vscode.window.showErrorMessage(`打开笔记失败：${message}`);
            }
            else {
                vscode.window.showErrorMessage('打开笔记失败：请检查目标文件是否可访问');
            }
        }
    });
    const openBookFolderCommand = vscode.commands.registerCommand('weread.openBookFolder', async (target) => {
        const isTrashPath = (inputPath) => {
            const marker = `${path.sep}._weread_trash${path.sep}`;
            return inputPath.includes(marker);
        };
        const refreshLocalIndexLightweight = async () => {
            const activeAccountId = (0, auth_1.getCookieManager)().getActiveAccountId();
            await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath(activeAccountId).catch(() => undefined);
            (0, providers_1.getBookshelfProvider)().refresh();
        };
        const resolveNonTrashPathForBook = async (bookId) => {
            const currentBook = await (0, indexService_1.getIndexService)().getBookById(bookId);
            if (!currentBook) {
                return undefined;
            }
            const firstTry = await (0, exportService_1.getExportService)().findBookNoteFilePath(currentBook);
            if (firstTry && !isTrashPath(firstTry)) {
                return firstTry;
            }
            await refreshLocalIndexLightweight();
            const refreshedBook = await (0, indexService_1.getIndexService)().getBookById(bookId);
            if (!refreshedBook) {
                return undefined;
            }
            const secondTry = await (0, exportService_1.getExportService)().findBookNoteFilePath(refreshedBook);
            if (secondTry && !isTrashPath(secondTry)) {
                return secondTry;
            }
            return undefined;
        };
        if (target instanceof providers_1.CategoryTreeItem) {
            const categoryBooks = target.books || [];
            if (categoryBooks.length === 0) {
                vscode.window.showWarningMessage('当前分类暂无笔记文件可打开');
                return;
            }
            let filePath;
            for (const book of categoryBooks) {
                const candidate = await resolveNonTrashPathForBook(book.bookId);
                if (candidate) {
                    filePath = candidate;
                    break;
                }
            }
            if (!filePath) {
                vscode.window.showErrorMessage('未找到该分类对应的原始笔记文件，请先同步或检查导出目录配置');
                return;
            }
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
            return;
        }
        const bookId = typeof target === 'string'
            ? target
            : target instanceof providers_1.BookTreeItem
                ? target.book.bookId
                : '';
        if (!bookId) {
            vscode.window.showErrorMessage((0, i18n_1.t)('open_book_not_found'));
            return;
        }
        const book = await (0, indexService_1.getIndexService)().getBookById(bookId);
        if (!book) {
            vscode.window.showErrorMessage((0, i18n_1.t)('open_book_missing_local'));
            return;
        }
        const filePath = await resolveNonTrashPathForBook(bookId);
        if (!filePath) {
            vscode.window.showErrorMessage('未找到该笔记文件，请先同步或检查导出目录配置');
            return;
        }
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
    });
    const pickCategoriesForBatchDelete = async (categories, preselectedLabels) => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.canSelectMany = true;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.placeholder = '选择要批量删除的分类目录';
        const selectAllBtn = {
            iconPath: new vscode.ThemeIcon('check-all'),
            tooltip: '全选',
        };
        const clearAllBtn = {
            iconPath: new vscode.ThemeIcon('close-all'),
            tooltip: '取消全选',
        };
        quickPick.buttons = [selectAllBtn, clearAllBtn];
        quickPick.items = categories.map((category) => ({
            label: category.label,
            description: `${category.books.length} 本书`,
            detail: `分类：${category.label}`,
            category,
        }));
        const selectedByDefault = quickPick.items.filter((item) => preselectedLabels.has(item.label));
        quickPick.selectedItems = selectedByDefault.length > 0 ? selectedByDefault : quickPick.items.slice(0, 1);
        quickPick.title = `已选择 ${quickPick.selectedItems.length}/${quickPick.items.length}`;
        return await new Promise((resolve) => {
            const disposables = [];
            const finish = (result) => {
                while (disposables.length > 0) {
                    disposables.pop()?.dispose();
                }
                quickPick.hide();
                resolve(result);
            };
            disposables.push(quickPick.onDidChangeSelection((selection) => {
                quickPick.title = `已选择 ${selection.length}/${quickPick.items.length}`;
            }));
            disposables.push(quickPick.onDidTriggerButton((button) => {
                if (button === selectAllBtn) {
                    quickPick.selectedItems = [...quickPick.items];
                    quickPick.title = `已选择 ${quickPick.selectedItems.length}/${quickPick.items.length}`;
                    return;
                }
                quickPick.selectedItems = [];
                quickPick.title = `已选择 0/${quickPick.items.length}`;
            }));
            disposables.push(quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems.map((item) => item.category);
                finish(selected);
            }));
            disposables.push(quickPick.onDidHide(() => finish(undefined)));
            quickPick.show();
        });
    };
    const deleteCategoryBatch = async (categories) => {
        const exportService = (0, exportService_1.getExportService)();
        const results = [];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在批量删除分类目录笔记',
            cancellable: false,
        }, async (progress) => {
            const step = categories.length === 0 ? 100 : 100 / categories.length;
            for (const category of categories) {
                progress.report({ increment: step, message: `处理中：${category.label}` });
                try {
                    const files = (await Promise.all((category.books || []).map((book) => exportService.findBookNoteFilePath(book)))).filter((item) => !!item);
                    if (files.length === 0) {
                        throw new Error('该分类下未找到可删除的笔记文件');
                    }
                    await Promise.all(files.map((filePath) => fs.promises.unlink(filePath)));
                    results.push({ category, ok: true });
                }
                catch (error) {
                    const reason = error instanceof Error ? error.message : '删除失败';
                    results.push({ category, ok: false, reason });
                }
            }
        });
        return results;
    };
    const getCategoryFileCandidates = async (category) => {
        const exportService = (0, exportService_1.getExportService)();
        const candidates = [];
        for (const book of category.books || []) {
            const filePath = await exportService.findBookNoteFilePath(book);
            if (filePath) {
                candidates.push({ title: book.title, path: filePath });
            }
        }
        return candidates;
    };
    const normalizeCategorySegment = (segment) => (segment || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '未分类';
    const removeDirIfEmptyChain = async (startDir, rootDir) => {
        const resolvedRoot = rootDir ? path.resolve(rootDir) : undefined;
        let currentDir = path.resolve(startDir);
        let removedAny = false;
        while (true) {
            if (resolvedRoot && currentDir.length < resolvedRoot.length) {
                break;
            }
            if (resolvedRoot && !currentDir.startsWith(resolvedRoot)) {
                break;
            }
            if (resolvedRoot && currentDir === resolvedRoot) {
                break;
            }
            let entries;
            try {
                entries = await fs.promises.readdir(currentDir);
            }
            catch {
                break;
            }
            if (entries.length > 0) {
                break;
            }
            try {
                await fs.promises.rmdir(currentDir);
                removedAny = true;
            }
            catch {
                break;
            }
            currentDir = path.dirname(currentDir);
        }
        return removedAny;
    };
    const deleteBookNoteCommand = vscode.commands.registerCommand('weread.deleteBookNote', async (target) => {
        if (target instanceof providers_1.CategoryTreeItem) {
            const categoryBooks = target.books || [];
            const candidates = [];
            for (const book of categoryBooks) {
                const fp = await (0, exportService_1.getExportService)().findBookNoteFilePath(book);
                if (fp) {
                    candidates.push({ title: book.title, path: fp });
                }
            }
            if (candidates.length === 0) {
                vscode.window.showWarningMessage('当前分类下未找到可删除的笔记文件');
                return;
            }
            const picked = await vscode.window.showQuickPick(candidates.map((item) => ({ label: item.title, description: item.path, item })), { placeHolder: `选择要删除的笔记文件（分类：${target.label}）` });
            if (!picked) {
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`确认删除《${picked.item.title}》对应的笔记文件吗？`, { modal: true }, '删除');
            if (confirm !== '删除') {
                return;
            }
            await fs.promises.unlink(picked.item.path);
            await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath().catch(() => undefined);
            await refreshLoginUi(await (0, auth_1.getAuthManager)().checkLoginStatus());
            vscode.window.showInformationMessage(`已删除笔记文件：${picked.item.title}`);
            return;
        }
        const bookId = typeof target === 'string'
            ? target
            : target instanceof providers_1.BookTreeItem
                ? target.book.bookId
                : '';
        if (!bookId) {
            vscode.window.showErrorMessage((0, i18n_1.t)('open_book_not_found'));
            return;
        }
        const book = await (0, indexService_1.getIndexService)().getBookById(bookId);
        if (!book) {
            vscode.window.showErrorMessage((0, i18n_1.t)('open_book_missing_local'));
            return;
        }
        const filePath = await (0, exportService_1.getExportService)().findBookNoteFilePath(book);
        if (!filePath) {
            vscode.window.showErrorMessage('未找到该笔记文件，无法删除');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`确认删除《${book.title}》对应的笔记文件吗？`, { modal: true }, '删除');
        if (confirm !== '删除') {
            return;
        }
        await fs.promises.unlink(filePath);
        await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath().catch(() => undefined);
        await refreshLoginUi(await (0, auth_1.getAuthManager)().checkLoginStatus());
        vscode.window.showInformationMessage(`已删除笔记文件：${book.title}`);
    });
    const deleteCategoryNotesBatchCommand = vscode.commands.registerCommand('weread.deleteCategoryNotesBatch', async (target) => {
        const selectedCategories = (options.bookshelfTreeView?.selection || []).filter((item) => item instanceof providers_1.CategoryTreeItem);
        const allRootItems = (await (0, providers_1.getBookshelfProvider)().getChildren()).filter((item) => item instanceof providers_1.CategoryTreeItem);
        const targetCategory = target instanceof providers_1.CategoryTreeItem ? target : undefined;
        if (targetCategory) {
            const candidates = await getCategoryFileCandidates(targetCategory);
            const mode = await vscode.window.showQuickPick([
                {
                    label: '删除分类及全部书籍',
                    description: `共 ${candidates.length} 本`,
                    action: 'all',
                },
                {
                    label: '删除分类并选择书籍',
                    description: '可按需勾选要删除的书籍',
                    action: 'pick',
                },
                {
                    label: '仅删除分类目录',
                    description: '不删除书籍文件，仅在目录为空时删除',
                    action: 'dirOnly',
                },
            ], { placeHolder: `分类“${targetCategory.label}”删除方式` });
            if (!mode) {
                return;
            }
            let filesToDelete = [];
            if (mode.action === 'all') {
                filesToDelete = candidates.map((item) => item.path);
            }
            else if (mode.action === 'pick') {
                const picked = await vscode.window.showQuickPick(candidates.map((item) => ({ label: item.title, description: item.path, item })), {
                    canPickMany: true,
                    placeHolder: `勾选要删除的书籍（分类：${targetCategory.label}）`,
                });
                if (!picked || picked.length === 0) {
                    return;
                }
                filesToDelete = picked.map((item) => item.item.path);
            }
            const confirm = await vscode.window.showWarningMessage(filesToDelete.length > 0
                ? `将删除分类“${targetCategory.label}”中 ${filesToDelete.length} 本书籍，并尝试删除分类目录`
                : `将仅删除分类目录“${targetCategory.label}”（仅空目录可删）`, { modal: true }, '确认删除');
            if (confirm !== '确认删除') {
                return;
            }
            if (filesToDelete.length > 0) {
                await Promise.all(filesToDelete.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined)));
            }
            const outputPath = (0, utils_1.getConfiguredOutputPath)();
            const normalizedRoot = outputPath ? (0, utils_1.normalizeOutputPath)(outputPath) : undefined;
            const preferredDir = normalizedRoot
                ? path.join(normalizedRoot, normalizeCategorySegment(targetCategory.label))
                : undefined;
            const fallbackDir = candidates[0]?.path ? path.dirname(candidates[0].path) : undefined;
            const categoryDir = preferredDir || fallbackDir;
            const removed = categoryDir
                ? await removeDirIfEmptyChain(categoryDir, normalizedRoot)
                : false;
            await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath().catch(() => undefined);
            await refreshLoginUi(await (0, auth_1.getAuthManager)().checkLoginStatus());
            (0, providers_1.getBookshelfProvider)().refresh();
            vscode.window.showInformationMessage(removed
                ? `删除完成：已处理分类“${targetCategory.label}”`
                : `书籍删除已完成；分类目录“${targetCategory.label}”非空，未删除`);
            return;
        }
        const preselected = new Set(selectedCategories.map((item) => item.label));
        const pickedCategories = await pickCategoriesForBatchDelete(allRootItems, preselected);
        if (!pickedCategories || pickedCategories.length === 0) {
            return;
        }
        const names = pickedCategories.map((item) => item.label);
        const visible = names.slice(0, 5).join('、');
        const suffix = names.length > 5 ? '……' : '';
        const confirm = await vscode.window.showWarningMessage(`即将删除 ${pickedCategories.length} 个目录：${visible}${suffix}`, { modal: true }, '确认批量删除');
        if (confirm !== '确认批量删除') {
            return;
        }
        const firstRun = await deleteCategoryBatch(pickedCategories);
        const failed = firstRun.filter((item) => !item.ok);
        const succeeded = firstRun.length - failed.length;
        writeOperationLog('category.batch.delete', `total=${firstRun.length}, success=${succeeded}, failed=${failed.length}, names=${names.join('|')}`);
        if (failed.length > 0) {
            const action = await vscode.window.showQuickPick([
                { label: `重试失败项（${failed.length}）`, action: 'retry', detail: '' },
                ...failed.map((item) => ({
                    label: `失败：${item.category.label}`,
                    action: 'error',
                    detail: item.reason || '未知错误',
                })),
            ], {
                placeHolder: '可点击查看失败原因，或直接重试失败项',
                matchOnDetail: true,
            });
            if (action?.action === 'error') {
                const retryOne = await vscode.window.showWarningMessage(action.detail || '删除失败', { modal: true }, '重试该项');
                if (retryOne === '重试该项') {
                    const one = failed.find((item) => `失败：${item.category.label}` === action.label);
                    if (one) {
                        await deleteCategoryBatch([one.category]);
                    }
                }
            }
            else if (action?.action === 'retry') {
                await deleteCategoryBatch(failed.map((item) => item.category));
            }
        }
        await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath().catch(() => undefined);
        await refreshLoginUi(await (0, auth_1.getAuthManager)().checkLoginStatus());
        (0, providers_1.getBookshelfProvider)().refresh();
        vscode.window.showInformationMessage(`批量删除完成：成功 ${succeeded}，失败 ${failed.length}`);
    });
    // 打开设置命令
    const openSettingsCommand = vscode.commands.registerCommand('weread.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:weread.weread-vscode weread');
    });
    const openOfficialSiteCommand = vscode.commands.registerCommand('weread.openOfficialSite', async () => {
        const clickStart = Date.now();
        const cookieManager = (0, auth_1.getCookieManager)();
        let auth;
        try {
            const saved = await cookieManager.getSimpleBrowserAuth();
            auth = {
                session: saved?.session,
                token: saved?.token,
                expiresAt: saved?.expiresAt,
            };
        }
        catch {
            try {
                await openSimpleBrowserWithRecovery(WE_READ_HOME_URL);
            }
            catch {
                await vscode.env.openExternal(vscode.Uri.parse(WE_READ_HOME_URL));
            }
            return;
        }
        const now = Date.now();
        const expiresAt = Number(auth?.expiresAt || 0) || 0;
        const hasSessionToken = !!auth?.session && !!auth?.token;
        const tokenExplicitlyExpired = expiresAt > 0 && expiresAt <= now;
        const canAutoLogin = hasSessionToken && !tokenExplicitlyExpired;
        if (tokenExplicitlyExpired) {
            await cookieManager.clearSimpleBrowserAuth();
        }
        while (true) {
            try {
                const ttfb = await measureWereadTtfb(3000);
                writeOperationLog('officialSite.ttfb', `${ttfb}ms`);
                break;
            }
            catch {
                const action = await vscode.window.showErrorMessage('网络不可达，是否重试打开微信读书官网？', '重试', '取消');
                if (action !== '重试') {
                    return;
                }
            }
        }
        const targetUrl = canAutoLogin
            ? buildAutoLoginUrl(auth?.session, auth?.token)
            : WE_READ_HOME_URL;
        try {
            await openSimpleBrowserWithRecovery(targetUrl, 2);
            const elapsed = Date.now() - clickStart;
            writeOperationLog('officialSite.open', `autoLogin=${canAutoLogin}, elapsed=${elapsed}ms`);
            if (tokenExplicitlyExpired) {
                vscode.window.showInformationMessage('当前登录凭据不可自动登录，请重新扫码登录。');
            }
        }
        catch {
            await vscode.env.openExternal(vscode.Uri.parse(WE_READ_HOME_URL));
            vscode.window.showWarningMessage('内置浏览器打开失败，已切换系统浏览器。');
        }
    });
    // 打开阅读洞察面板
    const openInsightsCommand = vscode.commands.registerCommand('weread.openInsights', async () => {
        if (!(await ensurePanelAccessOrHint('查看阅读洞察'))) {
            return;
        }
        await (0, insightsDashboard_1.getInsightsDashboardView)().show();
    });
    const openNoteRoamingCommand = vscode.commands.registerCommand('weread.openNoteRoaming', async () => {
        if (!(await ensurePanelAccessOrHint('笔记漫游'))) {
            return;
        }
        await (0, noteRoamingView_1.getNoteRoamingView)().show();
    });
    const showNoteRoamingLogsCommand = vscode.commands.registerCommand('weread.showNoteRoamingLogs', async () => {
        (0, noteRoamingLog_1.showNoteRoamingLogs)(false);
    });
    const copyNoteRoamingLogsCommand = vscode.commands.registerCommand('weread.copyNoteRoamingLogs', async () => {
        const count = await (0, noteRoamingLog_1.copyNoteRoamingLogs)();
        vscode.window.showInformationMessage(`已复制笔记漫游日志${count > 0 ? `（${count} 行）` : ''}`);
    });
    const clearNoteRoamingLogsCommand = vscode.commands.registerCommand('weread.clearNoteRoamingLogs', async () => {
        (0, noteRoamingLog_1.clearNoteRoamingLogs)();
        (0, noteRoamingLog_1.showNoteRoamingLogs)(true);
    });
    const cleanupDuplicateBookFilesCommand = vscode.commands.registerCommand('weread.cleanupDuplicateBookFiles', async () => {
        const activeAccountId = await ensureActiveAccountOrHint('清理重复笔记文件');
        if (!activeAccountId) {
            return;
        }
        const dryRunResult = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在预览重复文件清理结果',
            cancellable: false,
        }, async () => (0, services_1.getBookFileCleanupService)().cleanupDuplicateBookFilesForAccount(activeAccountId, { dryRun: true }));
        const summary = `扫描 ${dryRunResult.scannedFiles} 个文件，发现 ${dryRunResult.duplicateGroups} 组冲突，将迁移 ${dryRunResult.actions.length} 个重复文件，并规范化重命名 ${dryRunResult.normalizedRenames} 个文件。`;
        const confirm = await vscode.window.showWarningMessage(`${summary}\n确认开始清理吗？`, { modal: true }, '开始清理');
        if (confirm !== '开始清理' || (dryRunResult.actions.length === 0 && dryRunResult.normalizedRenames === 0)) {
            if (dryRunResult.actions.length === 0 && dryRunResult.normalizedRenames === 0) {
                const missingBookIdSkips = dryRunResult.skips.filter((item) => item.reason === 'missing_or_invalid_bookId').length;
                vscode.window.showInformationMessage(missingBookIdSkips > 0
                    ? `未发现可清理的重复笔记文件。已跳过 ${missingBookIdSkips} 个无法识别 bookId 的文件。`
                    : '未发现可清理的重复笔记文件。');
            }
            return;
        }
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在清理重复笔记文件',
            cancellable: false,
        }, async () => (0, services_1.getBookFileCleanupService)().cleanupDuplicateBookFilesForAccount(activeAccountId));
        await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath(activeAccountId).catch(() => undefined);
        await refreshLoginUi(await (0, auth_1.getAuthManager)().checkLoginStatus());
        const manifestTip = result.manifestPath ? `\n清理清单：${result.manifestPath}` : '';
        vscode.window.showInformationMessage(`清理完成：扫描 ${result.scannedFiles} 个文件，冲突组 ${result.duplicateGroups}，已迁移 ${result.movedFiles} 个重复文件，规范化重命名 ${result.normalizedRenames} 个文件。${manifestTip}`);
    });
    const restoreDuplicateBookFilesCommand = vscode.commands.registerCommand('weread.restoreDuplicateBookFiles', async () => {
        const activeAccountId = await ensureActiveAccountOrHint('回滚重复笔记清理');
        if (!activeAccountId) {
            return;
        }
        const cleanupService = (0, services_1.getBookFileCleanupService)();
        const latestRestorePlan = await cleanupService.findLatestRestorePlanPath(activeAccountId);
        if (!latestRestorePlan) {
            vscode.window.showInformationMessage('未找到可回滚的清理计划（restore-plan）。');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`将按最近一次回滚清单恢复文件：\n${latestRestorePlan}\n是否继续？`, { modal: true }, '执行回滚');
        if (confirm !== '执行回滚') {
            return;
        }
        const restoreResult = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在回滚重复文件清理',
            cancellable: false,
        }, async () => cleanupService.restoreFilesFromPlan(latestRestorePlan));
        await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath(activeAccountId).catch(() => undefined);
        await refreshLoginUi(await (0, auth_1.getAuthManager)().checkLoginStatus());
        vscode.window.showInformationMessage(`回滚完成：恢复 ${restoreResult.restoredFiles} 个文件，跳过 ${restoreResult.skippedFiles} 个。`);
    });
    const openSystemPrivacySettingsCommand = vscode.commands.registerCommand('weread.openSystemPrivacySettings', async () => {
        const candidates = [
            'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
            'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
        ];
        for (const uri of candidates) {
            try {
                await vscode.env.openExternal(vscode.Uri.parse(uri));
                writeOperationLog('outputPath.permission.openSettings', uri);
                return;
            }
            catch {
                // 尝试下一个深链
            }
        }
        await vscode.window.showInformationMessage('请手动打开系统设置 > 隐私与安全性 > 文件与文件夹/完整磁盘访问');
    });
    const validateAndApplyOutputPath = async (inputPath) => {
        const raw = inputPath.trim();
        if (!raw) {
            await persistValidationStatus('failed', '路径不能为空');
            return false;
        }
        const normalizedPath = (0, utils_1.normalizeOutputPath)(raw);
        try {
            try {
                await fs.promises.stat(normalizedPath);
            }
            catch (error) {
                const code = error.code;
                if (code === 'ENOENT') {
                    const create = await vscode.window.showWarningMessage(`目录不存在，是否自动创建？\n${normalizedPath}`, { modal: true }, '创建', '取消');
                    if (create !== '创建') {
                        await persistValidationStatus('failed', '用户取消创建目录');
                        return false;
                    }
                    await fs.promises.mkdir(normalizedPath, { recursive: true });
                }
                else {
                    throw error;
                }
            }
            const [readable, writable] = await Promise.all([
                (0, utils_1.validateOutputPathReadable)(normalizedPath),
                (0, utils_1.validateOutputPathWritable)(normalizedPath),
            ]);
            if (!readable.ok || !writable.ok) {
                throw new Error(readable.reason || writable.reason || '目录不可读或不可写');
            }
            const config = vscode.workspace.getConfiguration('weread');
            (0, runtimeExtension_1.markOutputPathSwitchPreconfirmed)(normalizedPath);
            for (const target of resolveOutputPathConfigTargets(config.inspect('outputPath'))) {
                await config.update('outputPath', normalizedPath, target);
            }
            await persistValidationStatus('passed', '');
            writeOperationLog('outputPath.validation.passed', normalizedPath);
            return true;
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : '目录校验失败';
            await persistValidationStatus('failed', reason);
            const action = await vscode.window.showErrorMessage(`目录校验失败：${reason}`, '打开系统隐私设置', '重试');
            if (action === '打开系统隐私设置') {
                await vscode.commands.executeCommand('weread.openSystemPrivacySettings');
            }
            else if (action === '重试') {
                return validateAndApplyOutputPath(normalizedPath);
            }
            writeOperationLog('outputPath.validation.failed', `${normalizedPath} | ${reason}`);
            return false;
        }
    };
    const selectOutputPathCommand = vscode.commands.registerCommand('weread.selectOutputPath', async () => {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择笔记目录',
        });
        const folder = picked?.[0];
        if (!folder) {
            return;
        }
        await vscode.workspace.getConfiguration('weread').update('outputPathInputMode', 'picker', true);
        await vscode.workspace.getConfiguration('weread').update('manualOutputPathInput', false, true);
        await validateAndApplyOutputPath(folder.fsPath);
    });
    const configureOutputPathCommand = vscode.commands.registerCommand('weread.configureOutputPath', async () => {
        const config = vscode.workspace.getConfiguration('weread');
        let mode = config.get('outputPathInputMode', 'picker');
        let draftPath = config.get('outputPath', '');
        let errorMessage = '';
    let isSaving = false;
        const panel = vscode.window.createWebviewPanel('wereadOutputPathConfig', '配置笔记存储路径', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: false });
        const render = () => {
            const checkedPicker = mode === 'picker' ? 'checked' : '';
            const checkedManual = mode === 'manual' ? 'checked' : '';
            const pickerHidden = mode === 'picker' ? '' : 'hidden';
            const manualHidden = mode === 'manual' ? '' : 'hidden';
            const escapedPath = draftPath
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            const escapedError = errorMessage
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            panel.webview.html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>配置笔记存储路径</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    fieldset { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 14px; }
    legend { padding: 0 6px; }
    .radio-row { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; }
    .action { margin-top: 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .picker-btn { display: inline-flex; align-items: center; gap: 8px; }
    .icon { font-size: 16px; }
    input[type="text"] { width: min(760px, 100%); padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
    .path-readonly { margin-left: 8px; width: min(620px, 100%); }
    .error { margin-top: 8px; color: var(--vscode-inputValidation-errorForeground); min-height: 18px; }
    button { cursor: pointer; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h2>笔记存储路径</h2>
  <p>请选择一种方式（互斥），路径会实时校验并在保存时再次严格校验。</p>
  <fieldset role="radiogroup" aria-labelledby="mode-title">
    <legend id="mode-title">路径配置方式</legend>
    <div class="radio-row">
      <label><input type="radio" name="mode" value="picker" ${checkedPicker} /> 系统文件夹选择</label>
      <label><input type="radio" name="mode" value="manual" ${checkedManual} /> 手动路径输入</label>
    </div>
    <div id="picker-pane" class="${pickerHidden}">
      <button id="pick-folder" class="picker-btn" type="button" aria-label="选择系统文件夹">
        <span class="icon" aria-hidden="true">📁</span><span>选择文件夹</span>
      </button>
      <input id="picked-path" class="path-readonly" type="text" value="${escapedPath}" readonly aria-readonly="true" />
    </div>
    <div id="manual-pane" class="${manualHidden}">
      <label for="manual-path">绝对路径</label>
      <input id="manual-path" type="text" value="${escapedPath}" aria-describedby="error-msg" aria-invalid="${errorMessage ? 'true' : 'false'}" />
    </div>
    <div id="error-msg" class="error" role="status" aria-live="polite">${escapedError}</div>
  </fieldset>
  <div class="action">
    <button id="save" type="button" ${isSaving ? 'disabled' : ''}>${isSaving ? '保存中...' : '保存并应用'}</button>
    <button id="cancel" type="button" ${isSaving ? 'disabled' : ''}>关闭</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('input[name="mode"]').forEach((el) => {
      el.addEventListener('change', (event) => {
        vscode.postMessage({ command: 'changeMode', mode: event.target.value });
      });
    });
    const manualInput = document.getElementById('manual-path');
    if (manualInput) {
      manualInput.addEventListener('input', (event) => {
        vscode.postMessage({ command: 'manualInput', value: event.target.value });
      });
    }
    document.getElementById('pick-folder').addEventListener('click', () => {
      vscode.postMessage({ command: 'pickFolder' });
    });
    document.getElementById('save').addEventListener('click', () => {
      const value = manualInput ? manualInput.value : '';
      vscode.postMessage({ command: 'save', value });
    });
    document.getElementById('cancel').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });
  </script>
</body>
</html>`;
        };
        const validateManualPath = (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
                return '路径不能为空';
            }
            if (!path.isAbsolute(trimmed)) {
                return '请输入绝对路径';
            }
            return '';
        };
        render();
        const disposable = panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'cancel') {
                panel.dispose();
                return;
            }
            if (message.command === 'changeMode') {
                mode = message.mode === 'manual' ? 'manual' : 'picker';
                errorMessage = mode === 'manual' ? validateManualPath(draftPath) : '';
                render();
                return;
            }
            if (message.command === 'manualInput') {
                draftPath = String(message.value || '');
                errorMessage = validateManualPath(draftPath);
                render();
                return;
            }
            if (message.command === 'pickFolder') {
                const picked = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择笔记目录',
                });
                const folder = picked?.[0];
                if (folder) {
                    draftPath = folder.fsPath;
                    errorMessage = '';
                    render();
                }
                return;
            }
            if (message.command === 'save') {
                if (isSaving) {
                    return;
                }
                isSaving = true;
                render();
                try {
                    if (mode === 'picker') {
                        if (!draftPath) {
                            errorMessage = '请先选择系统文件夹';
                            render();
                            return;
                        }
                        draftPath = (0, utils_1.normalizeOutputPath)(draftPath);
                        await config.update('outputPathInputMode', 'picker', true);
                        await config.update('manualOutputPathInput', false, true);
                        const ok = await validateAndApplyOutputPath(draftPath);
                        if (ok) {
                            panel.dispose();
                        }
                        return;
                    }
                    draftPath = String(message.value || '');
                    errorMessage = validateManualPath(draftPath);
                    if (errorMessage) {
                        render();
                        return;
                    }
                    draftPath = (0, utils_1.normalizeOutputPath)(draftPath);
                    await config.update('outputPathInputMode', 'manual', true);
                    await config.update('manualOutputPathInput', true, true);
                    const ok = await validateAndApplyOutputPath(draftPath);
                    if (ok) {
                        panel.dispose();
                    }
                }
                catch (error) {
                    errorMessage = error instanceof Error ? error.message : '保存失败，请稍后重试';
                    void vscode.window.showErrorMessage(`保存笔记存储路径失败：${errorMessage}`);
                }
                finally {
                    isSaving = false;
                    if (!panel.visible) {
                        return;
                    }
                    render();
                }
            }
        });
        panel.onDidDispose(() => disposable.dispose());
    });
    const retryOutputPathValidationCommand = vscode.commands.registerCommand('weread.retryOutputPathValidation', async () => {
        const current = vscode.workspace.getConfiguration('weread').get('outputPath', '');
        await validateAndApplyOutputPath(current);
    });
    const accountMenuCommand = vscode.commands.registerCommand('weread.accountMenu', async () => {
        const shouldUseCache = accountMenuCache.length > 0
            && (Date.now() - accountMenuCacheAt < accountMenuCacheTtlMs);
        const items = shouldUseCache
            ? accountMenuCache
            : buildAccountMenuItems(accountMenuLoggedIn);
        accountMenuCache = items;
        accountMenuCacheAt = Date.now();
        void preloadAccountMenu();
        const picked = await vscode.window.showQuickPick(items.map((item) => ({
            label: item.label,
            description: item.description || (item.disabled ? '当前不可用' : ''),
            item,
        })), {
            placeHolder: '请选择操作（支持键盘导航与读屏）',
            matchOnDescription: true,
        });
        if (!picked) {
            return;
        }
        if (picked.item.disabled) {
            vscode.window.showInformationMessage('该操作在当前模式下不可用。');
            return;
        }
        writeOperationLog('account.menu.click', picked.item.action);
        await vscode.commands.executeCommand(picked.item.action);
    });
    const migrateMementoCommand = vscode.commands.registerCommand('weread.migrateMementoToFiles', async () => {
        if ((0, utils_1.getDataSourceMode)() === 'file_ssot') {
            const useDual = await vscode.window.showInformationMessage('当前已是文件真源模式。如需重新迁移，请先切回兼容模式（dual）。', '切回 dual');
            if (useDual === '切回 dual') {
                await vscode.workspace.getConfiguration('weread').update('dataSourceMode', 'dual', true);
            }
            return;
        }
        const confirm = await vscode.window.showWarningMessage('将把历史 Memento 里的书籍/笔记导出为 Markdown 文件并重建索引。是否继续？', { modal: true }, '开始迁移');
        if (confirm !== '开始迁移') {
            return;
        }
        try {
            const migration = (0, migrationService_1.getMigrationService)();
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '迁移历史数据到文件真源',
                cancellable: false,
            }, async () => migration.migrateMementoToFiles());
            if (result.success) {
                vscode.window.showInformationMessage(`迁移完成：共 ${result.totalBooks} 本，导出 ${result.exportedBooks} 本，跳过 ${result.skippedBooks} 本。`);
                await vscode.workspace.getConfiguration('weread').update('dataSourceMode', 'file_ssot', true);
                (0, providers_1.getBookshelfProvider)().refresh();
                await (0, insightsDashboard_1.getInsightsDashboardView)().refreshIfVisible();
                return;
            }
            await vscode.workspace.getConfiguration('weread').update('dataSourceMode', 'dual', true);
            const message = result.errors[0]?.message || '未知错误';
            vscode.window.showWarningMessage(`迁移完成但有失败：成功 ${result.exportedBooks} 本，失败 ${result.failedBooks} 本。已回退到 dual。首个错误：${message}`);
        }
        catch (error) {
            await vscode.workspace.getConfiguration('weread').update('dataSourceMode', 'dual', true);
            const message = error instanceof Error ? error.message : String(error || '未知错误');
            vscode.window.showErrorMessage(`迁移失败，已回退到 dual：${message}`);
        }
    });
    const showIndexErrorsCommand = vscode.commands.registerCommand('weread.showIndexErrors', async () => {
        const snapshot = (0, storageService_1.getStorageService)().getIndexSnapshot();
        const errors = snapshot?.errors || [];
        if (errors.length === 0) {
            vscode.window.showInformationMessage('当前没有索引错误。');
            return;
        }
        const pick = await vscode.window.showQuickPick(errors.map((item, idx) => ({
            label: `[${item.code}] ${item.message}`,
            description: `${idx + 1}/${errors.length}`,
            detail: item.filePath,
        })), {
            placeHolder: `最近索引错误 ${errors.length} 条，选择后尝试打开对应文件`,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!pick) {
            return;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(pick.detail || '');
            await vscode.window.showTextDocument(doc, { preview: true });
        }
        catch {
            await vscode.env.clipboard.writeText(`${pick.label}\n${pick.detail || ''}`);
            vscode.window.showWarningMessage('无法打开对应文件，已复制错误信息到剪贴板。');
        }
    });
    // 注册搜索命令
    (0, search_1.registerSearchCommands)(context);
    void preloadAccountMenu();
    if (options.bookshelfTreeView) {
        context.subscriptions.push(options.bookshelfTreeView.onDidChangeVisibility((e) => {
            if (e.visible) {
                scheduleAccountMenuPreload();
            }
        }), options.bookshelfTreeView.onDidChangeSelection(() => {
            scheduleAccountMenuPreload();
        }));
    }
    // 注册所有命令
    context.subscriptions.push(new vscode.Disposable(() => clearSyncStatusDisplay()), loginCommand, loginProtocolCommand, loginCookieCommand, logoutCommand, toggleLoginCommand, switchAccountCommand, addAccountCommand, manageAccountCommand, removeAccountCommand, disableMultiAccountCommand, enableMultiAccountCommand, disableMultiAccountNoopCommand, syncCommand, incrementalSyncCommand, openBookshelfCommand, collapseAllCommand, expandAllCommand, toggleCollapseAllCommand, showBookshelfToggleLogsCommand, copyBookshelfToggleLogsCommand, clearBookshelfToggleLogsCommand, openBookDetailCommand, openBookFolderCommand, deleteBookNoteCommand, deleteCategoryNotesBatchCommand, accountMenuCommand, openOfficialSiteCommand, openSettingsCommand, openInsightsCommand, openNoteRoamingCommand, showNoteRoamingLogsCommand, copyNoteRoamingLogsCommand, clearNoteRoamingLogsCommand, cleanupDuplicateBookFilesCommand, restoreDuplicateBookFilesCommand, configureOutputPathCommand, selectOutputPathCommand, retryOutputPathValidationCommand, openSystemPrivacySettingsCommand, migrateMementoCommand, showIndexErrorsCommand);
}
exports.registerCommands = registerCommands;
//# sourceMappingURL=index.js.map
