import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Book, IndexBookEntry, IndexSnapshot, Note, NoteType, ReadingStatus } from '../models';
import { CURRENT_INDEX_SCHEMA_VERSION, getStorageService } from './storageService';
import { getAnalyticsService } from './analyticsService';
import { WEREAD_ERROR_CODES, formatErrorWithCode, getConfiguredOutputPath, normalizeBookId } from '../utils';
import { DedupeConflict, dedupeIndexBooks } from './indexDedup';
import { logIndexDedupeConflicts } from './indexDedupeLogger';
import { AccountId } from '../types/account';
import { warnDeprecatedNoAccountParam } from '../utils/deprecation';
import { getCookieManager } from '../auth';

type ParsedBookFile = {
  book: Book;
  notes: Note[];
};

type ReloadResult = {
  outputPath?: string;
  booksCount: number;
  notesCount: number;
};

export class LocalDataService {
  async reloadFromConfiguredPath(accountId?: AccountId): Promise<ReloadResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    if (!accountId) {
      warnDeprecatedNoAccountParam('localDataService.reloadFromConfiguredPath()', getCookieManager().getActiveAccountId());
    }
    const scanStart = Date.now();
    const outputPaths = this.getOutputPaths(resolvedAccountId);
    const primaryOutputPath = outputPaths[0];
    if (!primaryOutputPath) {
      await getStorageService().saveIndexSnapshot({
        schemaVersion: CURRENT_INDEX_SCHEMA_VERSION,
        outputPath: '',
        builtAt: Date.now(),
        books: [],
        errors: [],
      }, resolvedAccountId);
      await getStorageService().saveIndexScanState({
        lastScanAt: Date.now(),
        durationMs: Date.now() - scanStart,
        scannedFiles: 0,
        changedFiles: 0,
        errorCount: 0,
      }, resolvedAccountId);
      getAnalyticsService().clearCache();
      return { booksCount: 0, notesCount: 0 };
    }

    const basePath = getConfiguredOutputPath();
    const normalizedBasePath = basePath ? path.resolve(basePath) : '';
    const markdownFileSet = new Set<string>();
    const scannedPathStats: Array<{ outputPath: string; files: number }> = [];
    for (const scanPath of outputPaths) {
      try {
        await this.ensureReadableDirectory(scanPath);
      } catch (error) {
        if (scanPath === primaryOutputPath) {
          throw error;
        }
        continue;
      }
      const shouldSkipAccountsDir = !!normalizedBasePath && path.resolve(scanPath) === normalizedBasePath;
      const scannedFiles = await this.collectMarkdownFiles(scanPath, shouldSkipAccountsDir);
      scannedPathStats.push({ outputPath: scanPath, files: scannedFiles.length });
      for (const filePath of scannedFiles) {
        markdownFileSet.add(path.resolve(filePath));
      }
    }
    const markdownFiles = Array.from(markdownFileSet);
    const outputPath = scannedPathStats.find((item) => item.files > 0)?.outputPath || primaryOutputPath;
    const books: Book[] = [];
    const indexBooks: IndexBookEntry[] = [];
    const errors: Array<{ filePath: string; code: string; message: string }> = [];
    let notesCount = 0;

    for (const filePath of markdownFiles) {
      const parsed = await this.parseBookFile(filePath);
      if (!parsed) {
        continue;
      }
      books.push(parsed.book);
      notesCount += parsed.notes.length;
      try {
        const stat = await fs.promises.stat(filePath);
        indexBooks.push({
          bookId: parsed.book.bookId,
          rawBookId: parsed.book.rawBookId,
          title: parsed.book.title,
          author: parsed.book.author,
          category: parsed.book.category,
          noteCount: parsed.book.noteCount || 0,
          highlightCount: parsed.book.highlightCount || 0,
          lastReadTime: parsed.book.lastReadTime,
          filePath,
          fileMtimeMs: stat.mtimeMs,
          fileSize: stat.size,
        });
      } catch (error) {
        errors.push({
          filePath,
          code: WEREAD_ERROR_CODES.fileStatFailed,
          message: error instanceof Error ? error.message : '读取文件元数据失败',
        });
      }
    }

    const dedupeConflicts: DedupeConflict[] = [];
    const dedupedBooks = dedupeIndexBooks(indexBooks, (conflict) => {
      dedupeConflicts.push(conflict);
    }).sort(
      (a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0)
    );
    logIndexDedupeConflicts('localDataService.reloadFromConfiguredPath', dedupeConflicts);
    const snapshot: IndexSnapshot = {
      schemaVersion: CURRENT_INDEX_SCHEMA_VERSION,
      outputPath,
      builtAt: Date.now(),
      books: dedupedBooks,
      errors,
    };
    await getStorageService().saveIndexSnapshot(snapshot, resolvedAccountId);
    await getStorageService().saveIndexScanState({
      lastScanAt: Date.now(),
      durationMs: Date.now() - scanStart,
      outputPath,
      scannedFiles: markdownFiles.length,
      changedFiles: markdownFiles.length,
      errorCount: errors.length,
    }, resolvedAccountId);
    await getStorageService().replaceBooksAndNotes(
      dedupedBooks.map((entry) => ({
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
      })),
      Object.fromEntries(
        await Promise.all(
          dedupedBooks.map(async (entry) => {
            const content = await fs.promises.readFile(entry.filePath, 'utf-8').catch(() => '');
            return [entry.bookId, parseBookMarkdownContent(content, entry.filePath)?.notes || []] as const;
          })
        )
      ),
      resolvedAccountId
    );
    getAnalyticsService().clearCache();

    return {
      outputPath,
      booksCount: dedupedBooks.length,
      notesCount,
    };
  }

  getAccountRootPath(accountId: AccountId): string {
    const basePath = getConfiguredOutputPath();
    if (!basePath) {
      return '';
    }
    const normalized = String(accountId || '').trim();
    return normalized ? path.join(basePath, 'accounts', normalized) : basePath;
  }

  private getOutputPaths(accountId?: AccountId): string[] {
    const basePath = getConfiguredOutputPath();
    if (!basePath) {
      return [];
    }
    if (!accountId) {
      return [basePath];
    }
    const accountRootPath = this.getAccountRootPath(accountId);
    if (!accountRootPath || !fs.existsSync(accountRootPath)) {
      return [basePath];
    }
    // 兼容历史单账号目录：账号目录存在时同时扫描账号目录和旧根目录（根目录跳过 accounts 子树）
    return [accountRootPath, basePath];
  }

  private resolveAccountId(accountId?: AccountId): AccountId | undefined {
    const normalized = String(accountId || '').trim();
    if (normalized) {
      return normalized;
    }
    return getCookieManager().getActiveAccountId();
  }

  private async ensureReadableDirectory(dirPath: string): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(dirPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new Error(formatErrorWithCode(WEREAD_ERROR_CODES.outputPathNotFound, `本地数据目录不存在：${dirPath}`));
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          formatErrorWithCode(WEREAD_ERROR_CODES.outputPathPermissionDenied, `没有权限访问本地数据目录：${dirPath}`)
        );
      }
      throw new Error(formatErrorWithCode(WEREAD_ERROR_CODES.outputPathNotFound, `无法访问本地数据目录：${dirPath}`));
    }

    if (!stat.isDirectory()) {
      throw new Error(formatErrorWithCode(WEREAD_ERROR_CODES.outputPathNotFound, `本地数据路径不是目录：${dirPath}`));
    }
  }

  private async collectMarkdownFiles(rootPath: string, skipAccountsDir = false): Promise<string[]> {
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
      } catch (error) {
        if (current === rootPath) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EACCES' || code === 'EPERM') {
            throw new Error(
              formatErrorWithCode(
                WEREAD_ERROR_CODES.outputPathPermissionDenied,
                `没有权限读取本地数据目录：${rootPath}（请在系统设置中为 VSCode 开启“文件与文件夹/下载”访问权限）`
              )
            );
          }
          throw new Error(formatErrorWithCode(WEREAD_ERROR_CODES.outputPathNotFound, `读取本地数据目录失败：${rootPath}`));
        }
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '阅读洞察报告' || entry.name === '._weread_trash') {
            continue;
          }
          if (skipAccountsDir && entry.name === 'accounts') {
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

  private async parseBookFile(filePath: string): Promise<ParsedBookFile | undefined> {
    let content = '';
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return undefined;
    }
    if (!content.trim()) {
      return undefined;
    }
    return parseBookMarkdownContent(content, filePath);
  }
}

function normalizeMarkdownParsingContent(content: string): string {
  return content.replace(/^\uFEFF/, '');
}

function isGenericMarkdownSectionTitle(title: string): boolean {
  const normalized = String(title || '')
    .trim()
    .replace(/[：:]/g, '')
    .toLowerCase();
  return [
    '元数据',
    'metadata',
    '书籍信息',
    'book metadata',
    '读书笔记',
    '笔记',
    'notes',
    '书评',
    'review',
  ].includes(normalized);
}

function sanitizeFrontmatterValue(value: string | undefined): string {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

export function parseFrontmatter(content: string): Record<string, string> {
  const lines = normalizeMarkdownParsingContent(content).split(/\r?\n/);
  let startIndex = 0;
  while (startIndex < lines.length && !lines[startIndex].trim()) {
    startIndex += 1;
  }
  if (lines.length - startIndex < 3 || lines[startIndex].trim() !== '---') {
    return {};
  }
  const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.trim() === '---');
  if (endIndex <= startIndex) {
    return {};
  }
  const record: Record<string, string> = {};
  for (let i = startIndex + 1; i < endIndex; i++) {
    const line = lines[i];
    const splitIndex = line.indexOf(':');
    if (splitIndex <= 0) {
      continue;
    }
    const key = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1).trim();
    if (!key) {
      continue;
    }
    record[key] = value;
  }
  return record;
}

export function parseBookMarkdownContent(content: string, filePath: string): ParsedBookFile | undefined {
  if (!content.trim()) {
    return undefined;
  }

  const frontmatter = parseFrontmatter(content);
  const fallbackTitle = parseMarkdownTitle(content) || path.basename(filePath, '.md');
  const fallbackCategory = path.basename(path.dirname(filePath));
  const bookId = normalizeBookId(frontmatter.bookid || frontmatter.bookId || `local:${filePath}`);
  const normalizedPcUrl = normalizePcUrl(frontmatter.pcUrl);
  const notes = parseNotes(content, bookId);
  const frontmatterTitle = sanitizeFrontmatterValue(frontmatter.title);
  const resolvedTitle = frontmatterTitle && !isGenericMarkdownSectionTitle(frontmatterTitle)
    ? frontmatterTitle
    : fallbackTitle;

  const book: Book = {
    bookId,
    rawBookId: frontmatter.bookid || frontmatter.bookId || bookId,
    docType: frontmatter.doc_type || frontmatter.docType,
    title: resolvedTitle,
    author: sanitizeFrontmatterValue(frontmatter.author),
    cover: frontmatter.cover || '',
    isbn: frontmatter.isbn,
    publisher: frontmatter.publisher,
    publishTime: frontmatter.publishTime,
    category: frontmatter.category || fallbackCategory || '未分类',
    reviewCount: parseNumber(frontmatter.reviewCount),
    progress: parseProgress(frontmatter.progress),
    readingStatus: parseReadingStatus(frontmatter.readingStatus),
    totalReadDay: parseNumber(frontmatter.totalReadDay),
    readingTime: parseNumber(frontmatter.readingTime),
    readingDate: frontmatter.readingDate,
    lastReadTime: parseUnixTimestamp(frontmatter.lastReadTime),
    highlightCount: notes.filter((note) => note.type === NoteType.Highlight).length,
    noteCount: notes.length,
    pcUrl: normalizedPcUrl,
    localFilePath: filePath,
  };

  return { book, notes };
}

function normalizePcUrl(pcUrl: string | undefined): string | undefined {
  const trimmed = String(pcUrl || '').trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^https?:\/\/weread\.qq\.com\/web\/reader\/MP_WXS_/i.test(trimmed)) {
    return trimmed.replace('/web/reader/', '/web/mp/reader/');
  }
  return trimmed;
}

function parseMarkdownTitle(content: string): string {
  const match = normalizeMarkdownParsingContent(content).match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim() || '';
  return isGenericMarkdownSectionTitle(title) ? '' : title;
}

function parseNotes(content: string, bookId: string): Note[] {
  const lines = content.split(/\r?\n/);
  const notes: Note[] = [];
  let currentChapter = '未分类章节';
  let lastNote: Note | undefined;

  for (const line of lines) {
    const chapterMatch = line.match(/^###\s+(.+)$/);
    if (chapterMatch?.[1]) {
      currentChapter = chapterMatch[1].trim() || '未分类章节';
      continue;
    }

    const highlightMatch = line.match(/^>\s+(.+)$/);
    if (highlightMatch?.[1]) {
      const note = buildBaseNote(bookId, currentChapter, NoteType.Highlight);
      note.highlightText = highlightMatch[1].trim();
      notes.push(note);
      lastNote = note;
      continue;
    }

    const thoughtMatch = line.match(/^(?:[-*]\s*)?(?:💬|💭)\s*(?:评论)?[:：]?\s*(.+)$/);
    if (thoughtMatch?.[1]) {
      const note = buildBaseNote(bookId, currentChapter, NoteType.Thought);
      note.thoughtText = thoughtMatch[1].trim();
      notes.push(note);
      lastNote = note;
      continue;
    }

    const timeMatch = line.match(/^_记录时间[:：](.+)_$/);
    if (timeMatch?.[1] && lastNote) {
      const ts = parseUnixTimestamp(timeMatch[1].trim());
      if (ts) {
        lastNote.createTime = ts;
      }
      continue;
    }

    const authorUnderscore = line.match(/^_作者[:：]\s*(.+?)_$/);
    if (authorUnderscore?.[1] && lastNote) {
      lastNote.author = authorUnderscore[1].trim();
      continue;
    }
    const authorDash = line.match(/^[-*]\s*作者[:：]\s*(.+)$/);
    if (authorDash?.[1] && lastNote) {
      lastNote.author = authorDash[1].trim();
      continue;
    }
  }
  for (const note of notes) {
    note.noteId = buildStableLocalNoteId(note);
  }
  return notes;
}

function buildBaseNote(bookId: string, chapterTitle: string, type: NoteType): Note {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    noteId: `local_pending_${nowSec}`,
    bookId,
    chapterUid: 0,
    chapterTitle,
    type,
    createTime: nowSec,
  };
}

function buildStableLocalNoteId(note: Note): string {
  const payload = [
    String(note.bookId || '').trim(),
    String(note.chapterUid || 0).trim(),
    String(note.chapterTitle || '').trim(),
    String(note.type || '').trim(),
    String(note.highlightText || '').trim(),
    String(note.thoughtText || '').trim(),
    String(note.createTime || 0).trim(),
  ].join('|');
  const digest = createHash('sha1').update(payload).digest('hex').slice(0, 12);
  return `local_${digest}`;
}

function parseProgress(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw.replace('%', '').trim());
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, parsed));
}

function parseReadingStatus(raw: string | undefined): ReadingStatus {
  if (!raw) {
    return ReadingStatus.NotStarted;
  }
  const normalized = raw.trim();
  if (normalized === '2' || normalized === '已读完') {
    return ReadingStatus.Finished;
  }
  if (normalized === '1' || normalized === '阅读中') {
    return ReadingStatus.Reading;
  }
  return ReadingStatus.NotStarted;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseUnixTimestamp(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) {
    return direct > 1_000_000_000_000 ? Math.floor(direct / 1000) : Math.floor(direct);
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return undefined;
}

let localDataServiceInstance: LocalDataService | undefined;

export function getLocalDataService(): LocalDataService {
  if (!localDataServiceInstance) {
    localDataServiceInstance = new LocalDataService();
  }
  return localDataServiceInstance;
}
