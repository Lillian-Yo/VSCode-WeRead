/**
 * 笔记相关 API
 */

import { apiClient } from './client';
import { Note, NoteType, Chapter, BookReview } from '../models';

export interface NotesApiResponse {
  bookmarks: Array<{
    bookmarkId: string;
    bookId: string;
    chapterUid: number;
    chapterTitle?: string;
    markText?: string;
    text?: string;
    content?: string;
    createTime: number;
    modifyTime?: number;
    range?: string;
    style?: string;
    type?: number;
  }>;
  chapters: Array<{
    chapterUid: number;
    title: string;
    chapterIdx: number;
    parentUid?: number;
    level: number;
  }>;
  reviews?: Array<{
    reviewId: string;
    bookId: string;
    content: string;
    rating?: number;
    createTime: number;
    modifyTime?: number;
  }>;
  updated?: Array<{
    bookmarkId?: string;
    reviewId?: string;
    bookId?: string;
    chapterUid?: number;
    chapterTitle?: string;
    markText?: string;
    text?: string;
    abstract?: string;
    content?: string;
    createTime?: number;
    updateTime?: number;
    modifyTime?: number;
    type?: number;
  }>;
}

/**
 * 获取书籍的笔记列表
 */
export async function getBookNotes(bookId: string): Promise<NotesApiResponse> {
  try {
    return await apiClient.get<NotesApiResponse>(
      `https://weread.qq.com/web/book/bookmarklist`,
      { params: { bookId } }
    );
  } catch {
    // 兼容旧接口
    return await apiClient.get<NotesApiResponse>('/book/bookmarklist', {
      params: { bookId },
    });
  }
}

/**
 * 获取书籍的热门划线
 */
export async function getBestBookmarks(bookId: string): Promise<NotesApiResponse> {
  const response = await apiClient.get<NotesApiResponse>('/book/bestbookmarks', {
    params: { bookId },
  });

  return response;
}

/**
 * 获取章节信息
 */
export async function getChapterInfo(bookId: string, chapterUid: number): Promise<Chapter> {
  const response = await apiClient.get<{
    chapterUid: number;
    title: string;
    chapterIdx: number;
    parentUid?: number;
    level: number;
  }>('/book/chapter', {
    params: { bookId, chapterUid },
  });

  return {
    chapterUid: response.chapterUid,
    title: response.title,
    chapterIdx: response.chapterIdx,
    parentUid: response.parentUid,
    level: response.level,
  };
}

/**
 * 转换笔记数据
 */
export function transformNotes(data: NotesApiResponse, bookId: string): Note[] {
  const source = pickRawNotes(data);
  if (!source || source.length === 0) {
    return [];
  }

  return source.map((item) => {
    const raw = item as Record<string, unknown>;
    const noteAuthor = pickString(raw, ['author', 'authorName', 'producer', 'publisherName', 'source']);
    return {
      noteId: item.bookmarkId || item.reviewId || `${bookId}-${item.chapterUid || 0}-${item.createTime || Date.now()}`,
      bookId: item.bookId || bookId,
      chapterUid: item.chapterUid || 0,
      chapterTitle: item.chapterTitle,
      type: (item.type as NoteType) || NoteType.Highlight,
      highlightText: item.markText || item.text || item.abstract,
      thoughtText: item.content,
      createTime: item.createTime || item.updateTime || Math.floor(Date.now() / 1000),
      modifyTime: item.modifyTime || item.updateTime,
      range: (item as any).range,
      style: (item as any).style ? parseStyle((item as any).style) : undefined,
      author: noteAuthor || undefined,
    };
  });
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return '';
}

function pickRawNotes(data: NotesApiResponse): any[] {
  const directCandidates = [
    (data as any).bookmarks,
    (data as any).updated,
    (data as any).notes,
    (data as any).items,
    (data as any).data,
    (data as any).list,
  ];

  for (const c of directCandidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c;
    }
  }

  // 有些接口会把列表挂在对象字段下
  for (const value of Object.values(data as any)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0] as any;
      if (first && (first.bookmarkId || first.reviewId || first.markText || first.text || first.content)) {
        return value as any[];
      }
    }
  }

  // 兜底：递归查找嵌套对象中的笔记数组，兼容 data.list / data.items 等结构
  const visited = new Set<any>();
  const stack: any[] = [data];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current) && current.length > 0) {
      const first = current[0] as any;
      if (first && (first.bookmarkId || first.reviewId || first.markText || first.text || first.content)) {
        return current as any[];
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return [];
}

/**
 * 转换章节数据
 */
export function transformChapters(data: NotesApiResponse): Chapter[] {
  if (!data.chapters) {
    return [];
  }

  return data.chapters.map((item) => ({
    chapterUid: item.chapterUid,
    title: item.title,
    chapterIdx: item.chapterIdx,
    parentUid: item.parentUid,
    level: item.level,
  }));
}

/**
 * 转换书评数据
 */
export function transformReviews(data: NotesApiResponse, bookId: string): BookReview | undefined {
  if (!data.reviews || data.reviews.length === 0) {
    return undefined;
  }

  const review = data.reviews[0];
  return {
    reviewId: review.reviewId,
    bookId: review.bookId || bookId,
    content: review.content,
    rating: review.rating,
    createTime: review.createTime,
    modifyTime: review.modifyTime,
  };
}

function parseStyle(styleStr: string): { color?: string } {
  try {
    const style = JSON.parse(styleStr);
    return {
      color: style.color,
    };
  } catch {
    return {};
  }
}
