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
exports.getBookFileCleanupService = exports.BookFileCleanupService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const utils_1 = require("../utils");
class BookFileCleanupService {
    constructor() {
        this.output = vscode.window.createOutputChannel('WeRead 书籍文件清理');
    }
    async cleanupDuplicateBookFilesForAccount(accountId, options = {}) {
        const dryRun = !!options.dryRun;
        const outputRoots = this.resolveOutputRootsForAccount(accountId);
        const outputPath = outputRoots[0];
        const timestampMs = Number(options.timestampMs || Date.now());
        const result = {
            accountId,
            outputPath,
            scannedRoots: outputRoots,
            scannedFiles: 0,
            duplicateGroups: 0,
            movedFiles: 0,
            normalizedRenames: 0,
            actions: [],
            skips: [],
            dryRun,
        };
        if (!outputPath) {
            return result;
        }
        const markdownFiles = await this.collectMarkdownFiles(outputRoots);
        result.scannedFiles = markdownFiles.length;
        const grouped = new Map();
        for (const item of markdownFiles) {
            const candidate = await this.readCandidate(item.filePath, item.sourceRoot);
            if (!candidate) {
                result.skips.push({ filePath: item.filePath, reason: 'missing_or_invalid_bookId' });
                continue;
            }
            const list = grouped.get(candidate.bookId) || [];
            list.push(candidate);
            grouped.set(candidate.bookId, list);
        }
        const trashDir = path.join(outputPath, '._weread_trash', `${timestampMs}`);
        const restorePlan = [];
        for (const [bookId, entries] of grouped.entries()) {
            const sorted = entries.sort((a, b) => this.compareCandidate(a, b));
            const kept = sorted[0];
            if (entries.length <= 1) {
                if (dryRun) {
                    if (this.needsCanonicalRename(kept)) {
                        result.normalizedRenames += 1;
                    }
                }
                else if (await this.renameKeptToCanonicalTitle(kept)) {
                    result.normalizedRenames += 1;
                }
                continue;
            }
            result.duplicateGroups += 1;
            const actionStartIndex = result.actions.length;
            for (const dropped of sorted.slice(1)) {
                const reason = this.resolveCleanupReason(kept, dropped);
                const action = {
                    bookId,
                    keptPath: kept.filePath,
                    droppedPath: dropped.filePath,
                    reason,
                };
                if (!dryRun) {
                    const trashPath = await this.moveToTrash(dropped.sourceRoot, dropped.filePath, trashDir);
                    action.trashPath = trashPath;
                    result.movedFiles += 1;
                    restorePlan.push({
                        from: trashPath,
                        to: dropped.filePath,
                        bookId,
                    });
                }
                result.actions.push(action);
            }
            if (dryRun) {
                if (this.needsCanonicalRename(kept)) {
                    result.normalizedRenames += 1;
                }
            }
            else {
                if (await this.renameKeptToCanonicalTitle(kept)) {
                    result.normalizedRenames += 1;
                }
                for (let idx = actionStartIndex; idx < result.actions.length; idx += 1) {
                    result.actions[idx].keptPath = kept.filePath;
                }
            }
        }
        if (!dryRun && result.actions.length > 0) {
            await this.ensureDirectory(trashDir);
            result.trashDir = trashDir;
            const manifestPath = path.join(trashDir, `cleanup-manifest-${timestampMs}.json`);
            const restorePlanPath = path.join(trashDir, `restore-plan-${timestampMs}.json`);
            const manifest = {
                accountId,
                outputPath,
                executedAt: timestampMs,
                scannedFiles: result.scannedFiles,
                duplicateGroups: result.duplicateGroups,
                movedFiles: result.movedFiles,
                normalizedRenames: result.normalizedRenames,
                actions: result.actions,
                skips: result.skips,
            };
            await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
            await fs.promises.writeFile(restorePlanPath, `${JSON.stringify(restorePlan, null, 2)}\n`, 'utf-8');
            result.manifestPath = manifestPath;
            result.restorePlanPath = restorePlanPath;
        }
        this.output.appendLine(`[${new Date(timestampMs).toISOString()}] cleanup account=${accountId || 'default'} scanned=${result.scannedFiles} groups=${result.duplicateGroups} moved=${result.movedFiles} renamed=${result.normalizedRenames} dryRun=${dryRun ? 1 : 0}`);
        return result;
    }
    async restoreFilesFromPlan(restorePlanPath) {
        const raw = await fs.promises.readFile(restorePlanPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const tasks = Array.isArray(parsed) ? parsed : [];
        const result = {
            restorePlanPath,
            restoredFiles: 0,
            skippedFiles: 0,
            skipped: [],
        };
        for (const item of tasks) {
            const from = String(item.from || '').trim();
            const to = String(item.to || '').trim();
            if (!from || !to) {
                result.skippedFiles += 1;
                result.skipped.push({ from, to, reason: 'invalid_restore_item' });
                continue;
            }
            try {
                await this.ensureDirectory(path.dirname(to));
                await fs.promises.rename(from, to);
                result.restoredFiles += 1;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'restore_failed';
                result.skippedFiles += 1;
                result.skipped.push({ from, to, reason: message });
            }
        }
        this.output.appendLine(`[${new Date().toISOString()}] restore plan=${restorePlanPath} restored=${result.restoredFiles} skipped=${result.skippedFiles}`);
        return result;
    }
    async findLatestRestorePlanPath(accountId) {
        const roots = this.resolveOutputRootsForAccount(accountId);
        if (roots.length === 0) {
            return undefined;
        }
        const restorePlans = [];
        for (const rootPath of roots) {
            const trashRoot = path.join(rootPath, '._weread_trash');
            let entries;
            try {
                entries = await fs.promises.readdir(trashRoot, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const dirEntry of entries) {
                if (!dirEntry.isDirectory()) {
                    continue;
                }
                const dirPath = path.join(trashRoot, dirEntry.name);
                let files;
                try {
                    files = await fs.promises.readdir(dirPath);
                }
                catch {
                    continue;
                }
                for (const fileName of files) {
                    if (!/^restore-plan-\d+\.json$/i.test(fileName)) {
                        continue;
                    }
                    const filePath = path.join(dirPath, fileName);
                    try {
                        const stat = await fs.promises.stat(filePath);
                        restorePlans.push({ filePath, mtimeMs: Number(stat.mtimeMs || 0) });
                    }
                    catch {
                        continue;
                    }
                }
            }
        }
        if (restorePlans.length === 0) {
            return undefined;
        }
        restorePlans.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return restorePlans[0].filePath;
    }
    resolveOutputRootsForAccount(accountId) {
        const baseOutputPath = (0, utils_1.getConfiguredOutputPath)();
        if (!baseOutputPath) {
            return [];
        }
        const roots = [];
        const normalizedBasePath = path.resolve(baseOutputPath);
        const normalizedAccountId = String(accountId || '').trim();
        if (normalizedAccountId) {
            const accountDir = path.join(normalizedBasePath, 'accounts', normalizedAccountId);
            if (fs.existsSync(accountDir)) {
                roots.push(path.resolve(accountDir));
            }
        }
        roots.push(normalizedBasePath);
        return Array.from(new Set(roots));
    }
    async collectMarkdownFiles(roots) {
        const seen = new Set();
        const result = [];
        const stack = roots.map((rootPath) => ({
            current: rootPath,
            sourceRoot: rootPath,
            skipAccountsDir: path.basename(rootPath) !== 'accounts',
        }));
        while (stack.length > 0) {
            const frame = stack.pop();
            if (!frame?.current) {
                continue;
            }
            let entries;
            try {
                entries = await fs.promises.readdir(frame.current, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                const fullPath = path.join(frame.current, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === '阅读洞察报告' || entry.name === '._weread_trash') {
                        continue;
                    }
                    if (frame.skipAccountsDir && entry.name === 'accounts') {
                        continue;
                    }
                    stack.push({
                        current: fullPath,
                        sourceRoot: frame.sourceRoot,
                        skipAccountsDir: frame.skipAccountsDir,
                    });
                    continue;
                }
                if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                    const resolvedPath = path.resolve(fullPath);
                    if (seen.has(resolvedPath)) {
                        continue;
                    }
                    seen.add(resolvedPath);
                    result.push({
                        filePath: resolvedPath,
                        sourceRoot: frame.sourceRoot,
                    });
                }
            }
        }
        return result;
    }
    async readCandidate(filePath, sourceRoot) {
        let fileMtimeMs = 0;
        try {
            const stat = await fs.promises.stat(filePath);
            fileMtimeMs = Number(stat.mtimeMs || 0);
        }
        catch {
            return undefined;
        }
        let content = '';
        try {
            content = await fs.promises.readFile(filePath, 'utf-8');
        }
        catch {
            return undefined;
        }
        const frontmatter = this.parseFrontmatter(content);
        const rawBookId = String(frontmatter.bookid
            || frontmatter.bookId
            || this.extractLooseField(content, 'bookid')
            || this.extractLooseField(content, 'bookId')
            || '').trim();
        const bookId = (0, utils_1.normalizeBookId)(rawBookId || '');
        if (!bookId) {
            return undefined;
        }
        const lastReadRaw = Number(frontmatter.lastReadTime || this.extractLooseField(content, 'lastReadTime') || 0);
        const lastReadTime = Number.isFinite(lastReadRaw) ? lastReadRaw : 0;
        const title = String(frontmatter.title || this.extractLooseField(content, 'title') || '').trim();
        return {
            bookId,
            filePath,
            sourceRoot,
            title,
            lastReadTime,
            fileMtimeMs,
        };
    }
    parseFrontmatter(content) {
        const normalizedContent = content.replace(/^\uFEFF/, '');
        if (!normalizedContent.startsWith('---')) {
            return {};
        }
        const match = normalizedContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match?.[1]) {
            return {};
        }
        const record = {};
        for (const line of match[1].split(/\r?\n/)) {
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
    extractLooseField(content, key) {
        const pattern = new RegExp(`^\\s*["']?${key}["']?\\s*:\\s*["']?([^"\\r\\n]+)["']?\\s*$`, 'im');
        const matched = content.replace(/^\uFEFF/, '').match(pattern);
        return matched?.[1]?.trim();
    }
    compareCandidate(a, b) {
        const aLastRead = Number(a.lastReadTime || 0);
        const bLastRead = Number(b.lastReadTime || 0);
        if (aLastRead !== bLastRead) {
            return bLastRead - aLastRead;
        }
        const aMtime = Number(a.fileMtimeMs || 0);
        const bMtime = Number(b.fileMtimeMs || 0);
        if (aMtime !== bMtime) {
            return bMtime - aMtime;
        }
        return a.filePath.localeCompare(b.filePath);
    }
    resolveCleanupReason(kept, dropped) {
        if (Number(kept.lastReadTime || 0) > Number(dropped.lastReadTime || 0)) {
            return 'newer_last_read';
        }
        if (Number(kept.lastReadTime || 0) === Number(dropped.lastReadTime || 0)
            && Number(kept.fileMtimeMs || 0) > Number(dropped.fileMtimeMs || 0)) {
            return 'newer_file_mtime';
        }
        return 'kept_existing';
    }
    async moveToTrash(outputPath, sourcePath, trashDir) {
        const relativePath = path.relative(outputPath, sourcePath);
        const safeRelativePath = relativePath.startsWith('..') ? path.basename(sourcePath) : relativePath;
        const preferredTrashPath = path.join(trashDir, safeRelativePath);
        const targetPath = await this.reserveUniquePath(preferredTrashPath);
        await this.ensureDirectory(path.dirname(targetPath));
        await fs.promises.rename(sourcePath, targetPath);
        return targetPath;
    }
    needsCanonicalRename(kept) {
        const title = kept.title.trim();
        if (!title) {
            return false;
        }
        const canonicalBaseName = this.sanitizeFileName(title);
        if (!canonicalBaseName) {
            return false;
        }
        const currentBaseName = path.basename(kept.filePath, path.extname(kept.filePath));
        return currentBaseName !== canonicalBaseName;
    }
    async renameKeptToCanonicalTitle(kept) {
        const title = kept.title.trim();
        if (!title) {
            return false;
        }
        const dirPath = path.dirname(kept.filePath);
        const canonicalBaseName = this.sanitizeFileName(title);
        if (!canonicalBaseName) {
            return false;
        }
        const targetPath = path.join(dirPath, `${canonicalBaseName}.md`);
        if (path.resolve(targetPath) === path.resolve(kept.filePath)) {
            return false;
        }
        const reservedTargetPath = await this.reserveUniquePath(targetPath);
        await fs.promises.rename(kept.filePath, reservedTargetPath);
        kept.filePath = reservedTargetPath;
        return true;
    }
    async reserveUniquePath(preferredPath) {
        const ext = path.extname(preferredPath);
        const dir = path.dirname(preferredPath);
        const baseName = path.basename(preferredPath, ext);
        let index = 0;
        while (true) {
            const candidate = index === 0
                ? path.join(dir, `${baseName}${ext}`)
                : path.join(dir, `${baseName}_${index}${ext}`);
            try {
                await fs.promises.access(candidate);
                index += 1;
            }
            catch {
                return candidate;
            }
        }
    }
    async ensureDirectory(dirPath) {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }
    sanitizeFileName(name) {
        return name.replace(/[\\/:*?"<>|]/g, '_').trim();
    }
}
exports.BookFileCleanupService = BookFileCleanupService;
let bookFileCleanupServiceInstance;
function getBookFileCleanupService() {
    if (!bookFileCleanupServiceInstance) {
        bookFileCleanupServiceInstance = new BookFileCleanupService();
    }
    return bookFileCleanupServiceInstance;
}
exports.getBookFileCleanupService = getBookFileCleanupService;
//# sourceMappingURL=bookFileCleanupService.js.map