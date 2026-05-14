/**
 * 模板服务
 * 使用内置轻量模板渲染
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Book, Note, BookReview } from '../models';

export interface TemplateData {
  frontmatter: string;
  bookInfoMarkdown: string;
  title: string;
  author: string;
  cover: string;
  docType?: string;
  bookid?: string;
  isbn?: string;
  publisher?: string;
  publishTime?: string;
  category?: string;
  progress: number;
  noteCount?: number;
  reviewCount?: number;
  readingStatus?: string;
  totalReadDay?: number;
  readingTime?: number;
  readingDate?: string;
  lastReadTime?: string;
  intro?: string;
  pcUrl?: string;
  chapters: ChapterTemplateData[];
  bookReview?: string;
  chaptersMarkdown: string;
  bookReviewMarkdown: string;
}

export interface ChapterTemplateData {
  title: string;
  notes: NoteTemplateData[];
}

export interface NoteTemplateData {
  emoji: string;
  highlightText?: string;
  thoughtText?: string;
  createTime?: string;
  chapterTitle?: string;
}

export class TemplateService {
  private defaultTemplate: string;

  constructor() {
    // 加载默认模板
    this.defaultTemplate = this.loadDefaultTemplate();
  }

  /**
   * 加载默认模板
   */
  private loadDefaultTemplate(): string {
    const templatePath = path.join(__dirname, '..', 'templates', 'default.md');
    try {
      return fs.readFileSync(templatePath, 'utf-8');
    } catch {
      // 如果文件不存在，返回内置默认模板
      return this.getBuiltInTemplate();
    }
  }

  /**
   * 获取内置默认模板
   */
  private getBuiltInTemplate(): string {
    return `{{frontmatter}}

# {{title}}

## 书籍信息
{{bookInfoMarkdown}}

## 读书笔记

{{chaptersMarkdown}}

{{bookReviewMarkdown}}
`;
  }

  /**
   * 获取用户自定义模板
   */
  private getCustomTemplate(): string | undefined {
    const config = vscode.workspace.getConfiguration('weread');
    const customTemplate = config.get<string>('noteTemplate');
    return customTemplate?.trim() || undefined;
  }

  /**
   * 获取当前使用的模板
   */
  getTemplate(): string {
    return this.getCustomTemplate() || this.defaultTemplate;
  }

  /**
   * 渲染模板
   */
  render(book: Book, notes: Note[], review?: BookReview): string {
    const template = this.getTemplate();
    const data = this.buildTemplateData(book, notes, review);

    try {
      return this.renderTemplateString(template, data as unknown as Record<string, unknown>);
    } catch (error) {
      console.error('Template render error:', error);
      // 渲染失败时返回简单格式
      return this.renderSimple(book, notes, review);
    }
  }

  /**
   * 验证模板语法
   */
  validateTemplate(template: string): { valid: boolean; error?: string } {
    if (!template || !template.trim()) {
      return { valid: false, error: '模板不能为空' };
    }

    try {
      const mock = this.buildTemplateData(
        {
          bookId: 'mock',
          title: '示例书名',
          author: '示例作者',
          cover: '',
          progress: 0,
          readingStatus: 0 as any,
          highlightCount: 0,
          noteCount: 0,
        } as Book,
        [],
        undefined
      );
      this.renderTemplateString(template, mock as unknown as Record<string, unknown>);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : '模板语法错误',
      };
    }
  }

  /**
   * 构建模板数据
   */
  private buildTemplateData(book: Book, notes: Note[], review?: BookReview): TemplateData {
    // 按章节分组笔记
    const chapterMap = new Map<string, Note[]>();

    for (const note of notes) {
      const chapterTitle = note.chapterTitle || '未分类';
      if (!chapterMap.has(chapterTitle)) {
        chapterMap.set(chapterTitle, []);
      }
      chapterMap.get(chapterTitle)!.push(note);
    }

    // 构建章节数据
    const chapters: ChapterTemplateData[] = [];
    for (const [title, chapterNotes] of chapterMap) {
      chapters.push({
        title,
        notes: chapterNotes.map((n) => ({
          emoji: this.getNoteEmoji(n),
          highlightText: n.highlightText,
          thoughtText: n.thoughtText,
          createTime: n.createTime ? new Date(n.createTime * 1000).toLocaleString() : undefined,
          chapterTitle: n.chapterTitle,
        })),
      });
    }

    const frontmatter = this.buildFrontmatter(book);
    const bookInfoMarkdown = this.buildBookInfoMarkdown(book);
    const chaptersMarkdown = this.buildChaptersMarkdown(chapters);
    const bookReviewMarkdown = review?.content ? `## 书评\n\n${review.content}` : '';

    return {
      frontmatter,
      bookInfoMarkdown,
      title: book.title,
      author: book.author,
      cover: book.cover,
      docType: book.docType,
      bookid: book.rawBookId || book.bookId,
      isbn: book.isbn,
      publisher: book.publisher,
      publishTime: book.publishTime,
      category: book.category,
      progress: book.progress,
      noteCount: book.noteCount,
      reviewCount: book.reviewCount,
      readingStatus: this.formatReadingStatus(book.readingStatus),
      totalReadDay: book.totalReadDay,
      readingTime: book.readingTime,
      readingDate: book.readingDate,
      lastReadTime: book.lastReadTime
        ? new Date(book.lastReadTime * 1000).toLocaleString()
        : undefined,
      intro: book.intro,
      pcUrl: book.pcUrl,
      chapters,
      chaptersMarkdown,
      bookReview: review?.content,
      bookReviewMarkdown,
    };
  }

  /**
   * 简单格式渲染（备用）
   */
  private renderSimple(book: Book, notes: Note[], review?: BookReview): string {
    const lines = [
      `# ${book.title}`,
      '',
      ...this.buildBookInfoLines(book),
      '',
      `**作者**: ${book.author}`,
      `**进度**: ${book.progress}%`,
      '',
      '## 笔记',
      '',
    ];

    for (const note of notes) {
      if (note.highlightText) {
        lines.push(`> ${note.highlightText}`);
        lines.push('');
      }
      if (note.thoughtText) {
        lines.push(`💭 ${note.thoughtText}`);
        lines.push('');
      }
    }

    if (review?.content) {
      lines.push('## 书评');
      lines.push('');
      lines.push(review.content);
    }

    return lines.join('\n');
  }

  /**
   * 格式化日期
   */
  private formatDate(date: Date, format: string): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes);
  }

  /**
   * 渲染文件名
   */
  renderFileName(book: Book): string {
    const config = vscode.workspace.getConfiguration('weread');
    const template = config.get<string>('fileNameTemplate', '{{title}}');

    const data = {
      title: book.title,
      author: book.author,
      isbn: book.isbn || '',
      category: book.category || '',
    };

    try {
      const fileName = this.renderTemplateString(template, data);
      // 清理非法字符
      return this.sanitizeFileName(fileName);
    } catch {
      return this.sanitizeFileName(book.title);
    }
  }

  /**
   * 清理文件名中的非法字符
   */
  private sanitizeFileName(fileName: string): string {
    // 替换 Windows 和 macOS/Linux 中的非法字符
    return fileName
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
      .substring(0, 200); // 限制长度
  }

  private renderTemplateString(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
      const value = this.getValueByPath(data, key);
      if (value === undefined || value === null) {
        return '';
      }
      return String(value);
    });
  }

  private getValueByPath(data: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      return (current as Record<string, unknown>)[part];
    }, data);
  }

  private buildChaptersMarkdown(chapters: ChapterTemplateData[]): string {
    if (chapters.length === 0) {
      return '暂无笔记';
    }

    const lines: string[] = [];
    for (const chapter of chapters) {
      lines.push(`### ${chapter.title}`);
      lines.push('');

      for (const note of chapter.notes) {
        if (note.highlightText) {
          lines.push(`${note.emoji} 划线`);
          lines.push(`> ${note.highlightText}`);
          lines.push('');
        }
        if (note.thoughtText) {
          lines.push(`💬 评论：${note.thoughtText}`);
          lines.push('');
        }
        if (note.createTime) {
          lines.push(`_记录时间：${note.createTime}_`);
          lines.push('');
        }
      }
    }

    return lines.join('\n').trim();
  }

  private buildFrontmatter(book: Book): string {
    const meta: Array<[string, string | number | undefined]> = [
      ['title', book.title],
      ['author', book.author],
      ['doc_type', book.docType],
      ['bookid', book.rawBookId || book.bookId],
      ['isbn', book.isbn],
      ['category', book.category],
      ['publisher', book.publisher],
      ['cover', book.cover],
      ['progress', `${book.progress}%`],
      ['noteCount', book.noteCount],
      ['reviewCount', book.reviewCount],
      ['readingStatus', this.formatReadingStatus(book.readingStatus)],
      ['totalReadDay', book.totalReadDay],
      ['readingTime', book.readingTime],
      ['readingDate', book.readingDate],
      ['lastReadTime', book.lastReadTime ? new Date(book.lastReadTime * 1000).toLocaleString() : undefined],
      ['pcUrl', book.pcUrl],
    ];

    const lines = meta
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([key, value]) => `${key}: ${String(value).replace(/\n/g, ' ')}`);

    return lines.length > 0 ? `---\n${lines.join('\n')}\n---` : '';
  }

  private buildBookInfoMarkdown(book: Book): string {
    const lines = this.buildBookInfoLines(book);
    return lines.length > 0 ? lines.join('\n') : '暂无可展示的书籍信息';
  }

  private buildBookInfoLines(book: Book): string[] {
    const rawLines: Array<[string, string | number | undefined]> = [
      ['**作者**', book.author],
      ['**doc_type**', book.docType],
      ['**bookid**', book.rawBookId || book.bookId],
      ['**分类**', book.category],
      ['**出版社**', book.publisher],
      ['**ISBN**', book.isbn],
      ['**出版时间**', book.publishTime],
      ['**阅读进度**', `${book.progress}%`],
      ['**noteCount**', book.noteCount],
      ['**reviewCount**', book.reviewCount],
      ['**readingStatus**', this.formatReadingStatus(book.readingStatus)],
      ['**totalReadDay**', book.totalReadDay],
      ['**readingTime**', book.readingTime ? `${book.readingTime} 分钟` : undefined],
      ['**readingDate**', book.readingDate],
      ['**最近阅读**', book.lastReadTime ? new Date(book.lastReadTime * 1000).toLocaleString() : undefined],
      ['**简介**', book.intro],
      ['**PC地址**', book.pcUrl],
    ];

    return rawLines
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([label, value]) => `- ${label}: ${value}`);
  }

  private getNoteEmoji(note: Note): string {
    return note.highlightText ? '🖍️' : '💬';
  }

  private formatReadingStatus(status: number): string | undefined {
    switch (status) {
      case 0:
        return '未开始';
      case 1:
        return '阅读中';
      case 2:
        return '已读完';
      default:
        return status === undefined || status === null ? undefined : String(status);
    }
  }
}

let templateServiceInstance: TemplateService | undefined;

export function getTemplateService(): TemplateService {
  if (!templateServiceInstance) {
    templateServiceInstance = new TemplateService();
  }
  return templateServiceInstance;
}
