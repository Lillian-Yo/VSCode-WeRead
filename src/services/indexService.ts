import * as fs from 'fs';
import * as path from 'path';
import { Book, IndexBookEntry, IndexErrorEntry, IndexSnapshot, IndexScanState, Note, ReadingStatus } from '../models';
import { normalizeBookId, getConfiguredOutputPath, validateOutputPathReadable, WEREAD_ERROR_CODES, formatErrorWithCode } from '../utils';
import { getStorageService, CURRENT_INDEX_SCHEMA_VERSION } from './storageService';
import { parseBookMarkdownContent } from './localDataService';
import { DedupeConflict, dedupeIndexBooks } from './indexDedup';
import { logIndexDedupeConflicts } from './indexDedupeLogger';
import { AccountId } from '../types/account';
import { getCookieManager } from '../auth';
import { warnDeprecatedNoAccountParam } from '../utils/deprecation';

export type IndexBuildResult = {
  snapshot: IndexSnapshot;
  scanState: IndexScanState;
};

export function shouldReparseFile(
  previous: Pick<IndexBookEntry, 'fileMtimeMs' | 'fileSize'> | undefined,
  next: Pick<IndexBookEntry, 'fileMtimeMs' | 'fileSize'>
): boolean {
  if (!previous) {
    return true;
  }
  return previous.fileMtimeMs !== next.fileMtimeMs || previous.fileSize !== next.fileSize;
}

export class IndexService {
  async rebuildFromConfiguredPath(accountId?: AccountId): Promise<IndexSnapshot | undefined> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    const outputPath = this.resolveOutputPath(resolvedAccountId);
    if (!outputPath) {
      return undefined;
    }
    return this.rebuildFromOutputPath(outputPath, resolvedAccountId);
  }

  async rebuildFromOutputPath(outputPath: string, accountId?: AccountId): Promise<IndexSnapshot> {
    const built = await this.buildFromOutputPath(outputPath);
    await this.persistBuildResult(built, accountId);
    return built.snapshot;
  }

  async previewFromOutputPath(outputPath: string, _accountId?: AccountId): Promise<IndexBuildResult> {
    return this.buildFromOutputPath(outputPath);
  }

  async persistBuildResult(result: IndexBuildResult, accountId?: AccountId): Promise<void> {
    const storage = getStorageService();
    await storage.saveIndexSnapshot(result.snapshot, accountId);
    await storage.saveIndexScanState(result.scanState, accountId);
  }

  getLatestIndexErrors(accountId?: AccountId): IndexErrorEntry[] {
    return getStorageService().getIndexSnapshot(accountId)?.errors || [];
  }

  async queryBooks(accountId?: AccountId): Promise<Book[]> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('indexService.queryBooks()', getCookieManager().getActiveAccountId());
    }
    const resolvedAccountId = this.resolveAccountId(accountId);
    const storage = getStorageService();
    let snapshot = storage.getIndexSnapshot(resolvedAccountId);
    if (!snapshot) {
      snapshot = await this.rebuildFromConfiguredPath(resolvedAccountId);
    }
    if ((!snapshot || snapshot.books.length === 0) && resolvedAccountId) {
      snapshot = storage.getIndexSnapshot(undefined) || snapshot;
      if ((!snapshot || snapshot.books.length === 0) && this.resolveOutputPath(undefined)) {
        snapshot = await this.rebuildFromConfiguredPath(undefined);
      }
    }
    if (!snapshot) {
      return [];
    }
    const dedupedBooks = dedupeIndexBooks(snapshot.books).sort(
      (a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0)
    );
    return dedupedBooks.map((entry) => this.toBook(entry));
  }

  async getBookById(bookId: string, accountId?: AccountId): Promise<Book | undefined> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('indexService.getBookById()', getCookieManager().getActiveAccountId());
    }
    const resolvedAccountId = this.resolveAccountId(accountId);
    const normalizedId = normalizeBookId(bookId);
    const storage = getStorageService();
    let snapshot = storage.getIndexSnapshot(resolvedAccountId);
    if (!snapshot) {
      snapshot = await this.rebuildFromConfiguredPath(resolvedAccountId);
    }
    if ((!snapshot || snapshot.books.length === 0) && resolvedAccountId) {
      snapshot = storage.getIndexSnapshot(undefined) || snapshot;
    }
    const hit = snapshot?.books.find((item) => item.bookId === normalizedId || item.rawBookId === bookId);
    if (!hit) {
      return undefined;
    }

    try {
      const content = await fs.promises.readFile(hit.filePath, 'utf-8');
      const parsed = parseBookMarkdownContent(content, hit.filePath);
      if (parsed?.book) {
        return parsed.book;
      }
    } catch {
      // fallback to snapshot
    }
    return this.toBook(hit);
  }

  async getNotesByBookId(bookId: string, accountId?: AccountId): Promise<Note[]> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('indexService.getNotesByBookId()', getCookieManager().getActiveAccountId());
    }
    const book = await this.getBookById(bookId, this.resolveAccountId(accountId));
    if (!book?.localFilePath) {
      return [];
    }
    try {
      const content = await fs.promises.readFile(book.localFilePath, 'utf-8');
      return parseBookMarkdownContent(content, book.localFilePath)?.notes || [];
    } catch {
      return [];
    }
  }

  private async collectMarkdownFiles(rootPath: string): Promise<string[]> {
    const result: string[] = [];
    const stack = [rootPath];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '阅读洞察报告') {
            continue;
          }
          stack.push(fullPath);
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          result.push(fullPath);
        }
      }
    }
    return result;
  }

  private async buildFromOutputPath(outputPath: string): Promise<IndexBuildResult> {
    const scanStart = Date.now();
    const validation = await validateOutputPathReadable(outputPath);
    if (!validation.ok) {
      throw new Error(
        formatErrorWithCode(
          WEREAD_ERROR_CODES.indexBuildFailed,
          validation.reason || '输出目录不可读'
        )
      );
    }

    const markdownFiles = await this.collectMarkdownFiles(validation.normalizedPath);
    const books: IndexBookEntry[] = [];
    const errors: IndexErrorEntry[] = [];

    for (const filePath of markdownFiles) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = parseBookMarkdownContent(content, filePath);
        if (!parsed) {
          continue;
        }
        const stat = await fs.promises.stat(filePath);
        books.push(this.toIndexEntry(parsed.book, stat, filePath));
      } catch (error) {
        errors.push({
          filePath,
          code: WEREAD_ERROR_CODES.fileParseFailed,
          message: error instanceof Error ? error.message : '解析失败',
        });
      }
    }

    const dedupeConflicts: DedupeConflict[] = [];
    const deduped = dedupeIndexBooks(books, (conflict) => {
      dedupeConflicts.push(conflict);
    });
    logIndexDedupeConflicts('indexService.buildFromOutputPath', dedupeConflicts);
    const snapshot: IndexSnapshot = {
      schemaVersion: CURRENT_INDEX_SCHEMA_VERSION,
      outputPath: validation.normalizedPath,
      builtAt: Date.now(),
      books: deduped.sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0)),
      errors,
    };

    const scanState: IndexScanState = {
      lastScanAt: Date.now(),
      durationMs: Date.now() - scanStart,
      outputPath: validation.normalizedPath,
      scannedFiles: markdownFiles.length,
      changedFiles: markdownFiles.length,
      errorCount: errors.length,
    };

    return { snapshot, scanState };
  }

  private toIndexEntry(book: Book, stat: fs.Stats, filePath: string): IndexBookEntry {
    return {
      bookId: book.bookId,
      rawBookId: book.rawBookId,
      title: book.title,
      author: book.author,
      category: book.category,
      noteCount: book.noteCount || 0,
      highlightCount: book.highlightCount || 0,
      lastReadTime: book.lastReadTime,
      filePath,
      fileMtimeMs: stat.mtimeMs,
      fileSize: stat.size,
    };
  }

  private toBook(entry: IndexBookEntry): Book {
    return {
      bookId: entry.bookId,
      rawBookId: entry.rawBookId,
      title: entry.title,
      author: entry.author || '',
      category: entry.category || '未分类',
      noteCount: entry.noteCount || 0,
      highlightCount: entry.highlightCount || 0,
      lastReadTime: entry.lastReadTime,
      localFilePath: entry.filePath,
      cover: '',
      reviewCount: 0,
      progress: 0,
      readingStatus: ReadingStatus.NotStarted,
      totalReadDay: 0,
      readingTime: 0,
    };
  }

  private resolveOutputPath(accountId?: AccountId): string | undefined {
    const basePath = getConfiguredOutputPath();
    if (!basePath) {
      return undefined;
    }
    const normalized = String(accountId || '').trim();
    if (!normalized) {
      return basePath;
    }
    const accountPath = path.join(basePath, 'accounts', normalized);
    if (fs.existsSync(accountPath)) {
      return accountPath;
    }
    // 兼容历史单账号目录：账号目录不存在时回退到旧根目录读取
    return basePath;
  }

  private resolveAccountId(accountId?: AccountId): AccountId | undefined {
    const normalized = String(accountId || '').trim();
    if (normalized) {
      return normalized;
    }
    return getCookieManager().getActiveAccountId();
  }
}

let indexServiceInstance: IndexService | undefined;

export function getIndexService(): IndexService {
  if (!indexServiceInstance) {
    indexServiceInstance = new IndexService();
  }
  return indexServiceInstance;
}
