/**
 * 全文搜索服务
 * 提供笔记的全文搜索功能
 */

import { Note, Book } from '../models';
import { getStorageService } from './storageService';

export interface SearchOptions {
  keyword: string;
  bookId?: string;
  chapterTitle?: string;
  noteType?: 'highlight' | 'thought' | 'all';
}

export interface SearchResult {
  note: Note;
  book: Book;
  score: number;
  matches: {
    field: 'highlightText' | 'thoughtText' | 'chapterTitle';
    text: string;
    indices: number[];
  }[];
}

export class SearchService {
  /**
   * 搜索笔记
   */
  search(options: SearchOptions): SearchResult[] {
    const storageService = getStorageService();
    const books = storageService.getBooks();
    const bookMap = new Map(books.map((b) => [b.bookId, b]));

    let notes: Note[];

    // 如果指定了书籍，只搜索该书籍的笔记
    if (options.bookId) {
      notes = storageService.getNotes(options.bookId);
    } else {
      notes = storageService.getAllNotesFlat();
    }

    // 按笔记类型筛选
    if (options.noteType === 'highlight') {
      notes = notes.filter((n) => n.highlightText);
    } else if (options.noteType === 'thought') {
      notes = notes.filter((n) => n.thoughtText);
    }

    // 按章节标题筛选
    if (options.chapterTitle) {
      notes = notes.filter((n) => n.chapterTitle === options.chapterTitle);
    }

    // 执行搜索
    return this.performSearch(options.keyword, notes, bookMap);
  }

  /**
   * 执行搜索
   */
  private performSearch(
    keyword: string,
    notes: Note[],
    bookMap: Map<string, Book>
  ): SearchResult[] {
    if (!keyword.trim()) {
      return [];
    }

    const keywords = keyword.toLowerCase().split(/\s+/).filter((k) => k.length > 0);
    const results: SearchResult[] = [];

    for (const note of notes) {
      const result = this.scoreNote(note, keywords, bookMap);
      if (result.score > 0) {
        results.push(result);
      }
    }

    // 按分数排序
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * 计算笔记的搜索分数
   */
  private scoreNote(
    note: Note,
    keywords: string[],
    bookMap: Map<string, Book>
  ): SearchResult {
    let score = 0;
    const matches: SearchResult['matches'] = [];

    // 搜索划线文本
    if (note.highlightText) {
      const highlightScore = this.calculateFieldScore(
        note.highlightText,
        keywords,
        'highlightText',
        matches
      );
      score += highlightScore * 1.0; // 基础权重
    }

    // 搜索想法文本（权重更高）
    if (note.thoughtText) {
      const thoughtScore = this.calculateFieldScore(
        note.thoughtText,
        keywords,
        'thoughtText',
        matches
      );
      score += thoughtScore * 1.5; // 想法权重更高
    }

    // 搜索章节标题
    if (note.chapterTitle) {
      const chapterScore = this.calculateFieldScore(
        note.chapterTitle,
        keywords,
        'chapterTitle',
        matches
      );
      score += chapterScore * 2.0; // 章节标题权重最高
    }

    const book = bookMap.get(note.bookId);

    return {
      note,
      book: book!,
      score,
      matches,
    };
  }

  /**
   * 计算字段的搜索分数
   */
  private calculateFieldScore(
    text: string,
    keywords: string[],
    field: SearchResult['matches'][0]['field'],
    matches: SearchResult['matches']
  ): number {
    const lowerText = text.toLowerCase();
    let score = 0;
    const indices: number[] = [];

    for (const keyword of keywords) {
      let index = lowerText.indexOf(keyword);
      while (index !== -1) {
        score += 1;
        indices.push(index);
        index = lowerText.indexOf(keyword, index + 1);
      }
    }

    if (indices.length > 0) {
      matches.push({
        field,
        text,
        indices,
      });
    }

    return score;
  }

  /**
   * 高亮匹配文本
   */
  highlightText(text: string, keyword: string): string {
    if (!keyword.trim()) {
      return text;
    }

    const keywords = keyword.split(/\s+/).filter((k) => k.length > 0);
    let result = text;

    for (const kw of keywords) {
      const regex = new RegExp(`(${this.escapeRegex(kw)})`, 'gi');
      result = result.replace(regex, '**$1**');
    }

    return result;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 获取所有章节标题（用于筛选）
   */
  getAllChapterTitles(): string[] {
    const storageService = getStorageService();
    const notes = storageService.getAllNotesFlat();
    const titles = new Set<string>();

    for (const note of notes) {
      if (note.chapterTitle) {
        titles.add(note.chapterTitle);
      }
    }

    return Array.from(titles).sort();
  }

  /**
   * 获取搜索建议
   */
  getSuggestions(query: string, limit: number = 10): string[] {
    const storageService = getStorageService();
    const notes = storageService.getAllNotesFlat();
    const suggestions = new Set<string>();

    const lowerQuery = query.toLowerCase();

    for (const note of notes) {
      // 从划线文本中提取建议
      if (note.highlightText) {
        const words = note.highlightText.split(/\s+/);
        for (const word of words) {
          if (word.toLowerCase().includes(lowerQuery) && word.length > 2) {
            suggestions.add(word);
          }
        }
      }

      // 从想法文本中提取建议
      if (note.thoughtText) {
        const words = note.thoughtText.split(/\s+/);
        for (const word of words) {
          if (word.toLowerCase().includes(lowerQuery) && word.length > 2) {
            suggestions.add(word);
          }
        }
      }

      if (suggestions.size >= limit) {
        break;
      }
    }

    return Array.from(suggestions).slice(0, limit);
  }
}

let searchServiceInstance: SearchService | undefined;

export function getSearchService(): SearchService {
  if (!searchServiceInstance) {
    searchServiceInstance = new SearchService();
  }
  return searchServiceInstance;
}
