/**
 * 导出服务
 * 将笔记导出为 Markdown 文件
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Book, Note } from '../models';
import { getTemplateService } from './templateService';
import { getStorageService } from './storageService';
import { InsightsDashboardData } from './analyticsService';
import { getFileRepository } from './fileRepository';
import { PathConflictResolver } from './pathConflictResolver';
import { getConfiguredOutputPath, isPathWithinBase, normalizeBookId, normalizeOutputPath } from '../utils';
import { AccountId } from '../types/account';
import { warnDeprecatedNoAccountParam } from '../utils/deprecation';
import { getCookieManager } from '../auth';

export interface ExportOptions {
  outputPath?: string;
  fileName?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export class ExportService {
  private readonly pathConflictResolver = new PathConflictResolver();
  private readonly conflictOutput = vscode.window.createOutputChannel('WeRead 路径冲突日志');

  async exportInsightsReport(data: InsightsDashboardData, options?: ExportOptions): Promise<ExportResult> {
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
      await getFileRepository().atomicWrite(filePath, content);

      return {
        success: true,
        filePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导出阅读洞察报告失败',
      };
    }
  }

  /**
   * 导出单本书籍
   */
  async exportBook(book: Book, options?: ExportOptions, accountId?: AccountId): Promise<ExportResult> {
    try {
      const outputPath = await this.getOutputPath(options?.outputPath, accountId);
      if (!outputPath) {
        return {
          success: false,
          error: '未设置导出路径',
        };
      }

      const templateService = getTemplateService();
      const fileName = options?.fileName || templateService.renderFileName(book);
      return await this.writeBookToFile(book, outputPath, fileName, undefined, accountId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导出失败',
      };
    }
  }

  /**
   * 批量导出书籍
   */
  async exportBooks(books: Book[], options?: ExportOptions, accountId?: AccountId): Promise<ExportResult[]> {
    const results: ExportResult[] = [];

    for (const book of books) {
      const result = await this.exportBook(book, options, accountId);
      results.push(result);
    }

    return results;
  }

  /**
   * 导出所有书籍
   */
  async exportAllBooks(options?: ExportOptions, accountId?: AccountId): Promise<ExportResult[]> {
    const storageService = getStorageService();
    const books = storageService.getBooks(accountId);
    return this.exportBooks(books, options, accountId);
  }

  /**
   * 同步阶段写入笔记文件：不弹出路径选择，仅使用 weread.outputPath。
   */
  async exportBookForSync(book: Book, accountId?: AccountId): Promise<ExportResult> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('exportService.exportBookForSync()', getCookieManager().getActiveAccountId());
    }
    try {
      const outputPath = this.getOutputPathForSync(accountId);
      if (!outputPath) {
        return {
          success: false,
          error: '未设置笔记保存路径（weread.outputPath）',
        };
      }
      const templateService = getTemplateService();
      const fileName = templateService.renderFileName(book);
      return await this.writeBookToFile(book, outputPath, fileName, undefined, accountId, true);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '同步写入笔记文件失败',
      };
    }
  }

  async exportBookForSyncWithNotes(book: Book, notes: Note[], accountId?: AccountId): Promise<ExportResult> {
    if (!accountId) {
      warnDeprecatedNoAccountParam('exportService.exportBookForSyncWithNotes()', getCookieManager().getActiveAccountId());
    }
    try {
      const outputPath = this.getOutputPathForSync(accountId);
      if (!outputPath) {
        return {
          success: false,
          error: '未设置笔记保存路径（weread.outputPath）',
        };
      }
      const templateService = getTemplateService();
      const fileName = templateService.renderFileName(book);
      return await this.writeBookToFile(book, outputPath, fileName, notes, accountId, true);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '同步写入笔记文件失败',
      };
    }
  }

  /**
   * 获取书籍对应的笔记文件路径（若文件不存在会先生成）。
   */
  async ensureAndGetBookNoteFilePath(book: Book, accountId?: AccountId): Promise<string | undefined> {
    const existed = await this.findBookNoteFilePath(book, accountId);
    if (existed) {
      return existed;
    }
    const result = await this.exportBookForSync(book, accountId);
    return result.success ? result.filePath : undefined;
  }

  async findBookNoteFilePath(book: Book, accountId?: AccountId): Promise<string | undefined> {
    const outputPath = this.getOutputPathForSync(accountId);
    if (!outputPath) {
      return undefined;
    }
    const normalizedOutputPath = path.resolve(outputPath);

    if (book.localFilePath) {
      const normalizedLocalPath = path.resolve(book.localFilePath);
      if (
        isPathWithinBase(normalizedLocalPath, normalizedOutputPath)
        && !this.isTrashPath(normalizedLocalPath)
        && (await this.fileExists(normalizedLocalPath))
      ) {
        await this.persistBookLocalFilePath(book.bookId, normalizedLocalPath);
        return normalizedLocalPath;
      }
    }

    const templateService = getTemplateService();
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
  private async getOutputPath(customPath?: string, accountId?: AccountId): Promise<string | undefined> {
    if (customPath) {
      return normalizeOutputPath(customPath);
    }

    const configuredPath = getConfiguredOutputPath();
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
      const selectedPath = normalizeOutputPath(result[0].fsPath);
      // 保存到配置
      await config.update('outputPath', selectedPath, true);
      return this.resolveAccountOutputPath(selectedPath, accountId);
    }

    return undefined;
  }

  private getOutputPathForSync(accountId?: AccountId): string | undefined {
    const configured = getConfiguredOutputPath();
    if (!configured) {
      return undefined;
    }
    return this.resolveAccountOutputPath(configured, accountId);
  }

  /**
   * 确保目录存在
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath);
    } catch {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }

  private async writeBookToFile(
    book: Book,
    outputPath: string,
    fileName: string,
    explicitNotes?: Note[],
    accountId?: AccountId,
    preferCanonicalForBookId = false
  ): Promise<ExportResult> {
    const storageService = getStorageService();
    const notes = explicitNotes || storageService.getNotes(book.bookId, accountId);
    const templateService = getTemplateService();
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
      } else if (await this.fileExists(desiredPath)) {
        const existingAtDesired = await this.readFrontmatterBookId(desiredPath);
        const candidateIds = this.buildBookIdCandidates(book);
        if (existingAtDesired && !candidateIds.has(existingAtDesired)) {
          filePath = await this.pathConflictResolver.reserveUniquePath(
            desiredPath,
            (candidate) => this.fileExists(candidate),
            (fromPath, toPath, index) => {
              const detail = `[${new Date().toISOString()}] [path.conflict] category=${categoryFolder} bookId=${book.bookId} from=${fromPath} to=${toPath} index=${index}`;
              this.conflictOutput.appendLine(detail);
            }
          );
        }
      }
    } else {
      filePath = await this.pathConflictResolver.reserveUniquePath(
        desiredPath,
        (candidate) => this.fileExists(candidate),
        (fromPath, toPath, index) => {
          const detail = `[${new Date().toISOString()}] [path.conflict] category=${categoryFolder} bookId=${book.bookId} from=${fromPath} to=${toPath} index=${index}`;
          this.conflictOutput.appendLine(detail);
        }
      );
    }
    try {
      await getFileRepository().atomicWrite(filePath, content);
    } finally {
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
  async openExportedFile(filePath: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath);
    try {
      await vscode.commands.executeCommand('vscode.open', fileUri, {
        preview: false,
      });
      return;
    } catch {
      // 继续尝试其他方式，避免单一路径打开失败。
    }

    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, { preview: false });
      return;
    } catch {
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
    } catch {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      throw new Error(`无法在编辑器中打开文件（${message}）：${filePath}`);
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async selectOutputPath(): Promise<string | undefined> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '选择笔记保存位置',
    });

    if (!result || result.length === 0) {
      return undefined;
    }

    const selectedPath = normalizeOutputPath(result[0].fsPath);
    const config = vscode.workspace.getConfiguration('weread');
    await config.update('outputPath', selectedPath, true);
    return selectedPath;
  }

  private async findBookFileInOutputPathByBookId(outputPath: string, book: Book): Promise<string | undefined> {
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

  private buildBookIdCandidates(book: Book): Set<string> {
    const rawCandidates = [
      book.bookId,
      book.rawBookId,
      book.bookId.startsWith('article:') ? book.bookId.slice('article:'.length) : undefined,
      book.rawBookId?.startsWith('article:') ? book.rawBookId.slice('article:'.length) : undefined,
    ].filter((value): value is string => !!value && !!value.trim());

    const normalized = rawCandidates.map((value) => normalizeBookId(value));
    return new Set([...rawCandidates, ...normalized].filter(Boolean));
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

  private isTrashPath(filePath: string): boolean {
    const marker = `${path.sep}._weread_trash${path.sep}`;
    return filePath.includes(marker);
  }

  private async readFrontmatterBookId(filePath: string): Promise<string | undefined> {
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
        const normalized = normalizeBookId(value);
        return normalized || value;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private resolveCategoryFolder(book: Book): string {
    const category = (book.category || '').trim() || (book.bookId.startsWith('article:') ? '公众号' : '未分类');
    return this.sanitizePathSegment(category);
  }

  private sanitizePathSegment(segment: string): string {
    return segment.replace(/[\\/:*?"<>|]/g, '_').trim() || '未分类';
  }

  private buildInsightsReportFileName(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `阅读洞察月报-${year}${month}${day}-${hours}${minutes}`;
  }

  private resolveAccountOutputPath(outputPath: string, accountId?: AccountId): string {
    const normalized = String(accountId || '').trim();
    return normalized ? path.join(outputPath, 'accounts', normalized) : outputPath;
  }

  private async persistBookLocalFilePath(bookId: string, filePath: string): Promise<void> {
    void bookId;
    void filePath;
  }

  private buildInsightsReportMarkdown(data: InsightsDashboardData): string {
    const lines: string[] = [];
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
    } else {
      lines.push('| 书籍 | 作者 | 笔记数 | 完成率 | 深度占比 | 价值分 |');
      lines.push('|---|---|---:|---:|---:|---:|');
      for (const item of data.topBooks) {
        lines.push(
          `| ${item.title} | ${item.author || '-'} | ${item.notesCount} | ${item.completionRate}% | ${item.deepNoteRatio}% | ${item.valueScore} |`
        );
      }
      lines.push('');
    }
    lines.push('## 最近笔记时间线');
    lines.push('');
    if (data.timeline.length === 0) {
      lines.push('暂无数据');
      lines.push('');
    } else {
      for (const item of data.timeline.slice(0, 20)) {
        const text = [item.highlightText, item.thoughtText].filter(Boolean).join(' / ');
        lines.push(
          `- ${new Date(item.createdAt).toLocaleString()} · 《${item.bookTitle}》 · ${item.noteType} · ${item.chapterTitle}`
        );
        lines.push(`  - ${text || '（无文本内容）'}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private getNoteTypeLabel(noteType?: string): string {
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

let exportServiceInstance: ExportService | undefined;

export function getExportService(): ExportService {
  if (!exportServiceInstance) {
    exportServiceInstance = new ExportService();
  }
  return exportServiceInstance;
}
