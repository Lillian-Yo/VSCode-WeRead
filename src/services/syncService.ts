/**
 * 同步服务
 * 负责与微信读书服务器同步数据
 */

import * as vscode from 'vscode';
import { Book, Note, SyncState, SyncStatus, SyncStep, SyncResult, SyncProgress, DailyAggRecord } from '../models';
import {
  buildPcUrl,
  getShelfList,
  getBookInfo,
  getBookNotes,
  transformNotes,
  getArticleBooks,
} from '../api';
import { StorageService } from './storageService';
import { getBookshelfProvider } from '../providers';
import { getDiffService } from './diffService';
import { getExportService } from './exportService';
import { getBookFileCleanupService } from './bookFileCleanupService';
import { getLocalDataService } from './localDataService';
import { getIndexService } from './indexService';
import { AccountId } from '../types/account';
import { getCookieManager } from '../auth';
import { warnDeprecatedNoAccountParam } from '../utils/deprecation';
import { getConfiguredOutputPath } from '../utils/outputPath';

export class SyncService {
  private storageService: StorageService;
  private syncingAccounts = new Set<AccountId>();
  private readonly maxConcurrency = 3;
  private readonly notesCacheTtlMs = 60 * 1000;
  private notesCache = new Map<string, { fetchedAt: number; data: any }>();
  private syncedBookCount = new Map<AccountId, number>();
  private estimatedTotalNotes = new Map<AccountId, number>();
  private syncedNotesCount = new Map<AccountId, number>();
  private _onDidStartSync = new vscode.EventEmitter<void>();
  private _onDidCompleteSync = new vscode.EventEmitter<SyncResult>();
  private _onDidUpdateProgress = new vscode.EventEmitter<SyncProgress>();

  public readonly onDidStartSync = this._onDidStartSync.event;
  public readonly onDidCompleteSync = this._onDidCompleteSync.event;
  public readonly onDidUpdateProgress = this._onDidUpdateProgress.event;

  constructor(storageService: StorageService) {
    this.storageService = storageService;
  }

  /**
   * 执行全量同步
   */
  async fullSync(accountId?: AccountId): Promise<SyncResult> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('syncService.fullSync()', getCookieManager().getActiveAccountId());
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
      await this.storageService.updateSyncStatus(SyncStatus.Syncing, undefined, targetAccountId);

      const remoteBooks = await this.loadRemoteBooks();
      const localBooks = await getIndexService().queryBooks(targetAccountId);
      const result = await this.syncChangedBooks(remoteBooks, localBooks, targetAccountId);
      this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });
      getBookshelfProvider().refresh();
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '同步失败';
      await this.storageService.updateSyncStatus(SyncStatus.Failed, errorMessage, targetAccountId);

      const result: SyncResult = {
        success: false,
        syncedBooks: 0,
        syncedNotes: 0,
        error: errorMessage,
        syncTime: Date.now(),
      };

      this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });

      return result;
    } finally {
      this.syncingAccounts.delete(targetAccountId);
    }
  }

  /**
   * 执行增量同步
   * 只同步有变化的书籍
   */
  async incrementalSync(accountId?: AccountId): Promise<SyncResult> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('syncService.incrementalSync()', getCookieManager().getActiveAccountId());
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
      await this.storageService.updateSyncStatus(SyncStatus.Syncing, undefined, targetAccountId);

      const remoteBooks = await this.loadRemoteBooks();
      const localBooks = await getIndexService().queryBooks(targetAccountId);
      const result = await this.syncChangedBooks(remoteBooks, localBooks, targetAccountId);
      this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });
      getBookshelfProvider().refresh();
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '同步失败';
      await this.storageService.updateSyncStatus(SyncStatus.Failed, errorMessage, targetAccountId);

      const result: SyncResult = {
        success: false,
        syncedBooks: 0,
        syncedNotes: 0,
        error: errorMessage,
        syncTime: Date.now(),
      };

      this._onDidCompleteSync.fire({ ...result, accountId: targetAccountId });

      return result;
    } finally {
      this.syncingAccounts.delete(targetAccountId);
    }
  }

  /**
   * 仅刷新书架（不拉取笔记）
   */
  async refreshShelfOnly(accountId?: AccountId): Promise<{ success: boolean; syncedBooks: number; totalBooks: number; error?: string }> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('syncService.refreshShelfOnly()', getCookieManager().getActiveAccountId());
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
      const shelfData = await getShelfList();
      const books = shelfData.books.map((b) => b.book);
      const articleBooks = await this.tryLoadArticleBooks();
      books.push(...articleBooks);
      const totalBooks = books.length;

      for (let i = 0; i < books.length; i++) {
        this.syncedBookCount.set(targetAccountId, i + 1);
        this.updateProgress(SyncStep.FetchingShelf, i + 1, totalBooks, books[i].title, targetAccountId);
      }

      getBookshelfProvider().refresh();

      return {
        success: true,
        syncedBooks: totalBooks,
        totalBooks,
      };
    } catch (error) {
      return {
        success: false,
        syncedBooks: 0,
        totalBooks: 0,
        error: error instanceof Error ? error.message : '刷新书架失败',
      };
    } finally {
      this.syncingAccounts.delete(targetAccountId);
    }
  }

  /**
   * 同步单本书籍
   */
  async syncBook(bookId: string, accountId?: AccountId): Promise<Note[]> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('syncService.syncBook()', getCookieManager().getActiveAccountId());
    }
    const targetAccountId = this.resolveAccountId(accountId);
    const notesData = await this.getBookNotesWithCache(bookId, targetAccountId);
    const notes = transformNotes(notesData, bookId);
    const localBook = await getIndexService().getBookById(bookId, targetAccountId);
    if (localBook) {
      localBook.highlightCount = notes.filter((n) => n.highlightText).length;
      localBook.noteCount = notes.length;
      localBook.reviewCount = notes.filter((n) => n.type === 4 || n.thoughtText).length;
      await getExportService().exportBookForSyncWithNotes(localBook, notes);
      await getLocalDataService().reloadFromConfiguredPath(targetAccountId).catch(() => undefined);
      await this.rebuildDailyAggFromIndex(targetAccountId).catch(() => undefined);
      getBookshelfProvider().refresh();
    }

    return notes;
  }

  private async syncBooksConcurrently(
    books: Book[],
    accountId: AccountId
  ): Promise<Array<{ bookId: string; notesCount: number; updated: boolean }>> {
    let finished = 0;
    const results: Array<{ bookId: string; notesCount: number; updated: boolean }> = [];
    const errors: string[] = [];
    const queue = [...books];
    const workers: Promise<void>[] = [];
    const exportService = getExportService();
    const diffService = getDiffService();

    const worker = async () => {
      while (queue.length > 0) {
        const book = queue.shift();
        if (!book) {
          break;
        }
        this.updateProgress(SyncStep.FetchingNotes, finished, books.length, book.title, accountId);
        try {
          const notesData = await this.getBookNotesWithCache(book.bookId, accountId);
          const remoteNotes = transformNotes(notesData, book.bookId);
          const localNotes = await getIndexService().getNotesByBookId(book.bookId, accountId);
          const noteChanges = diffService.detectNoteChanges(localNotes, remoteNotes);
          const changedNotesCount =
            noteChanges.added.length + noteChanges.modified.length + noteChanges.deleted.length;
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

            const exportResult = await exportService.exportBookForSyncWithNotes(book, notes, accountId);
            if (!exportResult.success) {
              throw new Error(exportResult.error || `写入《${book.title}》的笔记文件失败`);
            }

            results.push({
              bookId: book.bookId,
              notesCount: shouldUpdate ? (changedNotesCount || notes.length) : 0,
              updated: shouldUpdate || metadataChanged,
            });
            if (shouldUpdate) {
              this.syncedNotesCount.set(accountId, (this.syncedNotesCount.get(accountId) || 0) + (changedNotesCount || notes.length));
            }
          } else {
            results.push({ bookId: book.bookId, notesCount: 0, updated: false });
          }
        } catch (error) {
          console.error(`[Sync][account:${accountId}] Failed to sync book ${book.title}:`, error);
          errors.push(
            `《${book.title}》：${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          finished += 1;
          this.syncedBookCount.set(accountId, finished);
          this.updateProgress(SyncStep.FetchingNotes, finished, books.length, book.title, accountId);
        }
      }
    };

    const size = Math.min(this.maxConcurrency, Math.max(1, books.length));
    for (let i = 0; i < size; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (errors.length > 0) {
      const detail = errors.slice(0, 3).join('；');
      const remaining = errors.length > 3 ? `；另有 ${errors.length - 3} 本失败` : '';
      throw new Error(`有 ${errors.length} 本书同步失败：${detail}${remaining}`);
    }

    return results;
  }

  private async getBookNotesWithCache(bookId: string, accountId?: AccountId): Promise<any> {
    const key = `${String(accountId || 'default')}:${bookId}`;
    const cached = this.notesCache.get(key);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < this.notesCacheTtlMs) {
      return cached.data;
    }

    const sourceBookId = this.toSourceBookId(bookId);
    const data = await getBookNotes(sourceBookId);
    this.notesCache.set(key, { fetchedAt: now, data });
    return data;
  }

  private async tryLoadArticleBooks(): Promise<Book[]> {
    try {
      return await getArticleBooks();
    } catch {
      // 兼容旧账号/接口不可用场景
      return [];
    }
  }

  private toSourceBookId(bookId: string): string {
    return bookId.startsWith('article:') ? bookId.replace('article:', '') : bookId;
  }

  private async loadRemoteBooks(): Promise<Book[]> {
    this.updateProgress(SyncStep.FetchingShelf, 0, 0, '获取书架列表');
    const shelfData = await getShelfList();
    const remoteBooks = shelfData.books.map((b) => b.book);
    remoteBooks.push(...(await this.tryLoadArticleBooks()));
    return remoteBooks;
  }

  private async syncChangedBooks(remoteBooks: Book[], localBooks: Book[], accountId: AccountId): Promise<SyncResult> {
    if (!getConfiguredOutputPath()) {
      throw new Error('未设置笔记保存路径，请先运行“微信读书：配置笔记存储路径”');
    }
    const diffService = getDiffService();
    const diffs = diffService.detectBookChanges(localBooks, remoteBooks);
    const syncPlan = diffService.generateSyncPlan(diffs, remoteBooks);
    const localBooksMap = new Map(localBooks.map((book) => [book.bookId, book]));
    const metadataBooksToSync = remoteBooks.filter((remoteBook) => {
      const localBook = localBooksMap.get(remoteBook.bookId);
      return this.shouldRefreshMetadata(remoteBook) || (localBook ? this.shouldRefreshMetadata(localBook) : false);
    });
    const booksToSync =
      localBooks.length === 0
        ? remoteBooks
        : Array.from(new Map([...syncPlan.booksToSync, ...metadataBooksToSync].map((book) => [book.bookId, book])).values());
    this.estimatedTotalNotes.set(accountId, booksToSync.reduce(
      (sum, b) => sum + (b.highlightCount || 0) + (b.noteCount || 0),
      0
    ));

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

    this.updateProgress(SyncStep.SavingData, remoteBooks.length, remoteBooks.length, '保存数据', accountId);
    const reloadResult = await getLocalDataService().reloadFromConfiguredPath(accountId);
    if (remoteBooks.length > 0 && reloadResult.booksCount === 0) {
      throw new Error('同步文件已处理，但本地书架索引为空，请检查笔记保存路径和目录权限');
    }
    await this.rebuildDailyAggFromIndex(accountId).catch(() => undefined);
    try {
      const cleanupResult = await getBookFileCleanupService().cleanupDuplicateBookFilesForAccount(accountId);
      if (cleanupResult.movedFiles > 0) {
        console.info(
          `[Sync][account:${accountId}] duplicate book files cleaned moved=${cleanupResult.movedFiles} groups=${cleanupResult.duplicateGroups}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      console.warn(`[Sync][account:${accountId}] duplicate file cleanup failed: ${message}`);
    }
    await this.storageService.updateSyncStatus(SyncStatus.Success, undefined, accountId);

    return {
      success: true,
      syncedBooks: updatedBooks,
      syncedNotes: updatedNotes,
      syncTime: Date.now(),
      accountId,
    };
  }

  private shouldUpdateBookNotes(localNotes: Note[], remoteNotes: Note[], changedNotesCount: number): boolean {
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

  private getLatestNoteTime(notes: Note[]): number {
    return notes.reduce((latest, note) => {
      const noteTime = note.modifyTime || note.createTime || 0;
      return Math.max(latest, noteTime);
    }, 0);
  }

  private shouldRefreshMetadata(book: Book): boolean {
    if (book.bookId.startsWith('article:')) {
      return (
        !book.pcUrl ||
        /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl) ||
        !/\/web\/mp\/reader\//i.test(book.pcUrl)
      );
    }
    return !book.pcUrl || /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl);
  }

  private async enrichBookMetadataIfNeeded(book: Book): Promise<boolean> {
    if (book.bookId.startsWith('article:')) {
      const normalized = buildPcUrl(book.bookId);
      if (book.pcUrl !== normalized) {
        book.pcUrl = normalized;
        return true;
      }
      return false;
    }

    const pcUrlLooksRawId =
      !book.pcUrl || /\/web\/(?:mp\/)?reader\/(?:MP_WXS_[^/?#]+|\d+)(?:$|[?#])/i.test(book.pcUrl);
    const needResolveCanonicalReaderUrl =
      pcUrlLooksRawId && (book.bookId.startsWith('MP_WXS_') || /^\d+$/.test(book.bookId));
    const needFetch =
      !book.isbn ||
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
      const detail = await getBookInfo(this.toSourceBookId(book.bookId));
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
      } else if (
        needResolveCanonicalReaderUrl &&
        typeof detail.bookId === 'string' &&
        detail.bookId.trim() &&
        detail.bookId.trim() !== book.bookId
      ) {
        if (book.bookId.startsWith('MP_WXS_')) {
          book.pcUrl = `https://weread.qq.com/web/mp/reader/${detail.bookId.trim()}`;
        } else {
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
    } catch (error) {
      console.warn(`[Sync] Failed to enrich metadata for ${book.title}:`, error);
      return false;
    }
  }

  /**
   * 冲突处理策略：若本地笔记 modifyTime 更新，则保留本地版本，避免用户本地编辑被覆盖。
   */
  private mergeWithLocalNotes(localNotes: Note[], remoteNotes: Note[]): Note[] {
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

  private async rebuildDailyAggFromIndex(accountId?: AccountId): Promise<void> {
    const books = await getIndexService().queryBooks(accountId);
    const dailyMap = new Map<string, { notesCount: number; booksTouched: Set<string> }>();
    for (const book of books) {
      const notes = await getIndexService().getNotesByBookId(book.bookId, accountId);
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
    const records: DailyAggRecord[] = Array.from(dailyMap.entries())
      .map(([date, value]) => ({
        date,
        readDaysFlag: (value.notesCount > 0 ? 1 : 0) as 0 | 1,
        notesCount: value.notesCount,
        booksTouched: value.booksTouched.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    await this.storageService.saveDailyAgg(records, accountId);
  }

  private normalizeTimestampMs(raw: number): number {
    if (!raw || !Number.isFinite(raw)) {
      return 0;
    }
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 获取同步状态
   */
  getSyncState(accountId?: AccountId): SyncState {
    if (!accountId) {
      warnDeprecatedNoAccountParam('syncService.getSyncState()', getCookieManager().getActiveAccountId());
    }
    return this.storageService.getSyncState(accountId);
  }

  /**
   * 是否正在同步
   */
  isSyncingInProgress(accountId?: AccountId): boolean {
    if (!accountId) {
      warnDeprecatedNoAccountParam('syncService.isSyncingInProgress()', getCookieManager().getActiveAccountId());
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
  private updateProgress(
    step: SyncStep,
    currentIndex: number,
    total: number,
    bookName?: string,
    accountId?: AccountId
  ): void {
    const targetAccountId = this.resolveAccountId(accountId);
    const percentage = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
    const totalNotes = Math.max(
      this.estimatedTotalNotes.get(targetAccountId || '') || 0,
      this.syncedNotesCount.get(targetAccountId || '') || 0
    );

    const progress: SyncProgress = {
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

  private resolveAccountId(accountId?: AccountId): AccountId | undefined {
    const normalized = String(accountId || '').trim();
    if (normalized) {
      return normalized;
    }
    const active = getCookieManager().getActiveAccountId();
    return String(active || '').trim() || undefined;
  }
}

let syncServiceInstance: SyncService | undefined;

export function initializeSyncService(storageService: StorageService): SyncService {
  syncServiceInstance = new SyncService(storageService);
  return syncServiceInstance;
}

export function getSyncService(): SyncService {
  if (!syncServiceInstance) {
    throw new Error('SyncService not initialized');
  }
  return syncServiceInstance;
}
