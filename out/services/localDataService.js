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
exports.getLocalDataService = exports.parseBookMarkdownContent = exports.parseFrontmatter = exports.LocalDataService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const models_1 = require("../models");
const storageService_1 = require("./storageService");
const analyticsService_1 = require("./analyticsService");
const utils_1 = require("../utils");
const indexDedup_1 = require("./indexDedup");
const indexDedupeLogger_1 = require("./indexDedupeLogger");
const deprecation_1 = require("../utils/deprecation");
const auth_1 = require("../auth");
class LocalDataService {
    async reloadFromConfiguredPath(accountId) {
        const resolvedAccountId = this.resolveAccountId(accountId);
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('localDataService.reloadFromConfiguredPath()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const scanStart = Date.now();
        const outputPaths = this.getOutputPaths(resolvedAccountId);
        const primaryOutputPath = outputPaths[0];
        if (!primaryOutputPath) {
            await (0, storageService_1.getStorageService)().saveIndexSnapshot({
                schemaVersion: storageService_1.CURRENT_INDEX_SCHEMA_VERSION,
                outputPath: '',
                builtAt: Date.now(),
                books: [],
                errors: [],
            }, resolvedAccountId);
            await (0, storageService_1.getStorageService)().saveIndexScanState({
                lastScanAt: Date.now(),
                durationMs: Date.now() - scanStart,
                scannedFiles: 0,
                changedFiles: 0,
                errorCount: 0,
            }, resolvedAccountId);
            (0, analyticsService_1.getAnalyticsService)().clearCache();
            return { booksCount: 0, notesCount: 0 };
        }
        const basePath = (0, utils_1.getConfiguredOutputPath)();
        const normalizedBasePath = basePath ? path.resolve(basePath) : '';
        const markdownFileSet = new Set();
        const scannedPathStats = [];
        for (const scanPath of outputPaths) {
            try {
                await this.ensureReadableDirectory(scanPath);
            }
            catch (error) {
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
        const books = [];
        const indexBooks = [];
        const errors = [];
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
            }
            catch (error) {
                errors.push({
                    filePath,
                    code: utils_1.WEREAD_ERROR_CODES.fileStatFailed,
                    message: error instanceof Error ? error.message : '读取文件元数据失败',
                });
            }
        }
        const dedupeConflicts = [];
        const dedupedBooks = (0, indexDedup_1.dedupeIndexBooks)(indexBooks, (conflict) => {
            dedupeConflicts.push(conflict);
        }).sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0));
        (0, indexDedupeLogger_1.logIndexDedupeConflicts)('localDataService.reloadFromConfiguredPath', dedupeConflicts);
        const snapshot = {
            schemaVersion: storageService_1.CURRENT_INDEX_SCHEMA_VERSION,
            outputPath,
            builtAt: Date.now(),
            books: dedupedBooks,
            errors,
        };
        await (0, storageService_1.getStorageService)().saveIndexSnapshot(snapshot, resolvedAccountId);
        await (0, storageService_1.getStorageService)().saveIndexScanState({
            lastScanAt: Date.now(),
            durationMs: Date.now() - scanStart,
            outputPath,
            scannedFiles: markdownFiles.length,
            changedFiles: markdownFiles.length,
            errorCount: errors.length,
        }, resolvedAccountId);
        await (0, storageService_1.getStorageService)().replaceBooksAndNotes(dedupedBooks.map((entry) => ({
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
            readingStatus: models_1.ReadingStatus.NotStarted,
            totalReadDay: 0,
            readingTime: 0,
        })), Object.fromEntries(await Promise.all(dedupedBooks.map(async (entry) => {
            const content = await fs.promises.readFile(entry.filePath, 'utf-8').catch(() => '');
            return [entry.bookId, parseBookMarkdownContent(content, entry.filePath)?.notes || []];
        }))), resolvedAccountId);
        (0, analyticsService_1.getAnalyticsService)().clearCache();
        return {
            outputPath,
            booksCount: dedupedBooks.length,
            notesCount,
        };
    }
    getAccountRootPath(accountId) {
        const basePath = (0, utils_1.getConfiguredOutputPath)();
        if (!basePath) {
            return '';
        }
        const normalized = String(accountId || '').trim();
        return normalized ? path.join(basePath, 'accounts', normalized) : basePath;
    }
    getOutputPaths(accountId) {
        const basePath = (0, utils_1.getConfiguredOutputPath)();
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
    resolveAccountId(accountId) {
        const normalized = String(accountId || '').trim();
        if (normalized) {
            return normalized;
        }
        return (0, auth_1.getCookieManager)().getActiveAccountId();
    }
    async ensureReadableDirectory(dirPath) {
        let stat;
        try {
            stat = await fs.promises.stat(dirPath);
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT') {
                throw new Error((0, utils_1.formatErrorWithCode)(utils_1.WEREAD_ERROR_CODES.outputPathNotFound, `本地数据目录不存在：${dirPath}`));
            }
            if (code === 'EACCES' || code === 'EPERM') {
                throw new Error((0, utils_1.formatErrorWithCode)(utils_1.WEREAD_ERROR_CODES.outputPathPermissionDenied, `没有权限访问本地数据目录：${dirPath}`));
            }
            throw new Error((0, utils_1.formatErrorWithCode)(utils_1.WEREAD_ERROR_CODES.outputPathNotFound, `无法访问本地数据目录：${dirPath}`));
        }
        if (!stat.isDirectory()) {
            throw new Error((0, utils_1.formatErrorWithCode)(utils_1.WEREAD_ERROR_CODES.outputPathNotFound, `本地数据路径不是目录：${dirPath}`));
        }
    }
    async collectMarkdownFiles(rootPath, skipAccountsDir = false) {
        const result = [];
        const stack = [rootPath];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) {
                continue;
            }
            let entries;
            try {
                entries = await fs.promises.readdir(current, { withFileTypes: true });
            }
            catch (error) {
                if (current === rootPath) {
                    const code = error.code;
                    if (code === 'EACCES' || code === 'EPERM') {
                        throw new Error((0, utils_1.formatErrorWithCode)(utils_1.WEREAD_ERROR_CODES.outputPathPermissionDenied, `没有权限读取本地数据目录：${rootPath}（请在系统设置中为 VSCode 开启“文件与文件夹/下载”访问权限）`));
                    }
                    throw new Error((0, utils_1.formatErrorWithCode)(utils_1.WEREAD_ERROR_CODES.outputPathNotFound, `读取本地数据目录失败：${rootPath}`));
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
    async parseBookFile(filePath) {
        let content = '';
        try {
            content = await fs.promises.readFile(filePath, 'utf-8');
        }
        catch {
            return undefined;
        }
        if (!content.trim()) {
            return undefined;
        }
        return parseBookMarkdownContent(content, filePath);
    }
}
exports.LocalDataService = LocalDataService;
function normalizeMarkdownParsingContent(content) {
    return content.replace(/^\uFEFF/, '');
}
function isGenericMarkdownSectionTitle(title) {
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
function sanitizeFrontmatterValue(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}
function parseFrontmatter(content) {
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
    const record = {};
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
exports.parseFrontmatter = parseFrontmatter;
function parseBookMarkdownContent(content, filePath) {
    if (!content.trim()) {
        return undefined;
    }
    const frontmatter = parseFrontmatter(content);
    const fallbackTitle = parseMarkdownTitle(content) || path.basename(filePath, '.md');
    const fallbackCategory = path.basename(path.dirname(filePath));
    const bookId = (0, utils_1.normalizeBookId)(frontmatter.bookid || frontmatter.bookId || `local:${filePath}`);
    const normalizedPcUrl = normalizePcUrl(frontmatter.pcUrl);
    const notes = parseNotes(content, bookId);
    const frontmatterTitle = sanitizeFrontmatterValue(frontmatter.title);
    const resolvedTitle = frontmatterTitle && !isGenericMarkdownSectionTitle(frontmatterTitle)
        ? frontmatterTitle
        : fallbackTitle;
    const book = {
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
        highlightCount: notes.filter((note) => note.type === models_1.NoteType.Highlight).length,
        noteCount: notes.length,
        pcUrl: normalizedPcUrl,
        localFilePath: filePath,
    };
    return { book, notes };
}
exports.parseBookMarkdownContent = parseBookMarkdownContent;
function normalizePcUrl(pcUrl) {
    const trimmed = String(pcUrl || '').trim();
    if (!trimmed) {
        return undefined;
    }
    if (/^https?:\/\/weread\.qq\.com\/web\/reader\/MP_WXS_/i.test(trimmed)) {
        return trimmed.replace('/web/reader/', '/web/mp/reader/');
    }
    return trimmed;
}
function parseMarkdownTitle(content) {
    const match = normalizeMarkdownParsingContent(content).match(/^#\s+(.+)$/m);
    const title = match?.[1]?.trim() || '';
    return isGenericMarkdownSectionTitle(title) ? '' : title;
}
function parseNotes(content, bookId) {
    const lines = content.split(/\r?\n/);
    const notes = [];
    let currentChapter = '未分类章节';
    let lastNote;
    for (const line of lines) {
        const chapterMatch = line.match(/^###\s+(.+)$/);
        if (chapterMatch?.[1]) {
            currentChapter = chapterMatch[1].trim() || '未分类章节';
            continue;
        }
        const highlightMatch = line.match(/^>\s+(.+)$/);
        if (highlightMatch?.[1]) {
            const note = buildBaseNote(bookId, currentChapter, models_1.NoteType.Highlight);
            note.highlightText = highlightMatch[1].trim();
            notes.push(note);
            lastNote = note;
            continue;
        }
        const thoughtMatch = line.match(/^(?:[-*]\s*)?(?:💬|💭)\s*(?:评论)?[:：]?\s*(.+)$/);
        if (thoughtMatch?.[1]) {
            const note = buildBaseNote(bookId, currentChapter, models_1.NoteType.Thought);
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
        }
    }
    for (const note of notes) {
        note.noteId = buildStableLocalNoteId(note);
    }
    return notes;
}
function buildBaseNote(bookId, chapterTitle, type) {
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
function buildStableLocalNoteId(note) {
    const payload = [
        String(note.bookId || '').trim(),
        String(note.chapterUid || 0).trim(),
        String(note.chapterTitle || '').trim(),
        String(note.type || '').trim(),
        String(note.highlightText || '').trim(),
        String(note.thoughtText || '').trim(),
        String(note.createTime || 0).trim(),
    ].join('|');
    const digest = (0, crypto_1.createHash)('sha1').update(payload).digest('hex').slice(0, 12);
    return `local_${digest}`;
}
function parseProgress(raw) {
    if (!raw) {
        return 0;
    }
    const parsed = Number(raw.replace('%', '').trim());
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(100, parsed));
}
function parseReadingStatus(raw) {
    if (!raw) {
        return models_1.ReadingStatus.NotStarted;
    }
    const normalized = raw.trim();
    if (normalized === '2' || normalized === '已读完') {
        return models_1.ReadingStatus.Finished;
    }
    if (normalized === '1' || normalized === '阅读中') {
        return models_1.ReadingStatus.Reading;
    }
    return models_1.ReadingStatus.NotStarted;
}
function parseNumber(raw) {
    if (!raw) {
        return undefined;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseUnixTimestamp(raw) {
    if (!raw) {
        return undefined;
    }
    const direct = Number(raw);
    if (Number.isFinite(direct) && direct > 0) {
        return direct > 1000000000000 ? Math.floor(direct / 1000) : Math.floor(direct);
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
        return Math.floor(parsed / 1000);
    }
    return undefined;
}
let localDataServiceInstance;
function getLocalDataService() {
    if (!localDataServiceInstance) {
        localDataServiceInstance = new LocalDataService();
    }
    return localDataServiceInstance;
}
exports.getLocalDataService = getLocalDataService;
//# sourceMappingURL=localDataService.js.map
