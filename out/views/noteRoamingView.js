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
exports.getNoteRoamingView = exports.initializeNoteRoamingView = exports.NoteRoamingView = void 0;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const auth_1 = require("../auth");
const accountMetaManager_1 = require("../services/accountMetaManager");
const noteRoamingService_1 = require("../services/noteRoamingService");
const storageService_1 = require("../services/storageService");
const noteRoamingLog_1 = require("../logging/noteRoamingLog");
function isSameNaturalDay(a, b) {
    const da = new Date(Number(a || 0));
    const db = new Date(Number(b || 0));
    return (da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate());
}
function normalizeToMs(value) {
    const num = Number(value || 0);
    if (!num || !Number.isFinite(num)) {
        return 0;
    }
    return num > 1000000000000 ? Math.floor(num) : Math.floor(num * 1000);
}
class NoteRoamingView {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.statsPool = [];
        this.webviewReady = false;
        this.webviewReadyWaiters = [];
        this.state = {
            pool: [],
            currentIndex: -1,
            history: [],
            filter: { minDaysUnreviewed: 7 },
            metrics: {
                reviewed: 0,
                openedSource: 0,
                skipped: 0,
            },
        };
    }
    markWebviewReady() {
        this.webviewReady = true;
        const waiters = this.webviewReadyWaiters.splice(0, this.webviewReadyWaiters.length);
        for (const resolve of waiters) {
            resolve(true);
        }
    }
    resetWebviewReadyState() {
        this.webviewReady = false;
        const waiters = this.webviewReadyWaiters.splice(0, this.webviewReadyWaiters.length);
        for (const resolve of waiters) {
            resolve(false);
        }
    }
    async waitForWebviewReady(timeoutMs = 5000) {
        if (this.webviewReady) {
            return true;
        }
        return await new Promise((resolve) => {
            let settled = false;
            const done = (ready) => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(ready);
            };
            const timer = setTimeout(() => {
                this.webviewReadyWaiters = this.webviewReadyWaiters.filter((item) => item !== waiter);
                done(false);
            }, timeoutMs);
            const waiter = (ready) => {
                clearTimeout(timer);
                done(ready);
            };
            this.webviewReadyWaiters.push(waiter);
        });
    }
    async postToWebview(message, scene) {
        const panel = NoteRoamingView.currentPanel;
        if (!panel) {
            return false;
        }
        try {
            const ok = await panel.webview.postMessage(message);
            if (!ok) {
                (0, noteRoamingLog_1.logNoteRoaming)(`webview postMessage dropped scene=${scene}`, 'WARN');
            }
            return ok;
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            (0, noteRoamingLog_1.logNoteRoaming)(`webview postMessage failed scene=${scene} error=${detail}`, 'ERROR');
            return false;
        }
    }
    async show() {
        if (NoteRoamingView.currentPanel) {
            NoteRoamingView.currentPanel.reveal(vscode.ViewColumn.One);
            // Reset webview content to recover from potential stale/broken JS context.
            this.resetWebviewReadyState();
            NoteRoamingView.currentPanel.webview.html = this.renderHtml(NoteRoamingView.currentPanel.webview);
            const ready = await this.waitForWebviewReady();
            if (!ready) {
                (0, noteRoamingLog_1.logNoteRoaming)('webview ready timeout (reuse panel)', 'WARN');
            }
            await this.reloadPool();
            return;
        }
        const panel = vscode.window.createWebviewPanel('wereadNoteRoaming', '笔记漫游', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [this.extensionUri],
        });
        NoteRoamingView.currentPanel = panel;
        this.resetWebviewReadyState();
        panel.onDidDispose(() => {
            this.resetWebviewReadyState();
            NoteRoamingView.currentPanel = undefined;
        });
        panel.webview.onDidReceiveMessage(async (message) => {
            const command = String(message?.command || '');
            if (command === 'load' || command === 'refresh') {
                await this.reloadPool();
                return;
            }
            if (command === 'applyFilter') {
                this.state.filter = this.normalizeFilter(message?.filter);
                (0, noteRoamingLog_1.logNoteRoaming)(`applyFilter accountId=${this.state.accountId || 'none'} favoriteOnly=${this.state.filter.favoriteOnly ? 1 : 0} noteTypes=${(this.state.filter.noteTypes || []).join(',') || 'all'} minDays=${this.state.filter.minDaysUnreviewed || 0}`);
                await this.reloadPool();
                return;
            }
            if (command === 'next') {
                await this.next();
                return;
            }
            if (command === 'prev') {
                await this.prev();
                return;
            }
            if (command === 'toggleFavorite') {
                await this.toggleFavorite();
                return;
            }
            if (command === 'markReviewed') {
                await this.markReviewed();
                return;
            }
            if (command === 'openSource') {
                await this.openSource();
                return;
            }
            if (command === 'openEdit') {
                await this.openEdit();
                return;
            }
            if (command === 'exportCardImage') {
                await this.exportCardImage(String(message?.imageDataUrl || ''), String(message?.fileName || ''));
                return;
            }
            if (command === 'webviewReady') {
                (0, noteRoamingLog_1.logNoteRoaming)('webview ready');
                this.markWebviewReady();
                if (this.state.history.length > 0 && this.getCurrent()) {
                    await this.renderCurrent();
                }
                return;
            }
            if (command === 'webviewError') {
                const messageText = String(message?.message || '');
                const stack = String(message?.stack || '');
                (0, noteRoamingLog_1.logNoteRoaming)(`webview runtime error message=${messageText} stack=${stack}`, 'ERROR');
                return;
            }
            if (command === 'webviewLog') {
                const level = String(message?.level || 'INFO').toUpperCase();
                const stage = String(message?.stage || 'unknown');
                const detail = String(message?.detail || '');
                (0, noteRoamingLog_1.logNoteRoaming)(`webview export stage=${stage} detail=${detail}`, level);
            }
        });
        panel.webview.html = this.renderHtml(panel.webview);
        const ready = await this.waitForWebviewReady();
        if (!ready) {
            (0, noteRoamingLog_1.logNoteRoaming)('webview ready timeout (new panel)', 'WARN');
        }
        await this.reloadPool();
    }
    async refreshIfVisible() {
        if (!NoteRoamingView.currentPanel) {
            return;
        }
        await this.reloadPool();
    }
    async reloadPool() {
        const panel = NoteRoamingView.currentPanel;
        if (!panel) {
            return;
        }
        const accountId = this.getActiveAccountId();
        const accountName = this.getAccountName(accountId);
        (0, noteRoamingLog_1.logNoteRoaming)(`reloadPool start accountId=${accountId || 'none'}`);
        if (!accountId) {
            (0, noteRoamingLog_1.logNoteRoaming)('reloadPool aborted: no active account', 'WARN');
            await this.postToWebview({
                command: 'renderEmpty',
                reason: '当前没有活跃账号，请先登录或切换账号后再使用笔记漫游。',
            }, 'reloadPool:noAccount');
            return;
        }
        await this.postToWebview({ command: 'setLoading' }, 'reloadPool:setLoading');
        const pool = await this.loadPoolWithRetry(accountId);
        this.statsPool = await this.loadStatsPool(accountId);
        (0, noteRoamingLog_1.logNoteRoaming)(`reloadPool loaded candidates=${pool.length} accountId=${accountId}`);
        const roamingMeta = (0, storageService_1.getStorageService)().getRoamingMeta(accountId);
        const favoriteMetaRecords = Object.values(roamingMeta.records || {}).filter((item) => !!item?.favorite);
        const legacyLocalFavoriteRecords = favoriteMetaRecords.filter((item) => /^local_[a-z0-9]+_\d{9,}$/i.test(String(item?.noteKey || ''))).length;
        if (this.state.filter.favoriteOnly) {
            const favoriteRecords = favoriteMetaRecords.length;
            (0, noteRoamingLog_1.logNoteRoaming)(`reloadPool favoriteOnly accountId=${accountId} favoriteRecords=${favoriteRecords} loadedCandidates=${pool.length} minDays=${this.state.filter.minDaysUnreviewed || 0}`);
        }
        this.state = {
            accountId,
            accountName,
            pool,
            currentIndex: -1,
            history: [],
            filter: this.state.filter,
            metrics: { reviewed: 0, openedSource: 0, skipped: 0 },
        };
        if (pool.length === 0) {
            let emptyReason = `账号 ${accountName} 暂无可漫游笔记，请先同步或调整笔记数据。`;
            if (this.state.filter.favoriteOnly) {
                (0, noteRoamingLog_1.logNoteRoaming)(`reloadPool favoriteOnly empty accountId=${accountId} minDays=${this.state.filter.minDaysUnreviewed || 0} noteTypes=${(this.state.filter.noteTypes || []).join(',') || 'all'}`, 'WARN');
                if (favoriteMetaRecords.length > 0 && legacyLocalFavoriteRecords > 0) {
                    emptyReason = `账号 ${accountName} 检测到旧版本收藏标记，已无法自动匹配到笔记。请重新收藏一次，后续将稳定生效。`;
                }
                else {
                    emptyReason = `账号 ${accountName} 暂无可漫游的收藏笔记，请先同步或调整筛选条件。`;
                }
            }
            (0, noteRoamingLog_1.logNoteRoaming)(`reloadPool empty accountId=${accountId}`, 'WARN');
            await this.postToWebview({
                command: 'renderEmpty',
                reason: emptyReason,
            }, 'reloadPool:empty');
            return;
        }
        await this.next();
    }
    async next() {
        const panel = NoteRoamingView.currentPanel;
        if (!panel || this.state.pool.length === 0) {
            return;
        }
        if (this.state.currentIndex + 1 < this.state.history.length) {
            this.state.currentIndex += 1;
            (0, noteRoamingLog_1.logNoteRoaming)(`next from history index=${this.state.currentIndex + 1} total=${this.state.history.length}`);
            await this.renderCurrent();
            return;
        }
        const current = this.getCurrent();
        if (current) {
            await (0, noteRoamingService_1.getNoteRoamingService)().recordAction(current.noteKey, 'skip', this.state.accountId);
            current.meta.skipCount += 1;
            this.state.metrics.skipped += 1;
        }
        const recent = this.state.history.slice(-20);
        const picked = (0, noteRoamingService_1.getNoteRoamingService)().pickNext(this.state.pool, {
            recentNoteKeys: recent.map((item) => item.noteKey),
            recentChapterKeys: recent.map((item) => `${item.bookId}:${item.chapterUid || 0}`),
            recentBookIds: recent.map((item) => item.bookId),
        });
        if (!picked.candidate) {
            (0, noteRoamingLog_1.logNoteRoaming)('next failed: no candidate', 'WARN');
            await this.postToWebview({
                command: 'renderEmpty',
                reason: '暂无可用候选卡片，请稍后重试。',
            }, 'next:noCandidate');
            return;
        }
        this.state.history.push(picked.candidate);
        this.state.currentIndex = this.state.history.length - 1;
        (0, noteRoamingLog_1.logNoteRoaming)(`next picked noteKey=${picked.candidate.noteKey} eligible=${picked.eligibleCandidates}/${picked.totalCandidates} history=${this.state.history.length}`);
        await (0, noteRoamingService_1.getNoteRoamingService)().recordAction(picked.candidate.noteKey, 'view', this.state.accountId);
        await this.renderCurrent();
    }
    async prev() {
        if (this.state.currentIndex <= 0) {
            (0, noteRoamingLog_1.logNoteRoaming)('prev reached beginning', 'WARN');
            await this.renderCurrent('已经是第一条历史卡片');
            return;
        }
        this.state.currentIndex -= 1;
        (0, noteRoamingLog_1.logNoteRoaming)(`prev index=${this.state.currentIndex + 1}`);
        await this.renderCurrent();
    }
    async toggleFavorite() {
        const current = this.getCurrent();
        if (!current) {
            return;
        }
        const oldFavorite = !!current.meta.favorite;
        const action = current.meta.favorite ? 'unfavorite' : 'favorite';
        await (0, noteRoamingService_1.getNoteRoamingService)().recordAction(current.noteKey, action, this.state.accountId);
        current.meta.favorite = !current.meta.favorite;
        if (current.meta.favorite) {
            current.meta.favoriteAt = Date.now();
        }
        else {
            current.meta.favoriteAt = undefined;
        }
        (0, noteRoamingLog_1.logNoteRoaming)(`toggleFavorite noteKey=${current.noteKey} before=${oldFavorite ? 1 : 0} after=${current.meta.favorite ? 1 : 0} accountId=${this.state.accountId || 'none'} filterFavoriteOnly=${this.state.filter.favoriteOnly ? 1 : 0}`);
        // If unfavorited and favoriteOnly filter is active, remove from history and go next
        if (!current.meta.favorite && this.state.filter.favoriteOnly) {
            // Remove current from history
            this.state.history.splice(this.state.currentIndex, 1);
            if (this.state.currentIndex >= this.state.history.length) {
                this.state.currentIndex = this.state.history.length - 1;
            }
            await this.renderCurrent('已取消收藏，已移出收藏列表');
            return;
        }
        await this.renderCurrent(current.meta.favorite ? '已加入收藏' : '已取消收藏');
    }
    async markReviewed() {
        const current = this.getCurrent();
        if (!current) {
            return;
        }
        const now = Date.now();
        const lastReviewedAt = Number(current.meta.lastReviewedAt || 0);
        if (lastReviewedAt > 0 && isSameNaturalDay(lastReviewedAt, now)) {
            await this.renderCurrent('今日已复习');
            return;
        }
        const result = await (0, noteRoamingService_1.getNoteRoamingService)().recordAction(current.noteKey, 'review', this.state.accountId);
        if (result?.duplicateReviewToday) {
            await this.renderCurrent('今日已复习');
            return;
        }
        current.meta.lastReviewedAt = Date.now();
        current.meta.reviewCount += 1;
        this.state.metrics.reviewed += 1;
        (0, noteRoamingLog_1.logNoteRoaming)(`markReviewed noteKey=${current.noteKey} reviewCount=${current.meta.reviewCount}`);
        await this.renderCurrent('已标记为已复习');
    }
    async openSource() {
        const current = this.getCurrent();
        if (!current) {
            return;
        }
        await (0, noteRoamingService_1.getNoteRoamingService)().recordAction(current.noteKey, 'openSource', this.state.accountId);
        this.state.metrics.openedSource += 1;
        (0, noteRoamingLog_1.logNoteRoaming)(`openSource bookId=${current.bookId} noteKey=${current.noteKey}`);
        await vscode.commands.executeCommand('weread.openBookDetail', current.bookId);
        await this.renderCurrent('已打开原书笔记文件');
    }
    async openEdit() {
        const current = this.getCurrent();
        if (!current) {
            return;
        }
        (0, noteRoamingLog_1.logNoteRoaming)(`openEdit bookId=${current.bookId} noteKey=${current.noteKey}`);
        await vscode.commands.executeCommand('weread.openBookDetail', current.bookId);
        await this.renderCurrent('已打开编辑入口，可直接在文件中修改对应笔记');
    }
    async exportCardImage(imageDataUrl, fileNameHint) {
        const panel = NoteRoamingView.currentPanel;
        if (!panel) {
            return;
        }
        (0, noteRoamingLog_1.logNoteRoaming)(`exportCardImage start fileNameHint=${fileNameHint || 'none'} dataUrlLength=${imageDataUrl ? imageDataUrl.length : 0}`);
        if (!/^data:image\/png;base64,/.test(imageDataUrl || '')) {
            (0, noteRoamingLog_1.logNoteRoaming)(`exportCardImage invalidData fileNameHint=${fileNameHint || 'none'} prefix=${String(imageDataUrl || '').slice(0, 32)}`, 'WARN');
            vscode.window.showErrorMessage('导出图片失败：图片数据无效');
            return;
        }
        const defaultFileName = this.sanitizeExportFileName(fileNameHint) || `笔记卡片_${new Date().getTime()}.png`;
        const suggestedDir = path.join(os.homedir(), 'Downloads');
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(suggestedDir, defaultFileName)),
            filters: { 'PNG Image': ['png'] },
            saveLabel: '导出图片',
            title: '导出笔记卡片为图片',
        });
        if (!saveUri) {
            return;
        }
        try {
            const raw = imageDataUrl.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(raw, 'base64');
            await fs.promises.writeFile(saveUri.fsPath, buffer);
            (0, noteRoamingLog_1.logNoteRoaming)(`exportCardImage success path=${saveUri.fsPath}`);
            vscode.window.showInformationMessage(`笔记卡片已导出：${saveUri.fsPath}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            (0, noteRoamingLog_1.logNoteRoaming)(`exportCardImage failed error=${message}`, 'ERROR');
            vscode.window.showErrorMessage(`导出图片失败：${message}`);
        }
    }
    sanitizeExportFileName(raw) {
        const fileName = String(raw || '').trim() || '笔记卡片.png';
        const normalized = fileName.endsWith('.png') ? fileName : `${fileName}.png`;
        return normalized.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    }
    async renderCurrent(tip) {
        const panel = NoteRoamingView.currentPanel;
        if (!panel) {
            return;
        }
        const current = this.getCurrent();
        if (!current) {
            await this.postToWebview({
                command: 'renderEmpty',
                reason: '暂无可展示卡片',
            }, 'renderCurrent:noCard');
            return;
        }
        await this.postToWebview({
            command: 'renderCard',
            card: current,
            accountName: this.state.accountName || this.state.accountId || '未知账号',
            index: this.state.currentIndex + 1,
            total: this.state.history.length,
            poolSize: this.state.pool.length,
            statsPoolSize: this.statsPool.length,
            tip: tip || '',
            stats: this.buildStats(),
            filter: this.state.filter,
        }, 'renderCurrent:card');
    }
    normalizeFilter(raw) {
        const data = (raw || {});
        const noteTypes = Array.isArray(data.noteTypes)
            ? data.noteTypes.filter((item) => ['highlight', 'thought', 'chapter', 'review'].includes(String(item)))
            : undefined;
        const minDaysUnreviewed = Number(data.minDaysUnreviewed || 0);
        return {
            noteTypes: noteTypes && noteTypes.length > 0 ? noteTypes : undefined,
            favoriteOnly: !!data.favoriteOnly,
            minDaysUnreviewed: Number.isFinite(minDaysUnreviewed) && minDaysUnreviewed > 0 ? Math.floor(minDaysUnreviewed) : undefined,
        };
    }
    async loadPoolWithRetry(accountId) {
        const service = (0, noteRoamingService_1.getNoteRoamingService)();
        const retries = 2;
        for (let i = 0; i <= retries; i++) {
            try {
                return await service.getCandidatePool(this.state.filter, accountId);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                (0, noteRoamingLog_1.logNoteRoaming)(`loadPool failed attempt=${i + 1} accountId=${accountId} error=${message}`, i < retries ? 'WARN' : 'ERROR');
                if (i >= retries) {
                    break;
                }
            }
        }
        try {
            (0, noteRoamingLog_1.logNoteRoaming)(`loadPool fallback to default account scope accountId=${accountId}`, 'WARN');
            return await service.getCandidatePool(this.state.filter);
        }
        catch {
            return [];
        }
    }
    async loadStatsPool(accountId) {
        const service = (0, noteRoamingService_1.getNoteRoamingService)();
        try {
            return await service.getCandidatePool({}, accountId);
        }
        catch {
            return this.state.pool;
        }
    }
    buildStats() {
        const statsPool = this.statsPool.length > 0 ? this.statsPool : this.state.pool;
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const todayReviewed = this.state.history.filter((item) => Number(item.meta.lastReviewedAt || 0) >= todayStart).length;
        const favorites = statsPool.filter((item) => item.meta.favorite).length;
        const recentDailyReviews = [];
        const dayBucket = new Map();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            recentDailyReviews.push({
                date: key,
                label: `${d.getMonth() + 1}/${d.getDate()}`,
                count: 0,
            });
            dayBucket.set(key, recentDailyReviews.length - 1);
        }
        for (const item of statsPool) {
            const ts = normalizeToMs(item.meta.lastReviewedAt);
            if (!ts) {
                continue;
            }
            const d = new Date(ts);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const idx = dayBucket.get(key);
            if (idx !== undefined) {
                recentDailyReviews[idx].count += 1;
            }
        }
        return {
            todayReviewed,
            sessionViewed: this.state.history.length,
            favorites,
            openedSource: this.state.metrics.openedSource,
            skipped: this.state.metrics.skipped,
            recentDailyReviews,
        };
    }
    getCurrent() {
        if (this.state.currentIndex < 0 || this.state.currentIndex >= this.state.history.length) {
            return undefined;
        }
        return this.state.history[this.state.currentIndex];
    }
    getActiveAccountId() {
        return (0, auth_1.getCookieManager)().getActiveAccountId()
            || (0, accountMetaManager_1.getAccountMetaManager)().getActiveAccountId()
            || (0, accountMetaManager_1.getAccountMetaManager)().listAccounts()[0]?.accountId;
    }
    getAccountName(accountId) {
        if (!accountId) {
            return undefined;
        }
        return (0, accountMetaManager_1.getAccountMetaManager)().listAccounts().find((item) => item.accountId === accountId)?.displayName || accountId;
    }
    renderHtml(webview) {
        const configThemes = vscode.workspace.getConfiguration('weread').get('exportThemes');
        const defaultThemes = [
            { id: 'white', name: '纯白', bg: '#FFFFFF', primary: '#312927', weekday: '#5A514D', divider: '#D5CEC4', watermark: '#757575', check: '#312927' },
            { id: 'gray', name: '浅灰', bg: '#F5F5F5', primary: '#312927', weekday: '#5A514D', divider: '#D5CEC4', watermark: '#757575', check: '#312927' },
            { id: 'yellow', name: '暖黄', bg: '#FDF6E3', primary: '#382C24', weekday: '#5C4A3D', divider: '#E6D3B8', watermark: '#8C7765', check: '#382C24' },
            { id: 'green', name: '浅绿', bg: '#EAF4EC', primary: '#1E3624', weekday: '#3D5C45', divider: '#C2DBC7', watermark: '#6F8C76', check: '#1E3624' },
            { id: 'dark', name: '暗夜黑', bg: '#1E1E1E', primary: '#E0E0E0', weekday: '#B0B0B0', divider: '#404040', watermark: '#808080', check: '#E0E0E0' },
            { id: 'blue', name: '深蓝', bg: '#1A2332', primary: '#DDE2ED', weekday: '#A9B4C7', divider: '#34415B', watermark: '#7887A1', check: '#DDE2ED' },
            { id: 'pink', name: '莫兰迪粉', bg: '#F6EBEA', primary: '#4A3130', weekday: '#6B4A49', divider: '#E0CACA', watermark: '#9C7A79', check: '#4A3130' },
            { id: 'kraft', name: '牛皮纸', bg: '#E8DCC8', primary: '#3B2F23', weekday: '#594A3A', divider: '#C9B8A1', watermark: '#8A7B68', check: '#3B2F23' },
        ];
        const EXPORT_THEMES = (configThemes && configThemes.length > 0) ? configThemes : defaultThemes;
        const themesJson = JSON.stringify(EXPORT_THEMES);

        const nonce = buildNonce();
        const compassIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.59 9.41 9 11l1.59 5.59L16 15l-1.41-5.59Zm-1.15 4.03-1.88.53.53-1.88 1.88-.53-.53 1.88ZM12 2c5.52 0 10 4.48 10 10s-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2Zm0 2.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6Z"/></svg>';
        const bookIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.75 4.5h9a2.25 2.25 0 0 1 2.25 2.25v10.5a.75.75 0 0 1-1.096.666A3.74 3.74 0 0 0 15.188 17.5H7.5A2.25 2.25 0 0 1 5.25 15.25V6A1.5 1.5 0 0 1 6.75 4.5Zm0 1.5V15.25c0 .414.336.75.75.75h7.688c.452 0 .9.082 1.312.24V6.75a.75.75 0 0 0-.75-.75h-9Zm2.25 2.25h5.25a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1 0-1.5Zm0 3h5.25a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1 0-1.5Z"/></svg>';
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com`,
            `script-src ${webview.cspSource} 'unsafe-inline' 'nonce-${nonce}'`,
            `font-src https://cdnjs.cloudflare.com`,
            `img-src ${webview.cspSource} data: blob:`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>笔记漫游</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />
  <style>
    :root {
      --bg-page: var(--vscode-editor-background);
      --bg-card: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      --bg-header: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --bg-stat: var(--vscode-editor-background);
      --border-subtle: var(--vscode-panel-border);
      --border-card: var(--vscode-widget-border, var(--vscode-panel-border));
      --text-primary: var(--vscode-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --text-muted: color-mix(in srgb, var(--vscode-descriptionForeground) 60%, transparent);
      --accent-blue: var(--vscode-focusBorder);
      --accent-green: #52C41A;
      --status-green: #52C41A;
      --accent-gold: var(--vscode-charts-yellow, #e5c07b);
      --accent-purple: var(--vscode-charts-purple, #c678dd);
      --accent-red: var(--vscode-charts-red, #f44747);
      --control-height: 32px;
      --radius-card: 18px;
      --radius-btn: 12px;
      --radius-tag: 20px;
      --transition: 0.3s cubic-bezier(0.22, 1, 0.36, 1);
      --shadow-depth-1: 0 2px 4px rgba(0, 0, 0, 0.1), 0 4px 8px rgba(0, 0, 0, 0.1);
      --shadow-depth-2: 0 4px 8px rgba(0, 0, 0, 0.2), 0 8px 16px rgba(0, 0, 0, 0.2);
      --shadow-depth-3: 0 10px 20px rgba(0, 0, 0, 0.3), 0 20px 40px rgba(0, 0, 0, 0.2);
      --shadow-card: 0 20px 60px rgba(0, 0, 0, 0.4);
      --shadow-popover: 0 12px 48px rgba(0, 0, 0, 0.5);
      --header-icon-size: 22px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100vh;
      width: 100vw;
      background: var(--bg-page);
      color: var(--text-primary);
      font-family: var(--vscode-font-family);
      overflow: hidden;
      display: flex;
    }

    .app-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--bg-page);
      position: relative;
      padding: 10px;
      gap: 0;
    }

    /* ========== Header & Filter Panel ========== */
    .header-filter-panel {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      box-shadow: var(--shadow-depth-1);
      position: relative;
      margin-bottom: 10px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: nowrap;
      gap: 8px;
      padding: 12px 16px;
    }
    .header.wrap {
      flex-wrap: wrap;
      align-items: flex-start;
    }

    .header-left { display: flex; align-items: center; gap: 16px; min-width: 0; flex-wrap: nowrap; flex: 1 1 auto; }
    .header.wrap .header-left { flex: 1 1 100%; }
    .logo-area { display: flex; align-items: center; gap: 10px; flex-shrink: 0; white-space: nowrap; }
    .logo-icon {
      font-size: 18px;
      color: var(--accent-blue);
      background: color-mix(in srgb, var(--accent-blue) 12%, transparent);
      padding: 6px;
      border-radius: 10px;
      width: 34px; height: 34px;
      display: flex; align-items: center; justify-content: center;
    }
    .logo-icon svg {
      width: 18px;
      height: 18px;
      display: block;
    }
    .logo-icon:empty::before {
      content: "N";
      font-size: 16px;
      font-weight: 700;
      line-height: 1;
    }
    .logo-text { 
      font-size: 17px; 
      font-weight: 600; 
      letter-spacing: 0.3px;
      background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    /* Progress Ring */
    .progress-ring-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg-page);
      padding: 4px 14px 4px 8px;
      border-radius: 40px;
      border: 1px solid var(--border-subtle);
      cursor: default;
      height: var(--control-height);
      flex-shrink: 0;
    }
    .progress-ring-wrap svg {
      width: var(--header-icon-size);
      height: var(--header-icon-size);
      transform: rotate(-90deg);
    }
    .progress-ring-wrap svg circle {
      fill: none;
      stroke-width: 3;
    }
    .progress-ring-bg { stroke: var(--border-subtle); }
    .progress-ring-fg {
      stroke: var(--status-green);
      stroke-linecap: round;
      transition: stroke-dashoffset 0.6s ease;
      stroke-dasharray: 94.2;
      stroke-dashoffset: 94.2;
    }
    .progress-text {
      font-size: 13px;
      color: var(--text-secondary);
      font-weight: 500;
      letter-spacing: 0.2px;
      white-space: nowrap;
    }

    .header-right { 
      display: flex; 
      align-items: center; 
      gap: 10px; 
      position: relative;
      min-width: 0;
      flex-wrap: nowrap;
      flex: 0 1 auto;
      justify-content: flex-end;
    }
    .header.wrap .header-right {
      width: 100%;
      flex: 1 1 100%;
      flex-wrap: wrap;
      row-gap: 4px;
    }
    .account-info { 
      font-size: 12px; 
      color: var(--text-secondary); 
      background: var(--bg-page);
      padding: 4px 12px 4px 6px;
      border-radius: 40px;
      border: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 80px;
      max-width: min(46vw, 420px);
      height: var(--control-height);
      flex-shrink: 1;
    }
    .account-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      flex: 1;
    }
    .header.compact .account-info {
      min-width: var(--control-height);
      width: var(--control-height);
      max-width: var(--control-height);
      padding: 4px;
      justify-content: center;
    }
    .header.compact .account-name {
      display: none;
    }
    .header.bp-1200 .account-info {
      max-width: min(42vw, 340px);
    }
    .header.bp-960 .header-right {
      justify-content: flex-start;
      row-gap: 6px;
    }
    .header.bp-960 .account-info {
      max-width: min(70vw, 360px);
    }
    .header.bp-768 .progress-ring-wrap {
      padding: 4px 10px 4px 8px;
    }
    .header.bp-640 .progress-ring-wrap {
      padding: 4px 8px;
      min-width: 40px;
    }
    .header.bp-640 .progress-text {
      display: none;
    }
    .account-avatar {
      width: var(--header-icon-size);
      height: var(--header-icon-size);
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 600;
      color: #fff;
      flex-shrink: 0;
    }

    .btn-icon {
      background: transparent; border: none;
      color: var(--text-muted); font-size: 16px;
      cursor: pointer; padding: 6px; border-radius: 8px;
      transition: var(--transition);
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px;
    }
    .btn-icon:hover { color: var(--text-primary); background: rgba(255, 255, 255, 0.06); }
    .btn-icon.active { color: var(--accent-blue); background: color-mix(in srgb, var(--accent-blue) 12%, transparent); }

    /* Data Popover */
    .data-popover {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-card);
      padding: 18px 20px 16px 20px;
      min-width: 320px;
      max-width: 420px;
      box-shadow: var(--shadow-popover);
      opacity: 0;
      transform: translateY(-8px) scale(0.96);
      pointer-events: none;
      transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
      z-index: 100;
      backdrop-filter: blur(4px);
    }
    .data-popover.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .data-popover-inner {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
    .popover-stat {
      background: var(--bg-stat);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 8px 12px;
      text-align: center;
      transition: var(--transition);
      cursor: default;
      min-height: 52px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .popover-stat:hover {
      border-color: var(--text-muted);
      background: color-mix(in srgb, var(--bg-card) 80%, var(--text-primary) 5%);
    }
    .popover-stat .stat-value {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.2;
    }
    .popover-stat .stat-value .unit {
      font-size: 13px;
      font-weight: 400;
      color: var(--text-muted);
      margin-left: 2px;
    }
    .popover-stat .stat-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .popover-stat .stat-label i { font-size: 10px; opacity: 0.6; }
    .popover-trend {
      grid-column: span 2;
      background: var(--bg-stat);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 6px 12px 8px 12px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 52px;
      margin-top: 0;
    }
    .popover-trend .chart-label {
      font-size: 10px;
      color: var(--text-muted);
      text-align: left;
      margin-bottom: 2px;
      letter-spacing: 0.3px;
      display: flex;
      justify-content: space-between;
    }
    .popover-trend svg {
      width: 100%;
      height: 32px;
      display: block;
    }
    .popover-trend svg rect { transition: height 0.4s ease, opacity 0.3s ease; }
    .trend-tooltip {
      margin-top: 4px;
      font-size: 10px;
      color: var(--text-secondary);
      min-height: 14px;
    }
    .popover-arrow {
      position: absolute;
      top: -6px;
      right: 14px;
      width: 12px;
      height: 12px;
      background: var(--bg-card);
      border-left: 1px solid var(--border-subtle);
      border-top: 1px solid var(--border-subtle);
      transform: rotate(45deg);
    }

    .filter-divider {
      height: 1px;
      background: var(--border-subtle);
      margin: 0 16px;
    }

    /* ========== Filter Bar ========== */
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      flex-wrap: nowrap;
      overflow: visible;
      width: 100%;
      min-width: 0;
    }
    .filter-bar.wrap { flex-wrap: wrap; }

    .filter-section {
      display: contents;
    }
    .filter-v-sep {
      width: 1px;
      height: 18px;
      background: var(--border-subtle);
      margin: 0 2px;
      flex-shrink: 0;
    }

    .filter-label {
      font-size: 12px;
      color: var(--text-secondary);
      margin-right: 4px;
      white-space: nowrap;
    }

    input[type="number"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 3px 8px;
      border-radius: 8px;
      font-size: 12px;
      height: 26px;
      width: 50px;
      outline: none;
    }
    .filter-tag {
      font-size: 12px;
      padding: 4px 14px;
      border-radius: 40px;
      border: 1px solid var(--border-subtle);
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      transition: var(--transition);
      font-weight: 500;
      letter-spacing: 0.2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .filter-tag i { font-size: 11px; }
    .filter-tag:hover { border-color: var(--text-muted); color: var(--text-primary); }
    .filter-tag.active {
      background: color-mix(in srgb, var(--accent-green) 18%, transparent);
      border-color: var(--accent-green);
      color: var(--accent-green);
    }
    .filter-tag.active i { color: var(--accent-green); }
    .filter-spacer { flex: 1; }
    .filter-clear {
      font-size: 12px;
      color: var(--text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 4px 12px;
      border-radius: 20px;
      transition: var(--transition);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .filter-clear:hover { color: var(--text-primary); background: rgba(255, 255, 255, 0.05); }
    .filter-clear.hidden { display: none; }

    /* ========== Card Container ========== */
    .card-container {
      flex: 1;
      display: flex;
      align-items: stretch;
      justify-content: stretch;
      padding: 20px 0;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }

    /* ========== Note Card ========== */
    .note-card {
      background: var(--bg-card);
      border: 1px solid var(--border-card);
      border-radius: var(--radius-card);
      padding: 22px 28px 18px 28px;
      width: 100%;
      height: 100%;
      box-shadow: var(--shadow-card);
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: transform, opacity;
    }
    .note-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-green), var(--accent-gold));
      opacity: 0.5;
    }
    .note-card.card-enter {
      animation: cardEnter 0.4s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .note-card.card-exit {
      animation: cardExit 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }
    @keyframes cardEnter {
      from { opacity: 0; transform: translateY(20px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes cardExit {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(-20px) scale(0.98); }
    }

    /* Quote Line */
    .quote-line {
      position: absolute;
      left: 10px;
      top: 44px;
      bottom: 44px;
      width: 3px;
      border-radius: 4px;
      background: var(--accent-blue);
      opacity: 0.55;
      display: none;
    }
    .quote-line.visible { display: block; }

    /* Corner Favorite */
    .corner-fav {
      position: absolute;
      top: 14px;
      right: 16px;
      font-size: 15px;
      color: var(--text-muted);
      transition: var(--transition);
      cursor: pointer;
      z-index: 2;
    }
    .corner-fav:hover { color: var(--accent-gold); transform: scale(1.1); }
    .corner-fav.active {
      color: var(--accent-gold);
      text-shadow: 0 0 20px color-mix(in srgb, var(--accent-gold) 30%, transparent);
    }

    /* Card Header */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6px;
      flex-shrink: 0;
      padding-right: 30px;
    }
    .card-book { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .card-book i { font-size: 13px; color: var(--accent-blue); opacity: 0.7; flex-shrink: 0; }
    .card-book-icon {
      width: 14px;
      height: 14px;
      color: var(--accent-blue);
      opacity: 0.78;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .card-book-icon svg {
      width: 14px;
      height: 14px;
      display: block;
    }
    .card-book-icon:empty::before {
      content: "B";
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }
    .card-book-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-chapter {
      font-size: 13px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-chapter::before {
      content: '·';
      margin: 0 6px;
      color: var(--text-muted);
    }

    /* Card Meta */
    .card-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 10px;
      flex-shrink: 0;
      font-size: 12px;
      color: var(--text-muted);
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .card-meta-item { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
    .card-meta-item i { font-size: 11px; opacity: 0.5; flex-shrink: 0; }
    .card-note-type {
      white-space: nowrap;
    }

    /* Card Body */
    .card-body {
      flex: 1;
      overflow: hidden;
      padding: 8px 0;
      min-height: 40px;
      position: relative;
    }
    .card-content {
      font-size: 15px;
      line-height: 1.7;
      color: var(--text-primary);
      white-space: pre-wrap;
      word-break: break-word;
      height: 100%;
      overflow-y: auto;
      padding-right: 6px;
      scrollbar-width: thin;
      scrollbar-color: var(--border-subtle) transparent;
    }
    .card-content::-webkit-scrollbar { width: 5px; }
    .card-content::-webkit-scrollbar-track { background: transparent; }
    .card-content::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 10px; }
    .card-content::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
    .card-content .quote-mark {
      color: var(--text-muted);
      font-size: 18px;
      line-height: 0;
      opacity: 0.3;
      margin-right: 4px;
    }

    /* Card Footer */
    .card-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      flex-shrink: 0;
      padding-top: 8px;
      border-top: 1px solid var(--border-subtle);
      flex-wrap: wrap;
    }
    .card-tag {
      font-size: 11px;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.04);
      padding: 2px 12px;
      border-radius: var(--radius-tag);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: var(--transition);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .card-tag i { font-size: 10px; }
    .card-tag:hover { border-color: var(--text-muted); color: var(--text-secondary); }
    .card-tag.reviewed {
      color: var(--accent-green);
      border-color: color-mix(in srgb, var(--accent-green) 25%, transparent);
      background: color-mix(in srgb, var(--accent-green) 6%, transparent);
    }
    .card-tag.fav {
      color: var(--accent-gold);
      border-color: color-mix(in srgb, var(--accent-gold) 20%, transparent);
      background: color-mix(in srgb, var(--accent-gold) 6%, transparent);
    }

    /* ========== Shortcut & Action Panel ========== */
    .shortcut-action-panel {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      box-shadow: var(--shadow-depth-1);
      overflow: visible;
      margin-top: 10px;
      position: relative;
      z-index: 20;
    }

    /* ========== Shortcut Bar ========== */
    .shortcut-bar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 4px;
      padding: 6px 20px;
      flex-shrink: 0;
      font-size: 11px;
      color: var(--text-muted);
      background: color-mix(in srgb, var(--bg-page) 80%, #000 20%);
      border-bottom: 1px solid var(--border-subtle);
      min-height: 32px;
      flex-wrap: wrap;
      row-gap: 4px;
      column-gap: 4px;
      position: relative;
      overflow: visible;
      z-index: 30;
    }
    .shortcut-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border-subtle);
      background: color-mix(in srgb, var(--bg-page) 90%, #000 10%);
      color: var(--text-secondary);
      border-radius: 8px;
      padding: 3px 8px;
      white-space: nowrap;
      overflow: hidden;
      min-width: 0;
      cursor: pointer;
      pointer-events: auto;
      transition: var(--transition);
      font-size: 11px;
      line-height: 1.2;
    }
    .shortcut-btn:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
      background: rgba(255, 255, 255, 0.06);
    }
    .shortcut-btn i { font-size: 11px; opacity: 0.85; }
    .shortcut-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 48px;
    }
    .shortcut-key {
      background: rgba(255, 255, 255, 0.08);
      padding: 0 6px;
      border-radius: 4px;
      font-size: 10px;
      color: var(--text-muted);
      border: 1px solid var(--border-subtle);
      margin-left: 2px;
      flex-shrink: 0;
    }
    .shortcut-more-wrap { display: none; position: relative; }
    .shortcut-more-menu {
      display: none;
      position: absolute;
      right: 0;
      top: auto;
      bottom: calc(100% + 6px);
      min-width: 150px;
      padding: 6px;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--bg-card);
      box-shadow: var(--shadow-depth-2);
      z-index: 320;
      gap: 4px;
      flex-direction: column;
      transform-origin: bottom right;
    }
    .shortcut-more-menu.open { display: flex; }
    .shortcut-more-item {
      justify-content: space-between;
      width: 100%;
    }
    .shortcut-collapse-secondary .shortcut-btn.secondary { display: none; }
    .shortcut-collapse-secondary .shortcut-more-wrap { display: block; }
    .shortcut-bar.bp-1200 .shortcut-label { max-width: 40px; }
    .shortcut-bar.bp-960 .shortcut-btn.secondary { display: none; }
    .shortcut-bar.bp-960 .shortcut-more-wrap { display: block; }
    .shortcut-bar.bp-768 .shortcut-btn .shortcut-key { display: none; }
    .shortcut-bar.bp-640 .shortcut-btn .shortcut-label,
    .shortcut-bar.bp-640 .shortcut-btn .shortcut-key { display: none; }
    .shortcut-bar.bp-640 .shortcut-btn {
      padding: 4px 8px;
      min-width: 30px;
      justify-content: center;
    }
    .shortcut-icon-only .shortcut-btn .shortcut-label,
    .shortcut-icon-only .shortcut-btn .shortcut-key { display: none; }
    .shortcut-icon-only .shortcut-btn {
      padding: 4px 8px;
      min-width: 30px;
      justify-content: center;
    }

    /* ========== Action Bar ========== */
    .action-bar {
      display: flex;
      align-items: stretch;
      justify-content: flex-start;
      padding: 8px 20px 12px 20px;
      flex-shrink: 0;
      gap: 4px;
      flex-wrap: nowrap;
      min-height: 48px;
      overflow-x: auto;
      overflow-y: visible;
      scrollbar-width: thin;
    }
    .action-bar.wrap {
      flex-wrap: wrap;
      overflow-x: hidden;
      row-gap: 6px;
    }
    .action-bar::-webkit-scrollbar { height: 4px; }
    .action-group { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .action-group.nav-group { flex: 0 0 auto; }
    .action-group.main-group {
      flex: 1 1 320px;
      flex-wrap: nowrap;
      justify-content: flex-end;
      min-width: 0;
    }
    .action-bar.wrap .action-group.main-group { flex-wrap: wrap; justify-content: flex-start; }
    .action-bar.wrap .action-group { width: 100%; }
    .action-bar.bp-1200 .action-btn .label { max-width: 36px; }
    .action-bar.bp-960 {
      row-gap: 6px;
    }
    .action-bar.bp-960 .action-group.main-group {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    .action-bar.bp-768 {
      flex-wrap: wrap;
      overflow-x: hidden;
    }
    .action-bar.bp-640 .action-btn .kbd {
      display: none;
    }
    .action-progress {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0 2px;
      letter-spacing: 0.2px;
      display: inline-flex;
      align-items: center;
      min-width: 62px;
      max-width: 96px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .action-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      background: var(--bg-page);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      padding: 6px 14px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: var(--transition);
      white-space: nowrap;
      min-width: 0;
      max-width: 160px;
      flex-shrink: 0;
    }
    .action-btn:hover { border-color: var(--accent-blue); color: var(--text-primary); background: rgba(255, 255, 255, 0.05); }
    .action-btn.nav { padding: 6px 10px; }
    .action-btn .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 42px;
    }
    .action-btn .kbd {
      font-size: 10px;
      background: rgba(255, 255, 255, 0.08);
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      margin-left: 2px;
    }

    /* Gold Favorite Button */
    .action-btn.gold {
      color: var(--text-secondary);
    }
    .action-btn.gold:hover {
      border-color: var(--accent-gold);
      color: var(--accent-gold);
      background: color-mix(in srgb, var(--accent-gold) 10%, transparent);
    }
    .action-btn.gold.active {
      background: color-mix(in srgb, var(--accent-gold) 20%, transparent);
      border-color: var(--accent-gold);
      color: var(--accent-gold);
    }
    .action-btn.gold.active:hover {
      background: color-mix(in srgb, var(--accent-gold) 25%, transparent);
    }

    /* Green Review Button */
    .action-btn.green {
      color: var(--text-secondary);
    }
    .action-btn.green:hover {
      border-color: var(--accent-green);
      color: var(--accent-green);
      background: color-mix(in srgb, var(--accent-green) 10%, transparent);
    }
    .action-btn.green.active {
      background: color-mix(in srgb, var(--accent-green) 20%, transparent);
      border-color: var(--accent-green);
      color: var(--accent-green);
    }
    .action-btn.green.active:hover {
      background: color-mix(in srgb, var(--accent-green) 25%, transparent);
    }

    .action-divider {
      width: 1px;
      height: 20px;
      background: var(--border-subtle);
      margin: 0 4px;
    }

    /* ========== Feedback Particles ========== */
    .feedback-container {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 100;
    }
    .particle {
      position: absolute;
      pointer-events: none;
      animation: particleFloat 0.8s ease-out forwards;
    }
    @keyframes particleFloat {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.5); }
    }

    /* ========== Preference Toast ========== */
    .preference-toast {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 10px 16px;
      font-size: 13px;
      color: var(--text-primary);
      box-shadow: var(--shadow-depth-2);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .preference-toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    .preference-toast i { color: var(--accent-gold); }
    .undo-btn {
      background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
      border: 1px solid var(--accent-blue);
      color: var(--accent-blue);
      padding: 2px 10px;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
      transition: var(--transition);
    }
    .undo-btn:hover { background: color-mix(in srgb, var(--accent-blue) 25%, transparent); }

    .favorite-animating {
      animation: favoriteStarPulse 600ms cubic-bezier(0.22, 0.82, 0.26, 1) both;
      transform-origin: center center;
      will-change: transform;
    }
    @keyframes favoriteStarPulse {
      0% { transform: scale(1) rotate(0deg); }
      40% { transform: scale(1.35) rotate(18deg); }
      70% { transform: scale(0.88) rotate(-10deg); }
      100% { transform: scale(1) rotate(0deg); }
    }

    /* ========== Empty State ========== */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-muted);
      text-align: center;
      padding: 40px;
      width: 100%;
      height: 100%;
    }
    .empty-state i { font-size: 40px; opacity: 0.2; }
    .empty-state p {
      max-width: min(720px, 100%);
      margin: 0 auto;
      text-align: center;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.5;
    }
    .empty-state p:hover {
      -webkit-line-clamp: initial;
      overflow: visible;
    }
    .card-host {
      width: 100%;
      height: 100%;
      display: flex;
    }
    .card-host .note-card {
      width: 100%;
      height: 100%;
    }

    /* ========== Export Modal ========== */
    .export-modal-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: none; justify-content: center; align-items: center;
      z-index: 1000; opacity: 0; transition: opacity 0.2s;
    }
    .export-modal-overlay.show { display: flex; opacity: 1; }
    .export-modal {
      background: var(--bg-card); border-radius: 12px; width: min(720px, calc(100vw - 32px));
      box-shadow: var(--shadow-popover); border: 1px solid var(--border-subtle);
      display: flex; flex-direction: row; overflow: hidden;
      transform: translateY(20px); transition: transform 0.2s;
      max-height: 90vh; height: auto; min-height: 0;
    }
    .export-modal-overlay.show .export-modal { transform: translateY(0); }
    .export-modal-preview-container {
      flex: 1;
      background: var(--bg-page);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 20px;
      border-right: 1px solid var(--border-subtle);
      overflow: auto;
      min-width: 0;
      min-height: 0;
      scrollbar-width: thin;
      scrollbar-color: var(--border-subtle) transparent;
    }
    .export-modal-preview-container::-webkit-scrollbar { width: 6px; }
    .export-modal-preview-container::-webkit-scrollbar:horizontal { height: 6px; }
    .export-modal-preview-container::-webkit-scrollbar-track { background: transparent; }
    .export-modal-preview-container::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 999px; }
    .export-modal-preview-stage {
      width: max-content;
      min-width: 100%;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .export-modal-preview-image {
      display: block;
      width: 400px;
      max-width: none;
      flex: 0 0 auto;
      height: auto;
      box-shadow: var(--shadow-depth-1);
      border-radius: 4px;
    }
    .export-modal-settings {
      width: 180px;
      flex: 0 0 180px;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .export-modal-header {
      padding: 16px 20px; border-bottom: 1px solid var(--border-subtle);
      display: flex; justify-content: space-between; align-items: center;
      font-weight: 600; font-size: 15px; color: var(--text-primary);
    }
    .export-modal-close {
      background: none; border: none; color: var(--text-muted); cursor: pointer;
      font-size: 16px; padding: 4px; border-radius: 4px; transition: var(--transition);
    }
    .export-modal-close:hover { color: var(--text-primary); background: rgba(255,255,255,0.1); }
    .export-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 20px; flex: 1; overflow-y: auto; }
    .export-field { display: flex; flex-direction: column; gap: 12px; }
    .export-field-label { font-size: 13px; color: var(--text-secondary); }
    .export-radio-group {
      display: flex; flex-direction: column; gap: 8px;
    }
    .export-radio-label {
      display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary); cursor: pointer;
    }
    .export-radio-label input[type="radio"] {
      margin: 0; cursor: pointer;
    }
    .color-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .color-item {
      aspect-ratio: 1 / 1; border-radius: 8px; cursor: pointer;
      border: 2px solid transparent; box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex; align-items: center; justify-content: center;
      transition: var(--transition);
    }
    .color-item:hover { transform: scale(1.05); }
    .color-item.active { border-color: var(--accent-blue); transform: scale(1.05); }
    .color-item i { color: inherit; font-size: 16px; display: none; }
    .color-item.active i { display: block; }
    .export-modal-footer {
      padding: 16px 20px; border-top: 1px solid var(--border-subtle);
      display: flex; flex-direction: column; gap: 8px; background: var(--bg-page);
    }
    .btn {
      padding: 8px 16px; border-radius: 6px; font-size: 13px; cursor: pointer;
      border: 1px solid var(--border-subtle); background: var(--bg-card); color: var(--text-primary);
      transition: var(--transition);
      text-align: center;
    }
    .btn.primary {
      background: var(--vscode-button-background, var(--accent-blue));
      color: var(--vscode-button-foreground, #ffffff);
      border-color: var(--vscode-button-background, var(--accent-blue));
      font-weight: 600;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .btn:hover { filter: brightness(1.06); }
    .btn.primary:hover {
      background: var(--vscode-button-hoverBackground, color-mix(in srgb, var(--vscode-button-background, var(--accent-blue)) 88%, black));
      border-color: var(--vscode-button-hoverBackground, color-mix(in srgb, var(--vscode-button-background, var(--accent-blue)) 88%, black));
      filter: none;
    }
    .btn:disabled {
      cursor: not-allowed;
      opacity: 0.6;
      filter: none;
    }

    /* ========== Toast ========== */
    .toast {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(-100px);
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 10px 20px;
      font-size: 13px;
      color: var(--text-primary);
      box-shadow: var(--shadow-depth-2);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    .toast.success { border-color: var(--accent-green); color: var(--accent-green); }
    .toast.info { border-color: var(--accent-blue); color: var(--accent-blue); }
    .toast.warning { border-color: var(--accent-gold); color: var(--accent-gold); }

    /* ========== Responsive ========== */
    @media (max-width: 640px) {
      .app-container { padding: 8px; }
      .header { padding: 10px 12px; }
      .header-left { gap: 10px; }
      .header-right { gap: 4px; justify-content: flex-end; }
      .header.wrap .header-left { flex: 1 1 100%; }
      .header.wrap .header-right { width: 100%; row-gap: 4px; }
      .account-info { min-width: 80px; }
      .header-right > .btn-icon { margin-left: 0; }
      .note-card { padding: 18px 20px 14px 20px; }
      .note-card .quote-line { left: 8px; top: 36px; bottom: 36px; width: 2px; }
      .data-popover { min-width: 260px; max-width: 320px; right: -8px; padding: 14px 14px 12px 14px; }
      .data-popover-inner { gap: 6px; }
      .popover-stat { padding: 6px 8px; min-height: 44px; }
      .popover-trend { padding: 4px 8px 6px 8px; min-height: 44px; }
      .popover-trend svg { height: 26px; }
      .popover-arrow { right: 6px; }
      .shortcut-bar { gap: 4px; row-gap: 4px; column-gap: 4px; }
      .action-bar { padding: 8px 12px 12px 12px; }
      .action-btn { max-width: 132px; }
      .action-btn .label { max-width: 34px; }
    }
    @media (max-width: 420px) {
      .card-meta { gap: 4px; }
      .action-divider { display: none; }
      .note-card .corner-fav { top: 10px; right: 10px; font-size: 15px; }
      .data-popover { min-width: 220px; right: -12px; }
      .data-popover-inner { grid-template-columns: 1fr 1fr; }
      .popover-trend { grid-column: span 2; }
      .shortcut-bar { gap: 4px; row-gap: 4px; column-gap: 4px; font-size: 9px; }
      .action-btn { padding: 6px 10px; max-width: 116px; }
      .action-btn .kbd { margin-left: 0; }
      .action-bar.wrap .action-group.main-group { flex-basis: 100%; }
    }
  </style>
</head>
<body>
  <div class="app-container">
    <!-- Header & Filter Panel -->
    <div class="header-filter-panel">
      <header class="header">
        <div class="header-left">
          <div class="logo-area" title="笔记漫游">
            <div class="logo-icon" title="笔记漫游入口" aria-label="笔记漫游入口">${compassIconSvg}</div>
            <span class="logo-text">笔记漫游</span>
          </div>
          <div class="progress-ring-wrap" title="漫游进度：已浏览 / 总池">
            <svg viewBox="0 0 36 36">
              <circle class="progress-ring-bg" cx="18" cy="18" r="15" />
              <circle class="progress-ring-fg" id="progressRing" cx="18" cy="18" r="15" stroke-dasharray="94.2" stroke-dashoffset="94.2" />
            </svg>
            <span class="progress-text" id="progressText">0 / 0</span>
          </div>
        </div>
        <div class="header-right">
          <div class="account-info">
            <span class="account-avatar">V</span>
            <span id="meta" class="account-name">-</span>
          </div>
          <button class="btn-icon" id="refreshBtn" title="刷新漫游池 (R)"><i class="fas fa-sync-alt"></i></button>
          <button class="btn-icon" id="dataToggle" title="数据统计 (D)" aria-label="切换数据浮层">
            <i class="fas fa-chart-bar" title="数据统计"></i>
          </button>

          <!-- Data Popover -->
          <div class="data-popover" id="dataPopover">
            <div class="popover-arrow"></div>
            <div class="data-popover-inner">
              <div class="popover-stat">
                <div class="stat-value"><span id="sessionViews">0</span> <span class="unit">次</span></div>
                <div class="stat-label"><i class="fas fa-eye"></i> 会话浏览</div>
              </div>
              <div class="popover-stat">
                <div class="stat-value"><span id="todayReviews">0</span> <span class="unit">次</span></div>
                <div class="stat-label"><i class="fas fa-check"></i> 今日复习</div>
              </div>
              <div class="popover-stat">
                <div class="stat-value"><span id="favRate">0</span><span class="unit">%</span></div>
                <div class="stat-label"><i class="fas fa-star"></i> 收藏率</div>
              </div>
              <div class="popover-stat">
                <div class="stat-value"><span id="poolSize">0</span> <span class="unit">条</span></div>
                <div class="stat-label"><i class="fas fa-database"></i> 漫游池</div>
              </div>
              <div class="popover-trend" title="最近7天复习趋势">
                <div class="chart-label">
                  <span><i class="fas fa-chart-bar"></i> 近7天复习</span>
                  <span id="trendTotal">0次</span>
                </div>
                <svg id="trendChart" viewBox="0 0 120 32" preserveAspectRatio="none">
                  <!-- Bar chart rendered by JS -->
                </svg>
                <div id="trendTooltip" class="trend-tooltip">悬停柱状条查看日期与复习次数</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div class="filter-divider"></div>

      <!-- Filter Bar -->
      <div class="filter-bar">
        <div class="filter-section">
          <span class="filter-label">类型</span>
          <button class="filter-tag active" data-filter="all"><i class="fas fa-th-large"></i> 全部</button>
          <button class="filter-tag" data-filter="highlight"><i class="fas fa-highlighter"></i> 高亮</button>
          <button class="filter-tag" data-filter="thought"><i class="fas fa-lightbulb"></i> 想法</button>
          <button class="filter-tag" data-filter="chapter"><i class="fas fa-bookmark"></i> 章节</button>
          <button class="filter-tag" data-filter="review"><i class="fas fa-book-open"></i> 书评</button>
        </div>
        <div class="filter-section">
          <button class="filter-tag" data-filter="favorite"><i class="fas fa-star"></i> 收藏</button>
          <span class="filter-v-sep" aria-hidden="true"></span>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:12px; color:var(--text-secondary);">未复习 ></span>
            <input id="daysFilter" type="number" min="0" value="7">
            <span style="font-size:12px; color:var(--text-secondary);">天</span>
          </div>
        </div>
        <span class="filter-spacer"></span>
        <button class="filter-clear hidden" id="clearFilters"><i class="fas fa-times-circle"></i> 清空</button>
      </div>
    </div>

    <!-- Card Container -->
    <div class="card-container" id="cardContainer">
      <div id="content" class="empty-state">
        <i class="fas fa-spinner fa-spin"></i>
        <p>正在加载漫游卡片...</p>
      </div>
      <!-- Feedback Particles Container -->
      <div class="feedback-container" id="feedbackContainer"></div>
      <!-- Preference Toast -->
      <div class="preference-toast" id="preferenceToast">
        <i class="fas fa-lightbulb"></i>
        <span id="prefMessage">已降低此类权重</span>
        <button class="undo-btn" id="undoPref">撤销</button>
      </div>
    </div>

    <!-- Shortcut & Action Panel -->
    <div class="shortcut-action-panel">
      <!-- Shortcut Bar -->
      <div class="shortcut-bar" id="shortcutBar">
        <button class="shortcut-btn primary" data-action="prev" title="上一条（←）" aria-label="上一条">
          <i class="fas fa-chevron-left"></i><span class="shortcut-label">上一条</span><span class="shortcut-key">←</span>
        </button>
        <button class="shortcut-btn primary" data-action="next" title="下一条（→）" aria-label="下一条">
          <i class="fas fa-chevron-right"></i><span class="shortcut-label">下一条</span><span class="shortcut-key">→</span>
        </button>
        <button class="shortcut-btn primary" data-action="markReviewed" title="复习（Space）" aria-label="复习">
          <i class="fas fa-check-circle"></i><span class="shortcut-label">复习</span><span class="shortcut-key">Space</span>
        </button>
        <button class="shortcut-btn primary" data-action="toggleFavorite" title="收藏（F）" aria-label="收藏">
          <i class="fas fa-star"></i><span class="shortcut-label">收藏</span><span class="shortcut-key">F</span>
        </button>
        <button class="shortcut-btn secondary" data-action="openSource" title="原文（O）" aria-label="原文">
          <i class="fas fa-external-link-alt"></i><span class="shortcut-label">原文</span><span class="shortcut-key">O</span>
        </button>
        <button class="shortcut-btn secondary" data-action="openEdit" title="编辑（E）" aria-label="编辑">
          <i class="fas fa-pen"></i><span class="shortcut-label">编辑</span><span class="shortcut-key">E</span>
        </button>
        <button class="shortcut-btn secondary" data-action="exportImage" title="导出图（I）" aria-label="导出图片">
          <i class="fas fa-image"></i><span class="shortcut-label">导图</span><span class="shortcut-key">I</span>
        </button>
        <button class="shortcut-btn secondary" data-action="skip" title="跳过（J）" aria-label="跳过">
          <i class="fas fa-forward"></i><span class="shortcut-label">跳过</span><span class="shortcut-key">J</span>
        </button>
        <button class="shortcut-btn secondary" data-action="refresh" title="刷新（R）" aria-label="刷新">
          <i class="fas fa-sync-alt"></i><span class="shortcut-label">刷新</span><span class="shortcut-key">R</span>
        </button>
        <button class="shortcut-btn secondary" data-action="toggleDataPopover" title="数据浮层（D）" aria-label="数据浮层">
          <i class="fas fa-chart-bar"></i><span class="shortcut-label">数据</span><span class="shortcut-key">D</span>
        </button>
        <div class="shortcut-more-wrap" id="shortcutMoreWrap">
          <button class="shortcut-btn" id="shortcutMoreBtn" title="更多快捷操作" aria-haspopup="true" aria-expanded="false">
            <i class="fas fa-ellipsis-h"></i><span class="shortcut-label">更多</span>
          </button>
          <div class="shortcut-more-menu" id="shortcutMoreMenu" role="menu" aria-label="更多快捷操作">
            <button class="shortcut-btn shortcut-more-item" data-action="openSource" role="menuitem" title="原文（O）">
              <span><i class="fas fa-external-link-alt"></i> 原文</span><span class="shortcut-key">O</span>
            </button>
            <button class="shortcut-btn shortcut-more-item" data-action="openEdit" role="menuitem" title="编辑（E）">
              <span><i class="fas fa-pen"></i> 编辑</span><span class="shortcut-key">E</span>
            </button>
            <button class="shortcut-btn shortcut-more-item" data-action="exportImage" role="menuitem" title="导出图（I）">
              <span><i class="fas fa-image"></i> 导出图</span><span class="shortcut-key">I</span>
            </button>
            <button class="shortcut-btn shortcut-more-item" data-action="skip" role="menuitem" title="跳过（J）">
              <span><i class="fas fa-forward"></i> 跳过</span><span class="shortcut-key">J</span>
            </button>
            <button class="shortcut-btn shortcut-more-item" data-action="refresh" role="menuitem" title="刷新（R）">
              <span><i class="fas fa-sync-alt"></i> 刷新</span><span class="shortcut-key">R</span>
            </button>
            <button class="shortcut-btn shortcut-more-item" data-action="toggleDataPopover" role="menuitem" title="数据浮层（D）">
              <span><i class="fas fa-chart-bar"></i> 数据</span><span class="shortcut-key">D</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Action Bar -->
      <div class="action-bar">
        <div class="action-group nav-group">
          <button class="action-btn nav" id="prevBtn" title="上一条 (←)"><i class="fas fa-chevron-left"></i></button>
          <button class="action-btn nav" id="nextBtn" title="下一条 (→)"><i class="fas fa-chevron-right"></i></button>
          <span class="action-progress" title="当前漫游位置">
            第 <span id="indexTip" style="color:var(--text-secondary);">0</span> 条
          </span>
        </div>

        <div class="action-group main-group">
          <button class="action-btn gold" id="favBtn" title="收藏（F）"><i class="far fa-star"></i><span class="label">收藏</span> <span class="kbd">F</span></button>
          <button class="action-btn green" id="reviewBtn" title="复习（Space）"><i class="fas fa-check-circle"></i><span class="label">复习</span> <span class="kbd">Space</span></button>
          <div class="action-divider"></div>
          <button class="action-btn" id="openBtn" title="打开原文（O）"><i class="fas fa-external-link-alt"></i><span class="label">原文</span> <span class="kbd">O</span></button>
          <button class="action-btn" id="editBtn" title="编辑（E）"><i class="fas fa-pen"></i><span class="label">编辑</span> <span class="kbd">E</span></button>
          <button class="action-btn" id="exportBtn" title="导出图片（I）"><i class="fas fa-image"></i><span class="label">导图</span> <span class="kbd">I</span></button>
          <button class="action-btn" id="skipBtn" title="跳过（J）"><i class="fas fa-forward"></i><span class="label">跳过</span> <span class="kbd">J</span></button>
        </div>
      </div>
      
      <!-- Export Modal -->
      <div class="export-modal-overlay" id="exportModal">
        <div class="export-modal">
          <div class="export-modal-preview-container">
            <div class="export-modal-preview-stage">
              <img class="export-modal-preview-image" id="exportPreviewImage" src="" alt="预览" />
            </div>
          </div>
          <div class="export-modal-settings">
            <div class="export-modal-header">
              <span>导出图片设置</span>
              <button class="export-modal-close" id="closeExportModal"><i class="fas fa-times"></i></button>
            </div>
            <div class="export-modal-body">
              <div class="export-field">
                <span class="export-field-label">时间类型</span>
                <div class="export-radio-group">
                  <label class="export-radio-label">
                    <input type="radio" name="exportTimeType" value="create" checked> 笔记创建时间
                  </label>
                  <label class="export-radio-label">
                    <input type="radio" name="exportTimeType" value="share"> 当前分享时间
                  </label>
                </div>
              </div>
              <div class="export-field">
                <span class="export-field-label">背景颜色</span>
                <div class="color-grid" id="exportColorGrid">
                  <!-- JS will populate this -->
                </div>
              </div>
            </div>
            <div class="export-modal-footer">
              <button class="btn primary" id="confirmExportBtn">确认导出</button>
              <button class="btn" id="cancelExportBtn">取消</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="toast" class="toast"></div>
  </div>

  <script nonce="${nonce}">
    const EXPORT_THEMES = ${themesJson};
    const vscode = acquireVsCodeApi();
    window.addEventListener('error', (event) => {
      const message = event && event.message ? String(event.message) : 'unknown_error';
      const stack = event && event.error && event.error.stack ? String(event.error.stack) : '';
      vscode.postMessage({ command: 'webviewError', message, stack });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event && event.reason ? event.reason : 'unknown_rejection';
      const message = typeof reason === 'string' ? reason : (reason && reason.message ? String(reason.message) : String(reason));
      const stack = reason && reason.stack ? String(reason.stack) : '';
      vscode.postMessage({ command: 'webviewError', message, stack });
    });
    const contentEl = document.getElementById('content');
    const metaEl = document.getElementById('meta');
    const toastEl = document.getElementById('toast');
    const progressRingEl = document.getElementById('progressRing');
    const progressTextEl = document.getElementById('progressText');
    const indexTipEl = document.getElementById('indexTip');
    const favBtnEl = document.getElementById('favBtn');
    const reviewBtnEl = document.getElementById('reviewBtn');
    const exportBtnEl = document.getElementById('exportBtn');
    const dataToggleEl = document.getElementById('dataToggle');
    const dataPopoverEl = document.getElementById('dataPopover');
    const feedbackContainerEl = document.getElementById('feedbackContainer');
    const preferenceToastEl = document.getElementById('preferenceToast');
    const filterTagsEl = document.querySelectorAll('.filter-tag');
    const daysFilterEl = document.getElementById('daysFilter');
    const clearFiltersEl = document.getElementById('clearFilters');
    const headerEl = document.querySelector('.header');
    const accountInfoEl = document.querySelector('.account-info');
    const accountAvatarEl = document.querySelector('.account-avatar');
    const filterBarEl = document.querySelector('.filter-bar');
    const actionBarEl = document.querySelector('.action-bar');
    const shortcutBarEl = document.getElementById('shortcutBar');
    const shortcutMoreWrapEl = document.getElementById('shortcutMoreWrap');
    const shortcutMoreBtnEl = document.getElementById('shortcutMoreBtn');
    const shortcutMoreMenuEl = document.getElementById('shortcutMoreMenu');
    const shortcutButtonsEl = document.querySelectorAll('.shortcut-bar .shortcut-btn');

    const exportModalEl = document.getElementById('exportModal');
    const exportPreviewImageEl = document.getElementById('exportPreviewImage');
    const exportModalDialogEl = exportModalEl ? exportModalEl.querySelector('.export-modal') : null;
    const closeExportModalBtn = document.getElementById('closeExportModal');
    const cancelExportBtn = document.getElementById('cancelExportBtn');
    const confirmExportBtn = document.getElementById('confirmExportBtn');
    const exportColorGrid = document.getElementById('exportColorGrid');
    const exportTimeTypeRadios = document.querySelectorAll('input[name="exportTimeType"]');
    const appContainerEl = document.querySelector('.app-container');
    const exportModalBlockedSiblings = appContainerEl && exportModalEl
      ? Array.from(appContainerEl.children).filter((child) => child !== exportModalEl && !child.contains(exportModalEl))
      : [];

    let currentExportTheme = EXPORT_THEMES[0] || {};
    
    // Populate color grid
    if (exportColorGrid) {
      EXPORT_THEMES.forEach((theme, index) => {
        const item = document.createElement('div');
        item.className = 'color-item' + (index === 0 ? ' active' : '');
        item.style.backgroundColor = theme.bg;
        // The checkmark color should be contrasting
        item.innerHTML = '<i class="fas fa-check" style="color:' + (theme.check || theme.primary) + '"></i>';
        item.title = theme.name;
        item.addEventListener('click', () => {
          document.querySelectorAll('.color-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          currentExportTheme = theme;
          updateExportPreview();
        });
        exportColorGrid.appendChild(item);
      });
    }

    if (exportTimeTypeRadios) {
      exportTimeTypeRadios.forEach(radio => {
        radio.addEventListener('change', updateExportPreview);
      });
    }

    function serializeExportLogDetail(detail) {
      if (detail === undefined || detail === null) {
        return '';
      }
      if (typeof detail === 'string') {
        return detail;
      }
      try {
        return JSON.stringify(detail);
      } catch (error) {
        return String(error instanceof Error ? error.message : detail);
      }
    }

    function emitExportLog(stage, detail, level) {
      const normalizedLevel = String(level || 'INFO').toUpperCase();
      const detailText = serializeExportLogDetail(detail);
      if (normalizedLevel === 'ERROR') {
        console.error('[noteRoamingExport]', stage, detailText);
      } else if (normalizedLevel === 'WARN') {
        console.warn('[noteRoamingExport]', stage, detailText);
      } else {
        console.info('[noteRoamingExport]', stage, detailText);
      }
      vscode.postMessage({
        command: 'webviewLog',
        level: normalizedLevel,
        stage: stage,
        detail: detailText,
      });
    }

    function isExportModalOpen() {
      return !!(exportModalEl && exportModalEl.classList.contains('show'));
    }

    function getExportModalFocusableElements() {
      if (!exportModalDialogEl) {
        return [];
      }
      return Array.from(exportModalDialogEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
    }

    function focusFirstExportModalElement() {
      const focusable = getExportModalFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else if (exportModalDialogEl) {
        exportModalDialogEl.focus();
      }
    }

    function syncExportModalIsolationState(open) {
      if (!exportModalEl) {
        return;
      }
      exportModalEl.setAttribute('aria-hidden', open ? 'false' : 'true');
      exportModalBlockedSiblings.forEach((el) => {
        if (open) {
          el.setAttribute('aria-hidden', 'true');
          if ('inert' in el) {
            el.inert = true;
          }
        } else {
          el.removeAttribute('aria-hidden');
          if ('inert' in el) {
            el.inert = false;
          }
        }
      });
      document.body.style.overflow = open ? 'hidden' : '';
    }

    function handleExportModalBlockedInteraction(event) {
      if (!isExportModalOpen() || !exportModalDialogEl) {
        return;
      }
      const target = event.target;
      const isInsideModal = target instanceof Node && exportModalDialogEl.contains(target);
      if (event.type === 'focusin') {
        if (!isInsideModal) {
          event.preventDefault();
          focusFirstExportModalElement();
        }
        return;
      }
      if (!isInsideModal) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }
    }

    function handleExportModalKeydownCapture(event) {
      if (!isExportModalOpen() || !exportModalDialogEl) {
        return;
      }
      const activeInsideModal = document.activeElement instanceof Node && exportModalDialogEl.contains(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        hideExportModal();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = getExportModalFocusableElements();
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!activeInsideModal) {
          event.preventDefault();
          first.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
          return;
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
          return;
        }
      }
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      if (!activeInsideModal) {
        event.preventDefault();
        focusFirstExportModalElement();
      }
    }

    document.addEventListener('click', handleExportModalBlockedInteraction, true);
    document.addEventListener('mousedown', handleExportModalBlockedInteraction, true);
    document.addEventListener('mouseup', handleExportModalBlockedInteraction, true);
    document.addEventListener('pointerdown', handleExportModalBlockedInteraction, true);
    document.addEventListener('pointerup', handleExportModalBlockedInteraction, true);
    document.addEventListener('focusin', handleExportModalBlockedInteraction, true);
    document.addEventListener('wheel', handleExportModalBlockedInteraction, { capture: true, passive: false });
    document.addEventListener('touchmove', handleExportModalBlockedInteraction, { capture: true, passive: false });
    window.addEventListener('keydown', handleExportModalKeydownCapture, true);

    if (exportPreviewImageEl) {
      exportPreviewImageEl.addEventListener('load', () => {
        emitExportLog('preview.image.load', {
          naturalWidth: exportPreviewImageEl.naturalWidth || 0,
          naturalHeight: exportPreviewImageEl.naturalHeight || 0,
          srcLength: exportPreviewImageEl.src ? exportPreviewImageEl.src.length : 0,
        });
      });
      exportPreviewImageEl.addEventListener('error', () => {
        emitExportLog('preview.image.error', {
          currentSrcLength: exportPreviewImageEl.currentSrc ? exportPreviewImageEl.currentSrc.length : 0,
        }, 'ERROR');
      });
    }

    function updateExportPreview() {
      if (!exportPreviewImageEl) {
        emitExportLog('preview.skip', 'preview image element missing', 'WARN');
        return;
      }
      if (!currentCard) {
        emitExportLog('preview.skip', 'currentCard missing', 'WARN');
        exportPreviewImageEl.removeAttribute('src');
        return;
      }
      try {
        emitExportLog('preview.generate.start', {
          noteKey: currentCard.noteKey || '',
          themeId: currentExportTheme && currentExportTheme.id ? currentExportTheme.id : '',
        });
        const dataUrl = generateExportDataUrl();
        if (!dataUrl) {
          emitExportLog('preview.generate.empty', 'generateExportDataUrl returned empty result', 'WARN');
          exportPreviewImageEl.removeAttribute('src');
          return;
        }
        exportPreviewImageEl.src = dataUrl;
        emitExportLog('preview.generate.success', {
          dataUrlLength: dataUrl.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exportPreviewImageEl.removeAttribute('src');
        emitExportLog('preview.generate.exception', message, 'ERROR');
      }
    }

    function showExportModal() {
      if (!currentCard) {
        showToast('暂无可导出的卡片', 'warning');
        return;
      }
      closeShortcutMoreMenu();
      dataPopoverEl.classList.remove('open');
      dataToggleEl.classList.remove('active');
      exportModalEl.classList.add('show');
      syncExportModalIsolationState(true);
      updateExportPreview();
      focusFirstExportModalElement();
    }

    function hideExportModal() {
      exportModalEl.classList.remove('show');
      syncExportModalIsolationState(false);
    }

    if (closeExportModalBtn) closeExportModalBtn.addEventListener('click', hideExportModal);
    if (cancelExportBtn) cancelExportBtn.addEventListener('click', hideExportModal);
    if (confirmExportBtn) confirmExportBtn.addEventListener('click', () => {
      hideExportModal();
      doExportImage();
    });

    vscode.postMessage({ command: 'webviewReady' });

    const FALLBACK_DEFAULT_MIN_DAYS = 7;
    const persistedState = vscode.getState() || {};
    let configuredDefaultMinDays = Number.isFinite(Number(persistedState.defaultMinDays))
      ? Math.max(0, Math.floor(Number(persistedState.defaultMinDays)))
      : FALLBACK_DEFAULT_MIN_DAYS;
    let currentFilter = { noteTypes: [], favoriteOnly: false, minDaysUnreviewed: configuredDefaultMinDays };
    let latestPersistedState = persistedState;
    let toastTimeout = null;
    let currentCard = null;
    let isFavoriteAnimating = false;
    let favoriteUnlockTimer = null;
    let adaptiveTicking = false;
    function applyBreakpointClasses(el) {
      if (!el) {
        return;
      }
      const vw = window.innerWidth || 0;
      el.classList.toggle('bp-1200', vw <= 1200);
      el.classList.toggle('bp-960', vw <= 960);
      el.classList.toggle('bp-768', vw <= 768);
      el.classList.toggle('bp-640', vw <= 640);
    }
    shortcutButtonsEl.forEach((btn) => {
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('aria-disabled', 'false');
    });

    // Progress Ring
    function updateProgressRing(current, total) {
      const circumference = 2 * Math.PI * 15;
      const progress = current / Math.max(total, 1);
      const offset = circumference - progress * circumference;
      progressRingEl.style.strokeDasharray = circumference;
      progressRingEl.style.strokeDashoffset = offset;
      progressTextEl.textContent = current + ' / ' + total;
    }

    // Data Popover
    function toggleDataPopover() {
      dataPopoverEl.classList.toggle('open');
      dataToggleEl.classList.toggle('active');
    }
    function closeShortcutMoreMenu() {
      if (!shortcutMoreMenuEl || !shortcutMoreBtnEl) {
        return;
      }
      shortcutMoreMenuEl.classList.remove('open');
      shortcutMoreBtnEl.setAttribute('aria-expanded', 'false');
    }
    function toggleShortcutMoreMenu() {
      if (!shortcutMoreMenuEl || !shortcutMoreBtnEl) {
        return;
      }
      const open = !shortcutMoreMenuEl.classList.contains('open');
      shortcutMoreMenuEl.classList.toggle('open', open);
      shortcutMoreBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function runShortcutAction(action) {
      if (action === 'prev') vscode.postMessage({ command: 'prev' });
      else if (action === 'next' || action === 'skip') vscode.postMessage({ command: 'next' });
      else if (action === 'markReviewed') vscode.postMessage({ command: 'markReviewed' });
      else if (action === 'toggleFavorite') triggerFavoriteAnimationAndToggle();
      else if (action === 'openSource') vscode.postMessage({ command: 'openSource' });
      else if (action === 'openEdit') vscode.postMessage({ command: 'openEdit' });
      else if (action === 'exportImage') showExportModal();
      else if (action === 'refresh') vscode.postMessage({ command: 'refresh' });
      else if (action === 'toggleDataPopover') toggleDataPopover();
      closeShortcutMoreMenu();
    }
    function updateAdaptiveLayout() {
      if (!headerEl || !shortcutBarEl) {
        return;
      }
      const vw = window.innerWidth || 0;
      const bp960 = vw <= 960;
      const bp768 = vw <= 768;
      const bp640 = vw <= 640;
      applyBreakpointClasses(headerEl);
      applyBreakpointClasses(filterBarEl);
      applyBreakpointClasses(actionBarEl);
      applyBreakpointClasses(shortcutBarEl);
      headerEl.classList.remove('wrap');
      headerEl.classList.remove('compact');
      const headerOverflow = headerEl.scrollWidth > headerEl.clientWidth + 2;
      if (headerOverflow) {
        headerEl.classList.add('wrap');
      }
      const wrappedStillOverflow = headerEl.scrollWidth > headerEl.clientWidth + 2;
      headerEl.classList.toggle('compact', bp640 || (bp768 && wrappedStillOverflow));
      if (filterBarEl) {
        filterBarEl.classList.remove('wrap');
        const filterOverflow = filterBarEl.scrollWidth > filterBarEl.clientWidth + 2;
        filterBarEl.classList.toggle('wrap', bp768 || filterOverflow);
      }
      if (actionBarEl) {
        actionBarEl.classList.remove('wrap');
        actionBarEl.style.flexWrap = 'nowrap';
        const actionOverflow = actionBarEl.scrollWidth > actionBarEl.clientWidth + 2;
        const forceWrapByViewport = bp768;
        actionBarEl.classList.toggle('wrap', actionOverflow || forceWrapByViewport);
        actionBarEl.style.flexWrap = '';
      }
      shortcutBarEl.classList.remove('shortcut-collapse-secondary');
      shortcutBarEl.classList.remove('shortcut-icon-only');
      if (bp960) {
        shortcutBarEl.classList.add('shortcut-collapse-secondary');
      }
      if (bp640) {
        shortcutBarEl.classList.add('shortcut-icon-only');
      }
      shortcutBarEl.style.flexWrap = 'nowrap';
      let shortcutOverflow = shortcutBarEl.scrollWidth > shortcutBarEl.clientWidth + 1;
      if (shortcutOverflow) {
        shortcutBarEl.classList.add('shortcut-collapse-secondary');
      }
      shortcutOverflow = shortcutBarEl.scrollWidth > shortcutBarEl.clientWidth + 1;
      if (shortcutOverflow) {
        shortcutBarEl.classList.add('shortcut-icon-only');
      }
      shortcutBarEl.style.flexWrap = '';
      closeShortcutMoreMenu();
    }
    function requestAdaptiveLayout() {
      if (adaptiveTicking) {
        return;
      }
      adaptiveTicking = true;
      requestAnimationFrame(() => {
        adaptiveTicking = false;
        updateAdaptiveLayout();
      });
    }

    function updateDataPopover(stats, poolSize) {
      document.getElementById('sessionViews').textContent = stats.sessionViewed || 0;
      document.getElementById('todayReviews').textContent = stats.todayReviewed || 0;
      const favRate = poolSize > 0 ? Math.round((stats.favorites / poolSize) * 100) : 0;
      document.getElementById('favRate').textContent = favRate;
      document.getElementById('poolSize').textContent = poolSize || 0;
      const trendTooltip = document.getElementById('trendTooltip');

      // Render trend chart
      const trendChart = document.getElementById('trendChart');
      const recent = Array.isArray(stats.recentDailyReviews) && stats.recentDailyReviews.length > 0
        ? stats.recentDailyReviews
        : (() => {
            const fallback = [];
            const now = new Date();
            for (let i = 6; i >= 0; i--) {
              const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
              fallback.push({ date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), label: (d.getMonth() + 1) + '/' + d.getDate(), count: i === 0 ? (stats.todayReviewed || 0) : 0 });
            }
            return fallback;
          })();
      const maxCount = Math.max(...recent.map(item => Number(item.count || 0)), 1);
      const trendTotal = recent.reduce((sum, item) => sum + Number(item.count || 0), 0);
      document.getElementById('trendTotal').textContent = trendTotal + '次';
      let svgHTML = '';
      recent.forEach((item, i) => {
        const value = Number(item.count || 0);
        const ratio = maxCount > 0 ? value / maxCount : 0;
        const height = Math.max(2, ratio * 28);
        const x = i * 17 + 2;
        const y = 32 - height;
        const opacity = 0.35 + ratio * 0.55;
        svgHTML += '<rect data-date="' + item.date + '" data-label="' + (item.label || item.date) + '" data-count="' + value + '" x="' + x + '" y="' + y + '" width="12" height="' + height + '" rx="2" fill="var(--status-green)" opacity="' + opacity + '" tabindex="0"></rect>';
      });
      trendChart.innerHTML = svgHTML;
      if (trendTooltip) {
        trendTooltip.textContent = '悬停柱状条查看日期与复习次数';
      }
      const resetTrendTooltip = () => {
        if (trendTooltip) {
          trendTooltip.textContent = '悬停柱状条查看日期与复习次数';
        }
      };
      const updateTrendTooltip = (target) => {
        const date = target.getAttribute('data-date') || target.getAttribute('data-label') || '-';
        const count = target.getAttribute('data-count') || '0';
        if (trendTooltip) {
          trendTooltip.textContent = date + '：复习 ' + count + ' 次';
        }
      };
      trendChart.querySelectorAll('rect').forEach((bar) => {
        bar.addEventListener('mouseenter', () => updateTrendTooltip(bar));
        bar.addEventListener('focus', () => updateTrendTooltip(bar));
        bar.addEventListener('mouseleave', resetTrendTooltip);
        bar.addEventListener('blur', resetTrendTooltip);
      });
      if (!trendChart.dataset.boundLeave) {
        trendChart.addEventListener('mouseleave', resetTrendTooltip);
        trendChart.dataset.boundLeave = '1';
      }
    }

    dataToggleEl.addEventListener('click', toggleDataPopover);

    // Close popover when clicking outside
    document.addEventListener('click', (e) => {
      if (!dataToggleEl.contains(e.target) && !dataPopoverEl.contains(e.target)) {
        dataPopoverEl.classList.remove('open');
        dataToggleEl.classList.remove('active');
      }
      if (shortcutMoreWrapEl && !shortcutMoreWrapEl.contains(e.target)) {
        closeShortcutMoreMenu();
      }
    });

    function getActiveFilterTag() {
      const active = Array.from(filterTagsEl).find(t => t.classList.contains('active'));
      return active ? String(active.dataset.filter || 'all') : 'all';
    }
    function setActiveFilterTag(tagValue) {
      filterTagsEl.forEach(t => t.classList.toggle('active', t.dataset.filter === tagValue));
    }
    function updateClearFiltersVisibility() {
      const activeTag = getActiveFilterTag();
      const days = parseInt(daysFilterEl.value, 10) || 0;
      const isDefaultState = activeTag === 'all' && days > 0 && days === configuredDefaultMinDays;
      clearFiltersEl.classList.toggle('hidden', isDefaultState);
    }
    function rebuildFilterStateFromUI() {
      const activeTag = getActiveFilterTag();
      const days = parseInt(daysFilterEl.value, 10) || 0;
      const nextFilter = { noteTypes: [], favoriteOnly: false };
      if (activeTag === 'favorite') {
        // 收藏视图默认忽略“未复习天数”，避免误伤已有收藏。
        nextFilter.favoriteOnly = true;
      } else if (activeTag !== 'all') {
        nextFilter.noteTypes = [activeTag];
      }
      if (activeTag !== 'favorite' && days > 0) {
        nextFilter.minDaysUnreviewed = days;
      }
      currentFilter = nextFilter;
    }
    function syncFilterUIFromState(filter) {
      const favoriteOnly = !!filter.favoriteOnly;
      const noteTypes = Array.isArray(filter.noteTypes) ? filter.noteTypes : [];
      const hasDaysFilter = Number.isFinite(Number(filter.minDaysUnreviewed)) && Number(filter.minDaysUnreviewed) > 0;
      const days = hasDaysFilter ? Number(filter.minDaysUnreviewed) : configuredDefaultMinDays;
      if (favoriteOnly) {
        setActiveFilterTag('favorite');
      } else if (noteTypes.length > 0) {
        setActiveFilterTag(String(noteTypes[0]));
      } else {
        setActiveFilterTag('all');
      }
      daysFilterEl.value = String(days);
      rebuildFilterStateFromUI();
      updateClearFiltersVisibility();
    }

    filterTagsEl.forEach(tag => {
      tag.addEventListener('click', () => {
        setActiveFilterTag(tag.dataset.filter || 'all');
        rebuildFilterStateFromUI();
        updateClearFiltersVisibility();
        sendFilter();
      });
    });

    clearFiltersEl.addEventListener('click', () => {
      setActiveFilterTag('all');
      daysFilterEl.value = String(configuredDefaultMinDays);
      rebuildFilterStateFromUI();
      updateClearFiltersVisibility();
      sendFilter();
    });

    // Days filter
    daysFilterEl.addEventListener('change', () => {
      const days = parseInt(daysFilterEl.value, 10) || 0;
      configuredDefaultMinDays = Math.max(0, days);
      latestPersistedState = { ...latestPersistedState, defaultMinDays: configuredDefaultMinDays };
      vscode.setState(latestPersistedState);
      rebuildFilterStateFromUI();
      updateClearFiltersVisibility();
      sendFilter();
    });

    function sendFilter() {
      vscode.postMessage({
        command: 'applyFilter',
        filter: currentFilter,
      });
    }
    function isSameNaturalDay(ts) {
      const value = Number(ts || 0);
      if (!value) {
        return false;
      }
      const a = new Date(value);
      const b = new Date();
      return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
    }
    function withReviewIdempotentCheck(handler) {
      if (currentCard && currentCard.meta && isSameNaturalDay(currentCard.meta.lastReviewedAt)) {
        showToast('今日已复习', 'success');
        return;
      }
      handler();
    }
    function unlockFavoriteAnimation() {
      isFavoriteAnimating = false;
      if (favoriteUnlockTimer) {
        clearTimeout(favoriteUnlockTimer);
        favoriteUnlockTimer = null;
      }
      const favBtnIcon = favBtnEl.querySelector('i');
      if (favBtnIcon) {
        favBtnIcon.classList.remove('favorite-animating');
      }
      const cornerFavIcon = document.querySelector('#cornerFav i');
      if (cornerFavIcon) {
        cornerFavIcon.classList.remove('favorite-animating');
      }
    }
    function triggerFavoriteAnimationAndToggle() {
      if (isFavoriteAnimating) {
        return;
      }
      isFavoriteAnimating = true;
      const favBtnIcon = favBtnEl.querySelector('i');
      const cornerFavIcon = document.querySelector('#cornerFav i');
      if (favBtnIcon) {
        favBtnIcon.classList.add('favorite-animating');
      }
      if (cornerFavIcon) {
        cornerFavIcon.classList.add('favorite-animating');
      }
      favoriteUnlockTimer = setTimeout(() => {
        vscode.postMessage({ command: 'toggleFavorite' });
      }, 600);
      setTimeout(() => {
        if (isFavoriteAnimating) {
          unlockFavoriteAnimation();
        }
      }, 1800);
    }

    // Toast
    function showToast(message, type = 'success') {
      if (toastTimeout) {
        clearTimeout(toastTimeout);
      }
      toastEl.className = 'toast ' + type;
      toastEl.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-circle' : 'info-circle') + '"></i> ' + message;
      toastEl.classList.add('show');
      toastTimeout = setTimeout(() => {
        toastEl.classList.remove('show');
      }, 2500);
    }

    // Particle Effects
    function createParticles(x, y, color, count = 8) {
      for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.innerHTML = '<i class="fas fa-star" style="color:' + color + ';font-size:' + (8 + Math.random() * 8) + 'px;"></i>';
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        const angle = (Math.PI * 2 * i) / count;
        const distance = 30 + Math.random() * 40;
        particle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
        particle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
        feedbackContainerEl.appendChild(particle);
        setTimeout(() => particle.remove(), 800);
      }
    }

    function createCheckParticles(x, y) {
      for (let i = 0; i < 6; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.innerHTML = '<i class="fas fa-check" style="color:var(--accent-green);font-size:' + (10 + Math.random() * 6) + 'px;"></i>';
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        const angle = (Math.PI * 2 * i) / 6;
        const distance = 25 + Math.random() * 30;
        particle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
        particle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
        feedbackContainerEl.appendChild(particle);
        setTimeout(() => particle.remove(), 800);
      }
    }

    // Button Click Handlers with Particles
    favBtnEl.addEventListener('click', (e) => {
      const rect = favBtnEl.getBoundingClientRect();
      const containerRect = feedbackContainerEl.getBoundingClientRect();
      createParticles(
        rect.left + rect.width / 2 - containerRect.left,
        rect.top + rect.height / 2 - containerRect.top,
        'var(--accent-gold)'
      );
      triggerFavoriteAnimationAndToggle();
    });

    reviewBtnEl.addEventListener('click', (e) => {
      withReviewIdempotentCheck(() => {
        const rect = reviewBtnEl.getBoundingClientRect();
        const containerRect = feedbackContainerEl.getBoundingClientRect();
        createCheckParticles(
          rect.left + rect.width / 2 - containerRect.left,
          rect.top + rect.height / 2 - containerRect.top
        );
        vscode.postMessage({ command: 'markReviewed' });
      });
    });

    document.getElementById('nextBtn').addEventListener('click', () => vscode.postMessage({ command: 'next' }));
    document.getElementById('prevBtn').addEventListener('click', () => vscode.postMessage({ command: 'prev' }));
    document.getElementById('openBtn').addEventListener('click', () => vscode.postMessage({ command: 'openSource' }));
    document.getElementById('editBtn').addEventListener('click', () => vscode.postMessage({ command: 'openEdit' }));
    if (exportBtnEl) {
      exportBtnEl.addEventListener('click', () => showExportModal());
    }
    document.getElementById('skipBtn').addEventListener('click', () => vscode.postMessage({ command: 'next' }));
    document.getElementById('refreshBtn').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
    shortcutBarEl.addEventListener('click', (evt) => {
      const target = evt.target;
      const actionBtn = target && target.closest ? target.closest('[data-action]') : null;
      if (actionBtn) {
        runShortcutAction(String(actionBtn.getAttribute('data-action') || ''));
      }
    });
    if (shortcutMoreBtnEl) {
      shortcutMoreBtnEl.addEventListener('click', (evt) => {
        evt.stopPropagation();
        toggleShortcutMoreMenu();
      });
    }
    window.addEventListener('resize', requestAdaptiveLayout);

    // Keyboard Shortcuts
    window.addEventListener('keydown', (event) => {
      if (isExportModalOpen()) {
        return;
      }
      if (event.key === 'Escape') {
        closeShortcutMoreMenu();
      }
      if (event.key === 'ArrowRight') vscode.postMessage({ command: 'next' });
      else if (event.key === 'ArrowLeft') vscode.postMessage({ command: 'prev' });
      else if (event.key.toLowerCase() === 'f') {
        const rect = favBtnEl.getBoundingClientRect();
        const containerRect = feedbackContainerEl.getBoundingClientRect();
        createParticles(
          rect.left + rect.width / 2 - containerRect.left,
          rect.top + rect.height / 2 - containerRect.top,
          'var(--accent-gold)'
        );
        triggerFavoriteAnimationAndToggle();
      }
      else if (event.key.toLowerCase() === ' ') {
        event.preventDefault();
        withReviewIdempotentCheck(() => {
          const rect = reviewBtnEl.getBoundingClientRect();
          const containerRect = feedbackContainerEl.getBoundingClientRect();
          createCheckParticles(
            rect.left + rect.width / 2 - containerRect.left,
            rect.top + rect.height / 2 - containerRect.top
          );
          vscode.postMessage({ command: 'markReviewed' });
        });
      }
      else if (event.key.toLowerCase() === 'o') vscode.postMessage({ command: 'openSource' });
      else if (event.key.toLowerCase() === 'e') vscode.postMessage({ command: 'openEdit' });
      else if (event.key.toLowerCase() === 'i') showExportModal();
      else if (event.key.toLowerCase() === 'j') vscode.postMessage({ command: 'next' });
      else if (event.key.toLowerCase() === 'r') vscode.postMessage({ command: 'refresh' });
      else if (event.key.toLowerCase() === 'd') toggleDataPopover();
    });

    function esc(text) {
      return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function formatTime(secOrMs) {
      const value = Number(secOrMs || 0);
      if (!value) return '-';
      const ms = value > 1000000000000 ? value : value * 1000;
      const d = new Date(ms);
      return d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate();
    }
    function formatExportDateParts(secOrMs) {
      const value = Number(secOrMs || 0);
      const ms = value > 1000000000000 ? value : value * 1000;
      const date = ms > 0 ? new Date(ms) : new Date();
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      const month = months[date.getMonth()] || 'JAN';
      return {
        day: String(date.getDate()).padStart(2, '0'),
        monthYear: month + ' ' + date.getFullYear(),
        week: weeks[date.getDay()] || '',
        isoDate: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'),
      };
    }
    function normalizeDisplayAuthorValue(value) {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text === '未分类' || text === '未分类章节') {
        return '';
      }
      return text;
    }
    function resolveDisplayAuthor(cardLike) {
      if (!cardLike) {
        return '';
      }
      return normalizeDisplayAuthorValue(cardLike.author);
    }
    function splitTextToLines(ctx, text, maxWidth, maxLines) {
      const source = String(text || '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
      const paragraphs = source.split('\\n');
      const lines = [];
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        if (!paragraph) {
          lines.push('');
          if (lines.length >= maxLines) {
            return lines;
          }
          continue;
        }
        let current = '';
        for (const ch of paragraph) {
          const next = current + ch;
          if (ctx.measureText(next).width > maxWidth && current) {
            lines.push(current);
            current = ch;
            if (lines.length >= maxLines) {
              return lines;
            }
            continue;
          }
          current = next;
        }
        if (current) {
          lines.push(current);
        }
        if (lines.length >= maxLines) {
          return lines;
        }
      }
      return lines;
    }
    function drawLines(ctx, lines, x, startY, lineHeight, maxLines) {
      const visible = lines.slice(0, maxLines);
      const isLastParagraphs = lines.map((_, i) => i === lines.length - 1 || lines[i+1] === ''); // basic heuristic
      
      for (let i = 0; i < visible.length; i++) {
        let line = visible[i];
        if (i === maxLines - 1 && lines.length > maxLines && line.length > 1) {
          line = line.slice(0, Math.max(1, line.length - 1)) + '…';
          ctx.fillText(line, x, startY + i * lineHeight);
        } else if (i < visible.length - 1 && line.length > 0 && lines[i+1].length > 0) {
          // Justify align
          const words = line.split('');
          if (words.length > 1) {
            const totalWidth = ctx.measureText(line).width;
            const extraSpace = 360 - totalWidth; // 360 is textWidth
            const spacePerWord = extraSpace / (words.length - 1);
            let currentX = x;
            for (let j = 0; j < words.length; j++) {
              ctx.fillText(words[j], currentX, startY + i * lineHeight);
              currentX += ctx.measureText(words[j]).width + spacePerWord;
            }
          } else {
            ctx.fillText(line, x, startY + i * lineHeight);
          }
        } else {
          ctx.fillText(line, x, startY + i * lineHeight);
        }
      }
      return visible.length;
    }
    function generateExportDataUrl() {
      if (!currentCard) return '';
      try {
        const timeTypeElement = document.querySelector('input[name="exportTimeType"]:checked');
        const timeType = timeTypeElement ? timeTypeElement.value : 'create';
        const targetTime = timeType === 'share' ? Date.now() : currentCard.createTime;
        const dateParts = formatExportDateParts(targetTime);
        
        const width = 480;
        const lineHeight = 42;
        const dummyCanvas = document.createElement('canvas');
        const dummyCtx = dummyCanvas.getContext('2d');
        if (!dummyCtx) {
          emitExportLog('render.measureContext.missing', '', 'ERROR');
          return '';
        }
        dummyCtx.font = '400 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        const targetTextWidth = 378;
        const targetTextX = 51;
        const textLines = splitTextToLines(dummyCtx, currentCard.text || currentCard.content || '', targetTextWidth, 12);
        const textY = 320;
        const usedLines = textLines.length;
        const titleY = textY + Math.max(usedLines, 1) * lineHeight + 24;
        const authorY = titleY + 30;
        const footerY = authorY + 42;
        const height = footerY + 50;
        const scale = 3;
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          emitExportLog('render.canvasContext.missing', { width: canvas.width, height: canvas.height }, 'ERROR');
          return '';
        }
        ctx.scale(scale, scale);
        const COLORS = currentExportTheme || EXPORT_THEMES[0];
        emitExportLog('render.start', {
          noteKey: currentCard.noteKey || '',
          timeType: timeType,
          themeId: COLORS && COLORS.id ? COLORS.id : '',
        });
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, width, height);
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.primary;
        ctx.font = '800 120px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(dateParts.day, width / 2, 150);
        ctx.font = '700 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(dateParts.monthYear, width / 2, 200);
        ctx.font = '400 14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = COLORS.weekday;
        ctx.fillText(dateParts.week, width / 2, 230);
        ctx.strokeStyle = COLORS.divider;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width / 2 - 30, 270);
        ctx.lineTo(width / 2 + 30, 270);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = COLORS.primary;
        ctx.font = '400 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        const visible = textLines.slice(0, 12);
        for (let i = 0; i < visible.length; i++) {
          let line = visible[i];
          if (i === 11 && textLines.length > 12 && line.length > 1) {
            line = line.slice(0, Math.max(1, line.length - 1)) + '…';
            ctx.fillText(line, targetTextX, textY + i * lineHeight);
          } else if (i < visible.length - 1 && line.length > 0 && textLines[i + 1].length > 0) {
            const words = line.split('');
            if (words.length > 1) {
              const totalWidth = ctx.measureText(line).width;
              const extraSpace = targetTextWidth - totalWidth;
              const spacePerWord = extraSpace / (words.length - 1);
              let currentX = targetTextX;
              for (let j = 0; j < words.length; j++) {
                ctx.fillText(words[j], currentX, textY + i * lineHeight);
                currentX += ctx.measureText(words[j]).width + spacePerWord;
              }
            } else {
              ctx.fillText(line, targetTextX, textY + i * lineHeight);
            }
          } else {
            ctx.fillText(line, targetTextX, textY + i * lineHeight);
          }
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.weekday;
        ctx.font = '400 16px -apple-system, "PingFang SC", "Microsoft YaHei", serif';
        const bookTitle = currentCard.bookTitle ? '《' + currentCard.bookTitle + '》' : '《未命名书籍》';
        ctx.fillText(bookTitle, width / 2, titleY);
        ctx.font = '400 14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        const authorLike = resolveDisplayAuthor(currentCard);
        if (authorLike) {
          ctx.fillText(String(authorLike), width / 2, authorY);
        }
        ctx.fillStyle = COLORS.watermark;
        ctx.font = '400 14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText('微信读书', width / 2, footerY);
        const dataUrl = canvas.toDataURL('image/png');
        emitExportLog('render.success', {
          width: canvas.width,
          height: canvas.height,
          bodyLines: textLines.length,
          dataUrlLength: dataUrl.length,
        });
        return dataUrl;
      } catch (error) {
        const message = error instanceof Error ? (error.stack || error.message) : String(error);
        emitExportLog('render.exception', message, 'ERROR');
        return '';
      }
    }

    function doExportImage() {
      if (!currentCard) {
        showToast('暂无可导出的卡片', 'warning');
        return;
      }
      
      const timeTypeElement = document.querySelector('input[name="exportTimeType"]:checked');
      const timeType = timeTypeElement ? timeTypeElement.value : 'create';
      const targetTime = timeType === 'share' ? Date.now() : currentCard.createTime;
      const dateParts = formatExportDateParts(targetTime);
      emitExportLog('export.start', {
        noteKey: currentCard.noteKey || '',
        timeType: timeType,
        themeId: currentExportTheme && currentExportTheme.id ? currentExportTheme.id : '',
      });
      const dataUrl = generateExportDataUrl();
      if (!dataUrl) {
        emitExportLog('export.abort', 'generateExportDataUrl returned empty result', 'ERROR');
        return;
      }

      const safeBookTitle = String(currentCard.bookTitle || '笔记').trim()
        .replaceAll(String.fromCharCode(92), '_')
        .replace(/[/:*?"<>|]/g, '_')
        .slice(0, 40) || '笔记';
      const fileName = '笔记卡片_' + safeBookTitle + '_' + dateParts.isoDate + '.png';
      vscode.postMessage({
        command: 'exportCardImage',
        imageDataUrl: dataUrl,
        fileName: fileName,
      });
      emitExportLog('export.postMessage', {
        fileName: fileName,
        dataUrlLength: dataUrl.length,
      });
      showToast('正在导出图片...', 'info');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.command === 'setLoading') {
        contentEl.className = 'empty-state';
        contentEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i><p>正在加载漫游卡片...</p>';
        return;
      }
      if (msg.command === 'renderEmpty') {
        contentEl.className = 'empty-state';
        const reason = esc(msg.reason || '当前暂无可用卡片');
        contentEl.innerHTML = '<i class="fas fa-box-open"></i><p title="' + reason + '">' + reason + '</p>';
        requestAdaptiveLayout();
        return;
      }
      if (msg.command === 'renderCard') {
        const card = msg.card;
        contentEl.className = 'card-host';
        currentCard = card;
        unlockFavoriteAnimation();
        const displayAuthor = resolveDisplayAuthor(card);
        const favorite = card.meta && card.meta.favorite;
        const reviewCount = card.meta && card.meta.reviewCount ? card.meta.reviewCount : 0;
        const noteType = card.noteType || 'highlight';
        const typeLabel = noteType === 'thought' ? '想法' : noteType === 'highlight' ? '划线' : noteType === 'chapter' ? '章节笔记' : noteType === 'review' ? '书评' : '笔记';
        const typeIcon = noteType === 'thought'
            ? 'fas fa-lightbulb'
            : noteType === 'highlight'
                ? 'fas fa-highlighter'
                : noteType === 'chapter'
                    ? 'fas fa-bookmark'
                    : noteType === 'review'
                        ? 'fas fa-book-open'
                        : 'fas fa-note-sticky';

        const html = '<div class="note-card card-enter" id="noteCard">' +
          '<div class="quote-line ' + (noteType === 'highlight' ? 'visible' : '') + '"></div>' +
          '<div class="corner-fav ' + (favorite ? 'active' : '') + '" id="cornerFav" title="' + (favorite ? '已收藏' : '收藏') + '">' +
            '<i class="' + (favorite ? 'fas' : 'far') + ' fa-star"></i>' +
          '</div>' +
          '<div class="card-header">' +
            '<div class="card-book">' +
              '<span class="card-book-icon">${bookIconSvg}</span>' +
              '<span class="card-book-title">' + esc(card.bookTitle || '未命名书籍') + '</span>' +
              (displayAuthor ? '<span class="card-chapter">' + esc(displayAuthor) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card-meta">' +
            '<span class="card-meta-item card-note-type"><i class="' + typeIcon + '"></i> ' + typeLabel + '</span>' +
            '<span class="card-meta-item"><i class="far fa-calendar-alt"></i> ' + formatTime(card.createTime) + '</span>' +
            '<span class="card-meta-item"><i class="fas fa-redo-alt"></i> 复习 ' + reviewCount + ' 次</span>' +
          '</div>' +
          '<div class="card-body">' +
            '<div class="card-content">' +
              '<span class="quote-mark">"</span>' + esc(card.text || card.content || '') +
            '</div>' +
          '</div>' +
          '<div class="card-footer">' +
            (reviewCount > 0 ? '<span class="card-tag reviewed"><i class="fas fa-check-circle"></i> 已复习</span>' : '') +
            (favorite ? '<span class="card-tag fav"><i class="fas fa-star"></i> 收藏</span>' : '') +
            '<span class="card-tag"># ' + esc(card.bookId || '') + '</span>' +
          '</div>' +
        '</div>';

        contentEl.innerHTML = html;

        // Keep progress and data popover strictly consistent.
        const effectivePoolSize = msg.statsPoolSize || msg.poolSize || msg.total || 0;
        const currentIndex = Math.min(msg.index || 0, effectivePoolSize);
        updateProgressRing(currentIndex, effectivePoolSize);

        // Update data popover
        updateDataPopover(msg.stats || {}, effectivePoolSize);
        syncFilterUIFromState(msg.filter || {});

        // Update meta
        const accountName = msg.accountName || '-';
        metaEl.textContent = accountName;
        if (accountInfoEl) {
          accountInfoEl.title = accountName;
        }
        if (accountAvatarEl) {
          accountAvatarEl.title = accountName;
          accountAvatarEl.setAttribute('aria-label', accountName);
        }

        // Update index tip
        indexTipEl.textContent = msg.index || 0;

        // Update buttons
        if (favorite) {
          favBtnEl.innerHTML = '<i class="fas fa-star"></i><span class="label">已收藏</span> <span class="kbd">F</span>';
          favBtnEl.classList.add('active');
        } else {
          favBtnEl.innerHTML = '<i class="far fa-star"></i><span class="label">收藏</span> <span class="kbd">F</span>';
          favBtnEl.classList.remove('active');
        }

        if (reviewCount > 0) {
          reviewBtnEl.innerHTML = '<i class="fas fa-check-circle"></i><span class="label">已复习</span> <span class="kbd">Space</span>';
          reviewBtnEl.classList.add('active');
        } else {
          reviewBtnEl.innerHTML = '<i class="fas fa-check-circle"></i><span class="label">复习</span> <span class="kbd">Space</span>';
          reviewBtnEl.classList.remove('active');
        }

        // Corner favorite click
        document.getElementById('cornerFav').addEventListener('click', () => {
          const rect = favBtnEl.getBoundingClientRect();
          const containerRect = feedbackContainerEl.getBoundingClientRect();
          createParticles(
            rect.left + rect.width / 2 - containerRect.left,
            rect.top + rect.height / 2 - containerRect.top,
            'var(--accent-gold)'
          );
          triggerFavoriteAnimationAndToggle();
        });

        // Show toast
        if (msg.tip) {
          showToast(msg.tip, 'success');
        }
        requestAdaptiveLayout();
      }
    });

    daysFilterEl.value = String(configuredDefaultMinDays);
    rebuildFilterStateFromUI();
    updateClearFiltersVisibility();
    requestAdaptiveLayout();
  </script>
</body>
</html>`;
    }
}
exports.NoteRoamingView = NoteRoamingView;
function buildNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
let noteRoamingViewInstance;
function initializeNoteRoamingView(extensionUri) {
    noteRoamingViewInstance = new NoteRoamingView(extensionUri);
    return noteRoamingViewInstance;
}
exports.initializeNoteRoamingView = initializeNoteRoamingView;
function getNoteRoamingView() {
    if (!noteRoamingViewInstance) {
        throw new Error('NoteRoamingView not initialized');
    }
    return noteRoamingViewInstance;
}
exports.getNoteRoamingView = getNoteRoamingView;
//# sourceMappingURL=noteRoamingView.js.map
