"use strict";
/**
 * 导出服务
 * 将笔记导出为 Markdown 文件
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
exports.getExportService = exports.ExportService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const templateService_1 = require("./templateService");
const storageService_1 = require("./storageService");
const fileRepository_1 = require("./fileRepository");
const pathConflictResolver_1 = require("./pathConflictResolver");
const utils_1 = require("../utils");
const deprecation_1 = require("../utils/deprecation");
const auth_1 = require("../auth");
class ExportService {
    constructor() {
        this.pathConflictResolver = new pathConflictResolver_1.PathConflictResolver();
        this.conflictOutput = vscode.window.createOutputChannel('WeRead 路径冲突日志');
    }
    async exportInsightsReport(data, options) {
        try {
            const outputPath = await this.getOutputPath(options?.outputPath);
            if (!outputPath) {
                return {
                    success: false,
                    error: '未设置导出路径',
                };
            }
            const reportDir = path.join(outputPath, '阅读洞察报告');
            await this.ensureDirectory(reportDir);
            const fileName = options?.fileName || this.buildInsightsReportFileName();
            const filePath = path.join(reportDir, `${fileName}.md`);
            const content = this.buildInsightsReportMarkdown(data);
            await (0, fileRepository_1.getFileRepository)().atomicWrite(filePath, content);
            return {
                success: true,
                filePath,
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '导出阅读洞察报告失败',
            };
        }
    }
    /**
     * 导出单本书籍
     */
    async exportBook(book, options, accountId) {
        try {
            const outputPath = await this.getOutputPath(options?.outputPath, accountId);
            if (!outputPath) {
                return {
                    success: false,
                    error: '未设置导出路径',
                };
            }
            const templateService = (0, templateService_1.getTemplateService)();
            const fileName = options?.fileName || templateService.renderFileName(book);
            return await this.writeBookToFile(book, outputPath, fileName, undefined, accountId);
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '导出失败',
            };
        }
    }
    /**
     * 批量导出书籍
     */
    async exportBooks(books, options, accountId) {
        const results = [];
        for (const book of books) {
            const result = await this.exportBook(book, options, accountId);
            results.push(result);
        }
        return results;
    }
    /**
     * 导出所有书籍
     */
    async exportAllBooks(options, accountId) {
        const storageService = (0, storageService_1.getStorageService)();
        const books = storageService.getBooks(accountId);
        return this.exportBooks(books, options, accountId);
    }
    /**
     * 同步阶段写入笔记文件：不弹出路径选择，仅使用 weread.outputPath。
     */
    async exportBookForSync(book, accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('exportService.exportBookForSync()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        try {
            const outputPath = this.getOutputPathForSync(accountId);
            if (!outputPath) {
                return {
                    success: false,
                    error: '未设置笔记保存路径（weread.outputPath）',
                };
            }
            const templateService = (0, templateService_1.getTemplateService)();
            const fileName = templateService.renderFileName(book);
            return await this.writeBookToFile(book, outputPath, fileName, undefined, accountId, true);
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '同步写入笔记文件失败',
            };
        }
    }
    async exportBookForSyncWithNotes(book, notes, accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('exportService.exportBookForSyncWithNotes()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        try {
            const outputPath = this.getOutputPathForSync(accountId);
            if (!outputPath) {
                return {
                    success: false,
                    error: '未设置笔记保存路径（weread.outputPath）',
                };
            }
            const templateService = (0, templateService_1.getTemplateService)();
            const fileName = templateService.renderFileName(book);
            return await this.writeBookToFile(book, outputPath, fileName, notes, accountId, true);
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '同步写入笔记文件失败',
            };
        }
    }
    /**
     * 获取书籍对应的笔记文件路径（若文件不存在会先生成）。
     */
    async ensureAndGetBookNoteFilePath(book, accountId) {
        const existed = await this.findBookNoteFilePath(book, accountId);
        if (existed) {
            return existed;
        }
        const result = await this.exportBookForSync(book, accountId);
        return result.success ? result.filePath : undefined;
    }
    async findBookNoteFilePath(book, accountId) {
        const outputPath = this.getOutputPathForSync(accountId);
        if (!outputPath) {
            return undefined;
        }
        const normalizedOutputPath = path.resolve(outputPath);
        if (book.localFilePath) {
            const normalizedLocalPath = path.resolve(book.localFilePath);
            if ((0, utils_1.isPathWithinBase)(normalizedLocalPath, normalizedOutputPath)
                && !this.isTrashPath(normalizedLocalPath)
                && (await this.fileExists(normalizedLocalPath))) {
                await this.persistBookLocalFilePath(book.bookId, normalizedLocalPath);
                return normalizedLocalPath;
            }
        }
        const templateService = (0, templateService_1.getTemplateService)();
        const fileName = templateService.renderFileName(book);
        const expectedPath = path.join(normalizedOutputPath, this.resolveCategoryFolder(book), `${fileName}.md`);
        if (!this.isTrashPath(expectedPath) && (await this.fileExists(expectedPath))) {
            await this.persistBookLocalFilePath(book.bookId, expectedPath);
            return expectedPath;
        }
        const migrated = await this.findBookFileInOutputPathByBookId(normalizedOutputPath, book);
        if (migrated && !this.isTrashPath(migrated)) {
            await this.persistBookLocalFilePath(book.bookId, migrated);
            return migrated;
        }
        return undefined;
    }
    /**
     * 获取导出路径
     */
    async getOutputPath(customPath, accountId) {
        if (customPath) {
            return (0, utils_1.normalizeOutputPath)(customPath);
        }
        const configuredPath = (0, utils_1.getConfiguredOutputPath)();
        if (configuredPath) {
            return this.resolveAccountOutputPath(configuredPath, accountId);
        }
        const config = vscode.workspace.getConfiguration('weread');
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择导出目录',
        });
        if (result && result.length > 0) {
            const selectedPath = (0, utils_1.normalizeOutputPath)(result[0].fsPath);
            // 保存到配置
            await config.update('outputPath', selectedPath, true);
            return this.resolveAccountOutputPath(selectedPath, accountId);
        }
        return undefined;
    }
    getOutputPathForSync(accountId) {
        const configured = (0, utils_1.getConfiguredOutputPath)();
        if (!configured) {
            return undefined;
        }
        return this.resolveAccountOutputPath(configured, accountId);
    }
    /**
     * 确保目录存在
     */
    async ensureDirectory(dirPath) {
        try {
            await fs.promises.access(dirPath);
        }
        catch {
            await fs.promises.mkdir(dirPath, { recursive: true });
        }
    }
    async writeBookToFile(book, outputPath, fileName, explicitNotes, accountId, preferCanonicalForBookId = false) {
        const storageService = (0, storageService_1.getStorageService)();
        const notes = explicitNotes || storageService.getNotes(book.bookId, accountId);
        const templateService = (0, templateService_1.getTemplateService)();
        const content = templateService.render(book, notes);
        const categoryFolder = this.resolveCategoryFolder(book);
        const targetDir = path.join(outputPath, categoryFolder);
        await this.ensureDirectory(targetDir);
        const desiredPath = path.join(targetDir, `${fileName}.md`);
        let filePath = desiredPath;
        if (preferCanonicalForBookId) {
            const existingFileByBookId = await this.findBookFileInOutputPathByBookId(path.resolve(outputPath), book);
            if (existingFileByBookId) {
                filePath = existingFileByBookId;
            }
            else if (await this.fileExists(desiredPath)) {
                const existingAtDesired = await this.readFrontmatterBookId(desiredPath);
                const candidateIds = this.buildBookIdCandidates(book);
                if (existingAtDesired && !candidateIds.has(existingAtDesired)) {
                    filePath = await this.pathConflictResolver.reserveUniquePath(desiredPath, (candidate) => this.fileExists(candidate), (fromPath, toPath, index) => {
                        const detail = `[${new Date().toISOString()}] [path.conflict] category=${categoryFolder} bookId=${book.bookId} from=${fromPath} to=${toPath} index=${index}`;
                        this.conflictOutput.appendLine(detail);
                    });
                }
            }
        }
        else {
            filePath = await this.pathConflictResolver.reserveUniquePath(desiredPath, (candidate) => this.fileExists(candidate), (fromPath, toPath, index) => {
                const detail = `[${new Date().toISOString()}] [path.conflict] category=${categoryFolder} bookId=${book.bookId} from=${fromPath} to=${toPath} index=${index}`;
                this.conflictOutput.appendLine(detail);
            });
        }
        try {
            await (0, fileRepository_1.getFileRepository)().atomicWrite(filePath, content);
        }
        finally {
            if (!preferCanonicalForBookId || filePath !== desiredPath) {
                this.pathConflictResolver.release(filePath);
            }
        }
        return {
            success: true,
            filePath,
        };
    }
    /**
     * 打开导出的文件
     */
    async openExportedFile(filePath) {
        const fileUri = vscode.Uri.file(filePath);
        try {
            await vscode.commands.executeCommand('vscode.open', fileUri, {
                preview: false,
            });
            return;
        }
        catch {
            // 继续尝试其他方式，避免单一路径打开失败。
        }
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document, { preview: false });
            return;
        }
        catch {
            // 某些 macOS 场景下 VS Code 文件系统提供器会抛 NoPermissions，这里降级为直接读取文件内容打开临时文档。
        }
        try {
            const binary = await vscode.workspace.fs.readFile(fileUri);
            const content = new TextDecoder('utf-8').decode(binary);
            const document = await vscode.workspace.openTextDocument({
                content,
                language: 'markdown',
            });
            await vscode.window.showTextDocument(document, { preview: false });
            vscode.window.showWarningMessage('当前文件以临时只读方式打开，请检查 VS Code 对目标目录的系统权限设置。');
            return;
        }
        catch {
            // 尝试 Node fs 兜底
        }
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const document = await vscode.workspace.openTextDocument({
                content,
                language: 'markdown',
            });
            await vscode.window.showTextDocument(document, { preview: false });
            vscode.window.showWarningMessage('当前文件以临时只读方式打开，请检查 VS Code 对目标目录的系统权限设置。');
            return;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            throw new Error(`无法在编辑器中打开文件（${message}）：${filePath}`);
        }
    }
    async fileExists(filePath) {
        try {
            const stat = await fs.promises.stat(filePath);
            return stat.isFile();
        }
        catch {
            return false;
        }
    }
    async selectOutputPath() {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择笔记保存位置',
        });
        if (!result || result.length === 0) {
            return undefined;
        }
        const selectedPath = (0, utils_1.normalizeOutputPath)(result[0].fsPath);
        const config = vscode.workspace.getConfiguration('weread');
        await config.update('outputPath', selectedPath, true);
        return selectedPath;
    }
    async findBookFileInOutputPathByBookId(outputPath, book) {
        const markdownFiles = await this.collectMarkdownFiles(outputPath);
        const candidateIds = this.buildBookIdCandidates(book);
        for (const filePath of markdownFiles) {
            const parsedBookId = await this.readFrontmatterBookId(filePath);
            if (!parsedBookId || !candidateIds.has(parsedBookId)) {
                continue;
            }
            return filePath;
        }
        return undefined;
    }
    buildBookIdCandidates(book) {
        const rawCandidates = [
            book.bookId,
            book.rawBookId,
            book.bookId.startsWith('article:') ? book.bookId.slice('article:'.length) : undefined,
            book.rawBookId?.startsWith('article:') ? book.rawBookId.slice('article:'.length) : undefined,
        ].filter((value) => !!value && !!value.trim());
        const normalized = rawCandidates.map((value) => (0, utils_1.normalizeBookId)(value));
        return new Set([...rawCandidates, ...normalized].filter(Boolean));
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
                    if (entry.name === '阅读洞察报告' || entry.name === '._weread_trash') {
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
    isTrashPath(filePath) {
        const marker = `${path.sep}._weread_trash${path.sep}`;
        return filePath.includes(marker);
    }
    async readFrontmatterBookId(filePath) {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            if (!content.startsWith('---')) {
                return undefined;
            }
            const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!frontmatterMatch?.[1]) {
                return undefined;
            }
            const lines = frontmatterMatch[1].split(/\r?\n/);
            for (const line of lines) {
                const splitIndex = line.indexOf(':');
                if (splitIndex <= 0) {
                    continue;
                }
                const key = line.slice(0, splitIndex).trim();
                if (key !== 'bookid' && key !== 'bookId') {
                    continue;
                }
                const value = line.slice(splitIndex + 1).trim();
                if (!value) {
                    return undefined;
                }
                const normalized = (0, utils_1.normalizeBookId)(value);
                return normalized || value;
            }
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    resolveCategoryFolder(book) {
        const category = (book.category || '').trim() || (book.bookId.startsWith('article:') ? '公众号' : '未分类');
        return this.sanitizePathSegment(category);
    }
    sanitizePathSegment(segment) {
        return segment.replace(/[\\/:*?"<>|]/g, '_').trim() || '未分类';
    }
    buildInsightsReportFileName() {
        const date = new Date();
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        const hours = `${date.getHours()}`.padStart(2, '0');
        const minutes = `${date.getMinutes()}`.padStart(2, '0');
        return `阅读洞察月报-${year}${month}${day}-${hours}${minutes}`;
    }
    resolveAccountOutputPath(outputPath, accountId) {
        const normalized = String(accountId || '').trim();
        return normalized ? path.join(outputPath, 'accounts', normalized) : outputPath;
    }
    async persistBookLocalFilePath(bookId, filePath) {
        void bookId;
        void filePath;
    }
    buildInsightsReportMarkdown(data) {
        const lines = [];
        lines.push('# 阅读洞察月报');
        lines.push('');
        lines.push(`- 生成时间: ${new Date().toLocaleString()}`);
        lines.push(`- 时间范围: ${data.filter.days === 0 ? '全部数据' : `最近 ${data.filter.days} 天`}`);
        lines.push(`- 分类筛选: ${data.filter.category && data.filter.category !== 'all' ? data.filter.category : '全部分类'}`);
        lines.push(`- 完读筛选: ${data.filter.finishedOnly ? '仅完读' : '全部书籍'}`);
        lines.push(`- 笔记类型: ${this.getNoteTypeLabel(data.filter.noteType)}`);
        lines.push('');
        lines.push('## 核心指标');
        lines.push('');
        lines.push(`- 活跃天数: ${data.kpis.activeDays}`);
        lines.push(`- 最长连续天数: ${data.kpis.longestStreakDays}`);
        lines.push(`- 笔记总数: ${data.kpis.totalNotes}`);
        lines.push(`- 笔记密度(每100页): ${data.kpis.noteDensityPer100Pages}`);
        lines.push(`- 深度笔记占比: ${data.kpis.deepNoteRatio}%`);
        lines.push(`- 平均完成率: ${data.kpis.averageCompletionRate}%`);
        lines.push(`- 平均每本笔记数: ${data.kpis.averageNotesPerBook}`);
        lines.push('');
        lines.push('## 高价值书籍 Top10');
        lines.push('');
        if (data.topBooks.length === 0) {
            lines.push('暂无数据');
            lines.push('');
        }
        else {
            lines.push('| 书籍 | 作者 | 笔记数 | 完成率 | 深度占比 | 价值分 |');
            lines.push('|---|---|---:|---:|---:|---:|');
            for (const item of data.topBooks) {
                lines.push(`| ${item.title} | ${item.author || '-'} | ${item.notesCount} | ${item.completionRate}% | ${item.deepNoteRatio}% | ${item.valueScore} |`);
            }
            lines.push('');
        }
        lines.push('## 最近笔记时间线');
        lines.push('');
        if (data.timeline.length === 0) {
            lines.push('暂无数据');
            lines.push('');
        }
        else {
            for (const item of data.timeline.slice(0, 20)) {
                const text = [item.highlightText, item.thoughtText].filter(Boolean).join(' / ');
                lines.push(`- ${new Date(item.createdAt).toLocaleString()} · 《${item.bookTitle}》 · ${item.noteType} · ${item.chapterTitle}`);
                lines.push(`  - ${text || '（无文本内容）'}`);
            }
            lines.push('');
        }
        return lines.join('\n');
    }
    getNoteTypeLabel(noteType) {
        if (noteType === 'highlight') {
            return '仅划线';
        }
        if (noteType === 'thought') {
            return '仅想法';
        }
        if (noteType === 'chapter') {
            return '仅章节笔记';
        }
        if (noteType === 'review') {
            return '仅书评';
        }
        return '全部笔记类型';
    }
}
exports.ExportService = ExportService;
let exportServiceInstance;
function getExportService() {
    if (!exportServiceInstance) {
        exportServiceInstance = new ExportService();
    }
    return exportServiceInstance;
}
exports.getExportService = getExportService;
//# sourceMappingURL=exportService.js.map