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
exports.getIndexService = exports.IndexService = exports.shouldReparseFile = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const models_1 = require("../models");
const utils_1 = require("../utils");
const storageService_1 = require("./storageService");
const localDataService_1 = require("./localDataService");
const indexDedup_1 = require("./indexDedup");
const indexDedupeLogger_1 = require("./indexDedupeLogger");
const auth_1 = require("../auth");
const deprecation_1 = require("../utils/deprecation");
function shouldReparseFile(previous, next) {
    if (!previous) {
        return true;
    }
    return previous.fileMtimeMs !== next.fileMtimeMs || previous.fileSize !== next.fileSize;
}
exports.shouldReparseFile = shouldReparseFile;
class IndexService {
    async rebuildFromConfiguredPath(accountId) {
        const resolvedAccountId = this.resolveAccountId(accountId);
        const outputPath = this.resolveOutputPath(resolvedAccountId);
        if (!outputPath) {
            return undefined;
        }
        return this.rebuildFromOutputPath(outputPath, resolvedAccountId);
    }
    async rebuildFromOutputPath(outputPath, accountId) {
        const built = await this.buildFromOutputPath(outputPath);
        await this.persistBuildResult(built, accountId);
        return built.snapshot;
    }
    async previewFromOutputPath(outputPath, _accountId) {
        return this.buildFromOutputPath(outputPath);
    }
    async persistBuildResult(result, accountId) {
        const storage = (0, storageService_1.getStorageService)();
        await storage.saveIndexSnapshot(result.snapshot, accountId);
        await storage.saveIndexScanState(result.scanState, accountId);
    }
    getLatestIndexErrors(accountId) {
        return (0, storageService_1.getStorageService)().getIndexSnapshot(accountId)?.errors || [];
    }
    async queryBooks(accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('indexService.queryBooks()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const resolvedAccountId = this.resolveAccountId(accountId);
        const storage = (0, storageService_1.getStorageService)();
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
        const dedupedBooks = (0, indexDedup_1.dedupeIndexBooks)(snapshot.books).sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0));
        return dedupedBooks.map((entry) => this.toBook(entry));
    }
    async getBookById(bookId, accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('indexService.getBookById()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const resolvedAccountId = this.resolveAccountId(accountId);
        const normalizedId = (0, utils_1.normalizeBookId)(bookId);
        const storage = (0, storageService_1.getStorageService)();
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
            const parsed = (0, localDataService_1.parseBookMarkdownContent)(content, hit.filePath);
            if (parsed?.book) {
                return parsed.book;
            }
        }
        catch {
            // fallback to snapshot
        }
        return this.toBook(hit);
    }
    async getNotesByBookId(bookId, accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('indexService.getNotesByBookId()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const book = await this.getBookById(bookId, this.resolveAccountId(accountId));
        if (!book?.localFilePath) {
            return [];
        }
        try {
            const content = await fs.promises.readFile(book.localFilePath, 'utf-8');
            return (0, localDataService_1.parseBookMarkdownContent)(content, book.localFilePath)?.notes || [];
        }
        catch {
            return [];
        }
    }
    async collectMarkdownFiles(rootPath) {
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
            catch {
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
    async buildFromOutputPath(outputPath) {
        const scanStart = Date.now();
        const validation = await (0, utils_1.validateOutputPathReadable)(outputPath);
        if (!validation.ok) {
            throw new Error((0, utils_1.formatErrorWithCode)(utils_1.WEREAD_ERROR_CODES.indexBuildFailed, validation.reason || '输出目录不可读'));
        }
        const markdownFiles = await this.collectMarkdownFiles(validation.normalizedPath);
        const books = [];
        const errors = [];
        for (const filePath of markdownFiles) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const parsed = (0, localDataService_1.parseBookMarkdownContent)(content, filePath);
                if (!parsed) {
                    continue;
                }
                const stat = await fs.promises.stat(filePath);
                books.push(this.toIndexEntry(parsed.book, stat, filePath));
            }
            catch (error) {
                errors.push({
                    filePath,
                    code: utils_1.WEREAD_ERROR_CODES.fileParseFailed,
                    message: error instanceof Error ? error.message : '解析失败',
                });
            }
        }
        const dedupeConflicts = [];
        const deduped = (0, indexDedup_1.dedupeIndexBooks)(books, (conflict) => {
            dedupeConflicts.push(conflict);
        });
        (0, indexDedupeLogger_1.logIndexDedupeConflicts)('indexService.buildFromOutputPath', dedupeConflicts);
        const snapshot = {
            schemaVersion: storageService_1.CURRENT_INDEX_SCHEMA_VERSION,
            outputPath: validation.normalizedPath,
            builtAt: Date.now(),
            books: deduped.sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0)),
            errors,
        };
        const scanState = {
            lastScanAt: Date.now(),
            durationMs: Date.now() - scanStart,
            outputPath: validation.normalizedPath,
            scannedFiles: markdownFiles.length,
            changedFiles: markdownFiles.length,
            errorCount: errors.length,
        };
        return { snapshot, scanState };
    }
    toIndexEntry(book, stat, filePath) {
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
    toBook(entry) {
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
            readingStatus: models_1.ReadingStatus.NotStarted,
            totalReadDay: 0,
            readingTime: 0,
        };
    }
    resolveOutputPath(accountId) {
        const basePath = (0, utils_1.getConfiguredOutputPath)();
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
    resolveAccountId(accountId) {
        const normalized = String(accountId || '').trim();
        if (normalized) {
            return normalized;
        }
        return (0, auth_1.getCookieManager)().getActiveAccountId();
    }
}
exports.IndexService = IndexService;
let indexServiceInstance;
function getIndexService() {
    if (!indexServiceInstance) {
        indexServiceInstance = new IndexService();
    }
    return indexServiceInstance;
}
exports.getIndexService = getIndexService;
//# sourceMappingURL=indexService.js.map