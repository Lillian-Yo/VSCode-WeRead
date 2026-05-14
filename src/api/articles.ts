/**
 * 公众号文章相关 API（微信读书）
 * 注：接口在不同账号和灰度环境下可能不可用，调用方需做好降级处理。
 */

import { apiClient } from './client';
import { Book, ReadingStatus } from '../models';
import { buildPcUrl } from './shelf';

interface ArticleItem {
  articleId?: string;
  docId?: string;
  title?: string;
  author?: string;
  cover?: string;
  updateTime?: number;
}

interface ArticleListResponse {
  articles?: ArticleItem[];
  list?: ArticleItem[];
}

/**
 * 获取公众号文章列表并映射为书架 Book 模型，便于与现有流程复用。
 */
export async function getArticleBooks(): Promise<Book[]> {
  const response = await apiClient.get<ArticleListResponse>('/article/list', {
    params: {
      synckey: 0,
    },
  });

  const items = response.articles || response.list || [];
  return items
    .filter((item) => item.articleId || item.docId)
    .map((item) => ({
      bookId: `article:${item.articleId || item.docId}`,
      rawBookId: String(item.articleId || item.docId || ''),
      docType: 'article',
      title: item.title || '未命名文章',
      author: item.author || '公众号',
      cover: item.cover || '',
      category: '公众号',
      progress: 100,
      readingStatus: ReadingStatus.Finished,
      lastReadTime: item.updateTime || Math.floor(Date.now() / 1000),
      highlightCount: 0,
      noteCount: 0,
      reviewCount: 0,
      intro: '微信公众号文章（来自微信读书）',
      pcUrl: buildPcUrl(`article:${item.articleId || item.docId}`),
    }));
}
