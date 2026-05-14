"use strict";
/**
 * 同步服务
 * 负责与微信读书服务器同步数据
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
exports.getSyncService = exports.initializeSyncService = exports.SyncService = void 0;
const vscode = __importStar(require("vscode"));
const models_1 = require("../models");
const api_1 = require("../api");
const providers_1 = require("../providers");
const diffService_1 = require("./diffService");
const exportService_1 = require("./exportService");
const bookFileCleanupService_1 = require("./bookFileCleanupService");
const localDataService_1 = require("./localDataService");
const indexService_1 = require("./indexService");
const auth_1 = require("../auth");
const deprecation_1 = require("../utils/deprecation");
class SyncService {
    constructor(storageService) {
        this.syncingAccounts = new Set();
        this.maxConcurrency = 3;
        this.notesCacheTtlMs = 60 * 1000;
        this.notesCache = new Map();
        this.syncedBookCount = new Map();
        this.estimatedTotalNotes = new Map();
        this.syncedNotesCount = new Map();
        this._onDidStartSync = new vscode.EventEmitter();
        this._onDidCompleteSync = new vscode.EventEmitter();
        this._onDidUpdateProgress = new vscode.EventEmitter();
        this.onDidStartSync = this._onDidStartSync.event;
        this.onDidCompleteSync = this._onDidCompleteSync.event;
        this.onDidUpdateProgress = this._onDidUpdateProgress.event;
        this.storageService = storageService;
    }
    /**
     * 执行全量同步
     */
    async fullSync(accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('syncService.fullSync()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const targetAccountId = this.resolveAccountId(accountId);
        if (!targetAccountId) {
            return {
                success: false,
                syncedBooks: 0,
                syncedNotes: 0,
                error: '未设置活跃账号',
                syncTime: Date.now(),
            };
        }
        if (this.syncingAccounts.has(targetAccountId)) {
            return {
                success: false,
                syncedBooks: 0,
                syncedNotes: 0,
                error: '同步正在进行中',
                syncTime: Date.now(),
            };
        }
        this.syncingAccounts.add(targetAccountId);
        this.syncedBookCount.set(targetAccountId, 0);
        this.syncedNotesCount.set(targetAccountId, 0);
        this.estimatedTotalNotes.set(targetAccountId, 0);
        this._onDidStartSync.fire();
        try {
            await this.storageService.updateSyncStatus(models_1.SyncStatus.Syncing, undefined, targetAccountId);
            const remoteBooks = await this.loadRemoteBooks();
            const localBooks = await (0, indexService_1.getIndexService)().queryBooks(targetAccountId);
            const result = await this.syncChangedBooks(remoteBooks, localBooks, targetAccountId);
            this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });
            (0, providers_1.getBookshelfProvider)().refresh();
            return result;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : '同步失败';
            await this.storageService.updateSyncStatus(models_1.SyncStatus.Failed, errorMessage, targetAccountId);
            const result = {
                success: false,
                syncedBooks: 0,
                syncedNotes: 0,
                error: errorMessage,
                syncTime: Date.now(),
            };
            this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });
            return result;
        }
        finally {
            this.syncingAccounts.delete(targetAccountId);
        }
    }
    /**
     * 执行增量同步
     * 只同步有变化的书籍
     */
    async incrementalSync(accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('syncService.incrementalSync()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const targetAccountId = this.resolveAccountId(accountId);
        if (!targetAccountId) {
            return {
                success: false,
                syncedBooks: 0,
                syncedNotes: 0,
                error: '未设置活跃账号',
                syncTime: Date.now(),
            };
        }
        if (this.syncingAccounts.has(targetAccountId)) {
            return {
                success: false,
                syncedBooks: 0,
                syncedNotes: 0,
                error: '同步正在进行中',
                syncTime: Date.now(),
            };
        }
        this.syncingAccounts.add(targetAccountId);
        this.syncedBookCount.set(targetAccountId, 0);
        this.syncedNotesCount.set(targetAccountId, 0);
        this.estimatedTotalNotes.set(targetAccountId, 0);
        this._onDidStartSync.fire();
        try {
            await this.storageService.updateSyncStatus(models_1.SyncStatus.Syncing, undefined, targetAccountId);
            const remoteBooks = await this.loadRemoteBooks();
            const localBooks = await (0, indexService_1.getIndexService)().queryBooks(targetAccountId);
            const result = await this.syncChangedBooks(remoteBooks, localBooks, targetAccountId);
            this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });
            (0, providers_1.getBookshelfProvider)().refresh();
            return result;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : '同步失败';
            await this.storageService.updateSyncStatus(models_1.SyncStatus.Failed, errorMessage, targetAccountId);
            const result = {
                success: false,
                syncedBooks: 0,
                syncedNotes: 0,
                error: errorMessage,
                syncTime: Date.now(),
            };
            this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });
            return result;
        }
        finally {
            this.syncingAccounts.delete(targetAccountId);
        }
    }
    /**
     * 仅刷新书架（不拉取笔记）
     */
    async refreshShelfOnly(accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('syncService.refreshShelfOnly()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const targetAccountId = this.resolveAccountId(accountId);
        if (!targetAccountId) {
            return { success: false, syncedBooks: 0, totalBooks: 0, error: '未设置活跃账号' };
        }
        if (this.syncingAccounts.has(targetAccountId)) {
            return { success: false, syncedBooks: 0, totalBooks: 0, error: '同步正在进行中' };
        }
        this.syncingAccounts.add(targetAccountId);
        this.syncedBookCount.set(targetAccountId, 0);
        this.syncedNotesCount.set(targetAccountId, 0);
        this.estimatedTotalNotes.set(targetAccountId, 0);
        try {
            const shelfData = await (0, api_1.getShelfList)();
            const books = shelfData.books.map((b) => b.book);
            const articleBooks = await this.tryLoadArticleBooks();
            books.push(...articleBooks);
            const totalBooks = books.length;
            for (let i = 0; i < books.length; i++) {
                this.syncedBookCount.set(targetAccountId, i + 1);
                this.updateProgress(models_1.SyncStep.FetchingShelf, i + 1, totalBooks, books[i].title, targetAccountId);
            }
            (0, providers_1.getBookshelfProvider)().refresh();
            return {
                success: true,
                syncedBooks: totalBooks,
                totalBooks,
            };
        }
        catch (error) {
            return {
                success: false,
                syncedBooks: 0,
                totalBooks: 0,
                error: error instanceof Error ? error.message : '刷新书架失败',
            };
        }
        finally {
            this.syncingAccounts.delete(targetAccountId);
        }
    }
    /**
     * 同步单本书籍
     */
    async syncBook(bookId, accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('syncService.syncBook()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const targetAccountId = this.resolveAccountId(accountId);
        const notesData = await this.getBookNotesWithCache(bookId, targetAccountId);
        const notes = (0, api_1.transformNotes)(notesData, bookId);
        const localBook = await (0, indexService_1.getIndexService)().getBookById(bookId, targetAccountId);
        if (localBook) {
            localBook.highlightCount = notes.filter((n) => n.highlightText).length;
            localBook.noteCount = notes.length;
            localBook.reviewCount = notes.filter((n) => n.type === 4 || n.thoughtText).length;
            await (0, exportService_1.getExportService)().exportBookForSyncWithNotes(localBook, notes);
            await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath(targetAccountId).catch(() => undefined);
            await this.rebuildDailyAggFromIndex(targetAccountId).catch(() => undefined);
            (0, providers_1.getBookshelfProvider)().refresh();
        }
        return notes;
    }
    async syncBooksConcurrently(books, accountId) {
        let finished = 0;
        const results = [];
        const queue = [...books];
        const workers = [];
        const exportService = (0, exportService_1.getExportService)();
        const diffService = (0, diffService_1.getDiffService)();
        const worker = async () => {
            while (queue.length > 0) {
                const book = queue.shift();
                if (!book) {
                    break;
                }
                this.updateProgress(models_1.SyncStep.FetchingNotes, finished, books.length, book.title, accountId);
                try {
                    const notesData = await this.getBookNotesWithCache(book.bookId, accountId);
                    const remoteNotes = (0, api_1.transformNotes)(notesData, book.bookId);
                    const localNotes = await (0, indexService_1.getIndexService)().getNotesByBookId(book.bookId, accountId);
                    const noteChanges = diffService.detectNoteChanges(localNotes, remoteNotes);
                    const changedNotesCount = noteChanges.added.length + noteChanges.modified.length + noteChanges.deleted.length;
                    const shouldUpdate = this.shouldUpdateBookNotes(localNotes, remoteNotes, changedNotesCount);
                    const shouldRefreshMetadata = this.shouldRefreshMetadata(book);
                    if (shouldUpdate || shouldRefreshMetadata) {
                        const notes = shouldUpdate
                            ? this.mergeWithLocalNotes(localNotes, remoteNotes)
                            : localNotes;
                        const metadataChanged = await this.enrichBookMetadataIfNeeded(book);
                        book.highlightCount = notes.filter((n) => n.highlightText).length;
                        book.noteCount = notes.length;
                        book.reviewCount = notes.filter((n) => n.type === 4 || n.thoughtText).length;
                        const exportResult = await exportService.exportBookForSyncWithNotes(book, notes);
                        if (!exportResult.success) {
                            console.warn(`[Sync][account:${accountId}] Failed to write notes file for ${book.title}: ${exportResult.error}`);
                        }
                        results.push({
                            bookId: book.bookId,
                            notesCount: shouldUpdate ? (changedNotesCount || notes.length) : 0,
                            updated: shouldUpdate || metadataChanged,
                        });
                        if (shouldUpdate) {
                            this.syncedNotesCount.set(accountId, (this.syncedNotesCount.get(accountId) || 0) + (changedNotesCount || notes.length));
                        }
                    }
                    else {
                        results.push({ bookId: book.bookId, notesCount: 0, updated: false });
                    }
                }
                catch (error) {
                    console.error(`[Sync][account:${accountId}] Failed to sync book ${book.title}:`, error);
                }
                finally {
                    finished += 1;
                    this.syncedBookCount.set(accountId, finished);
                    this.updateProgress(models_1.SyncStep.FetchingNotes, finished, books.length, book.title, accountId);
                }
            }
        };
        const size = Math.min(this.maxConcurrency, Math.max(1, books.length));
        for (let i = 0; i < size; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return results;
    }
    async getBookNotesWithCache(bookId, accountId) {
        const key = `${String(accountId || 'default')}:${bookId}`;
        const cached = this.notesCache.get(key);
        const now = Date.now();
        if (cached && now - cached.fetchedAt < this.notesCacheTtlMs) {
            return cached.data;
        }
        const sourceBookId = this.toSourceBookId(bookId);
        const data = await (0, api_1.getBookNotes)(sourceBookId);
        this.notesCache.set(key, { fetchedAt: now, data });
        return data;
    }
    async tryLoadArticleBooks() {
        try {
            return await (0, api_1.getArticleBooks)();
        }
        catch {
            // 兼容旧账号/接口不可用场景
            return [];
        }
    }
    toSourceBookId(bookId) {
        return bookId.startsWith('article:') ? bookId.replace('article:', '') : bookId;
    }
    async loadRemoteBooks() {
        this.updateProgress(models_1.SyncStep.FetchingShelf, 0, 0, '获取书架列表');
        const shelfData = await (0, api_1.getShelfList)();
        const remoteBooks = shelfData.books.map((b) => b.book);
        remoteBooks.push(...(await this.tryLoadArticleBooks()));
        return remoteBooks;
    }
    async syncChangedBooks(remoteBooks, localBooks, accountId) {
        const diffService = (0, diffService_1.getDiffService)();
        const diffs = diffService.detectBookChanges(localBooks, remoteBooks);
        const syncPlan = diffService.generateSyncPlan(diffs, remoteBooks);
        const localBooksMap = new Map(localBooks.map((book) => [book.bookId, book]));
        const metadataBooksToSync = remoteBooks.filter((remoteBook) => {
            const localBook = localBooksMap.get(remoteBook.bookId);
            return this.shouldRefreshMetadata(remoteBook) || (localBook ? this.shouldRefreshMetadata(localBook) : false);
        });
        const booksToSync = localBooks.length === 0
            ? remoteBooks
            : Array.from(new Map([...syncPlan.booksToSync, ...metadataBooksToSync].map((book) => [book.bookId, book])).values());
        this.estimatedTotalNotes.set(accountId, booksToSync.reduce((sum, b) => sum + (b.highlightCount || 0) + (b.noteCount || 0), 0));
        let updatedBooks = 0;
        let updatedNotes = 0;
        if (booksToSync.length > 0) {
            const synced = await this.syncBooksConcurrently(booksToSync, accountId);
            for (const item of synced) {
                if (item.updated) {
                    updatedBooks += 1;
                    updatedNotes += item.notesCount;
                }
            }
        }
        this.updateProgress(models_1.SyncStep.SavingData, remoteBooks.length, remoteBooks.length, '保存数据', accountId);
        await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath(accountId).catch(() => undefined);
        await this.rebuildDailyAggFromIndex(accountId).catch(() => undefined);
        try {
            const cleanupResult = await (0, bookFileCleanupService_1.getBookFileCleanupService)().cleanupDuplicateBookFilesForAccount(accountId);
            if (cleanupResult.movedFiles > 0) {
                console.info(`[Sync][account:${accountId}] duplicate book files cleaned moved=${cleanupResult.movedFiles} groups=${cleanupResult.duplicateGroups}`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error || '');
            console.warn(`[Sync][account:${accountId}] duplicate file cleanup failed: ${message}`);
        }
        await this.storageService.updateSyncStatus(models_1.SyncStatus.Success, undefined, accountId);
        return {
            success: true,
            syncedBooks: updatedBooks,
            syncedNotes: updatedNotes,
            syncTime: Date.now(),
            accountId,
        };
    }
    shouldUpdateBookNotes(localNotes, remoteNotes, changedNotesCount) {
        if (localNotes.length === 0) {
            return remoteNotes.length > 0;
        }
        if (changedNotesCount === 0) {
            return false;
        }
        const localLatest = this.getLatestNoteTime(localNotes);
        const remoteLatest = this.getLatestNoteTime(remoteNotes);
        if (remoteNotes.length !== localNotes.length) {
            return true;
        }
        return remoteLatest >= localLatest;
    }
    getLatestNoteTime(notes) {
        return notes.reduce((latest, note) => {
            const noteTime = note.modifyTime || note.createTime || 0;
            return Math.max(latest, noteTime);
        }, 0);
    }
    shouldRefreshMetadata(book) {
        if (book.bookId.startsWith('article:')) {
            return (!book.pcUrl ||
                /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl) ||
                !/\/web\/mp\/reader\//i.test(book.pcUrl));
        }
        return !book.pcUrl || /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl);
    }
    async enrichBookMetadataIfNeeded(book) {
        if (book.bookId.startsWith('article:')) {
            const normalized = (0, api_1.buildPcUrl)(book.bookId);
            if (book.pcUrl !== normalized) {
                book.pcUrl = normalized;
                return true;
            }
            return false;
        }
        const pcUrlLooksRawId = !book.pcUrl || /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl);
        const needResolveCanonicalReaderUrl = pcUrlLooksRawId && (book.bookId.startsWith('MP_WXS_') || /^\d+$/.test(book.bookId));
        const needFetch = !book.isbn ||
            !book.publisher ||
            !book.category ||
            !book.intro;
        if (!needFetch && !needResolveCanonicalReaderUrl) {
            return false;
        }
        const previousSnapshot = JSON.stringify({
            isbn: book.isbn,
            publisher: book.publisher,
            category: book.category,
            intro: book.intro,
            publishTime: book.publishTime,
            author: book.author,
            title: book.title,
            cover: book.cover,
            pcUrl: book.pcUrl,
        });
        try {
            const detail = await (0, api_1.getBookInfo)(this.toSourceBookId(book.bookId));
            book.isbn = detail.isbn || book.isbn;
            book.publisher = detail.publisher || book.publisher;
            book.category = detail.category || book.category;
            book.intro = detail.intro || book.intro;
            book.publishTime = detail.publishTime || book.publishTime;
            book.author = detail.author || book.author;
            book.title = detail.title || book.title;
            book.cover = detail.cover || book.cover;
            if (detail.pcUrl) {
                book.pcUrl = detail.pcUrl;
            }
            else if (needResolveCanonicalReaderUrl &&
                typeof detail.bookId === 'string' &&
                detail.bookId.trim() &&
                detail.bookId.trim() !== book.bookId) {
                if (book.bookId.startsWith('MP_WXS_')) {
                    book.pcUrl = `https://weread.qq.com/web/mp/reader/${detail.bookId.trim()}`;
                }
                else {
                    book.pcUrl = `https://weread.qq.com/web/reader/${detail.bookId.trim()}`;
                }
            }
            const nextSnapshot = JSON.stringify({
                isbn: book.isbn,
                publisher: book.publisher,
                category: book.category,
                intro: book.intro,
                publishTime: book.publishTime,
                author: book.author,
                title: book.title,
                cover: book.cover,
                pcUrl: book.pcUrl,
            });
            return nextSnapshot !== previousSnapshot;
        }
        catch (error) {
            console.warn(`[Sync] Failed to enrich metadata for ${book.title}:`, error);
            return false;
        }
    }
    /**
     * 冲突处理策略：若本地笔记 modifyTime 更新，则保留本地版本，避免用户本地编辑被覆盖。
     */
    mergeWithLocalNotes(localNotes, remoteNotes) {
        if (remoteNotes.length === 0 && localNotes.length > 0) {
            return localNotes;
        }
        if (localNotes.length === 0) {
            return remoteNotes;
        }
        const localMap = new Map(localNotes.map((n) => [n.noteId, n]));
        return remoteNotes.map((remote) => {
            const local = localMap.get(remote.noteId);
            if (!local) {
                return remote;
            }
            const localTime = local.modifyTime || local.createTime || 0;
            const remoteTime = remote.modifyTime || remote.createTime || 0;
            return localTime > remoteTime ? local : remote;
        });
    }
    async rebuildDailyAggFromIndex(accountId) {
        const books = await (0, indexService_1.getIndexService)().queryBooks(accountId);
        const dailyMap = new Map();
        for (const book of books) {
            const notes = await (0, indexService_1.getIndexService)().getNotesByBookId(book.bookId, accountId);
            for (const note of notes) {
                const timestamp = this.normalizeTimestampMs(note.modifyTime || note.createTime || 0);
                if (!timestamp) {
                    continue;
                }
                const date = this.formatDate(timestamp);
                const current = dailyMap.get(date);
                if (current) {
                    current.notesCount += 1;
                    current.booksTouched.add(note.bookId);
                    continue;
                }
                dailyMap.set(date, {
                    notesCount: 1,
                    booksTouched: new Set([note.bookId]),
                });
            }
        }
        const records = Array.from(dailyMap.entries())
            .map(([date, value]) => ({
            date,
            readDaysFlag: (value.notesCount > 0 ? 1 : 0),
            notesCount: value.notesCount,
            booksTouched: value.booksTouched.size,
        }))
            .sort((a, b) => a.date.localeCompare(b.date));
        await this.storageService.saveDailyAgg(records, accountId);
    }
    normalizeTimestampMs(raw) {
        if (!raw || !Number.isFinite(raw)) {
            return 0;
        }
        return raw > 1000000000000 ? raw : raw * 1000;
    }
    formatDate(timestamp) {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    /**
     * 获取同步状态
     */
    getSyncState(accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('syncService.getSyncState()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        return this.storageService.getSyncState(accountId);
    }
    /**
     * 是否正在同步
     */
    isSyncingInProgress(accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('syncService.isSyncingInProgress()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const targetAccountId = this.resolveAccountId(accountId);
        if (targetAccountId) {
            return this.syncingAccounts.has(targetAccountId);
        }
        return this.syncingAccounts.size > 0;
    }
    /**
     * 更新进度
     */
    updateProgress(step, currentIndex, total, bookName, accountId) {
        const targetAccountId = this.resolveAccountId(accountId);
        const percentage = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
        const totalNotes = Math.max(this.estimatedTotalNotes.get(targetAccountId || '') || 0, this.syncedNotesCount.get(targetAccountId || '') || 0);
        const progress = {
            currentStep: step,
            currentBookIndex: currentIndex,
            totalBooks: total,
            syncedBooks: this.syncedBookCount.get(targetAccountId || '') || currentIndex,
            syncedNotes: this.syncedNotesCount.get(targetAccountId || '') || 0,
            totalNotes,
            currentBookName: bookName,
            percentage,
            accountId: targetAccountId,
        };
        this._onDidUpdateProgress.fire(progress);
    }
    resolveAccountId(accountId) {
        const normalized = String(accountId || '').trim();
        if (normalized) {
            return normalized;
        }
        const active = (0, auth_1.getCookieManager)().getActiveAccountId();
        return String(active || '').trim() || undefined;
    }
}
exports.SyncService = SyncService;
let syncServiceInstance;
function initializeSyncService(storageService) {
    syncServiceInstance = new SyncService(storageService);
    return syncServiceInstance;
}
exports.initializeSyncService = initializeSyncService;
function getSyncService() {
    if (!syncServiceInstance) {
        throw new Error('SyncService not initialized');
    }
    return syncServiceInstance;
}
exports.getSyncService = getSyncService;
//# sourceMappingURL=syncService.js.map