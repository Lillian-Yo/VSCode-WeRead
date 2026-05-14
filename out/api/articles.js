"use strict";
/**
 * 公众号文章相关 API（微信读书）
 * 注：接口在不同账号和灰度环境下可能不可用，调用方需做好降级处理。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getArticleBooks = void 0;
const client_1 = require("./client");
const models_1 = require("../models");
const shelf_1 = require("./shelf");
/**
 * 获取公众号文章列表并映射为书架 Book 模型，便于与现有流程复用。
 */
async function getArticleBooks() {
    const response = await client_1.apiClient.get('/article/list', {
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
        readingStatus: models_1.ReadingStatus.Finished,
        lastReadTime: item.updateTime || Math.floor(Date.now() / 1000),
        highlightCount: 0,
        noteCount: 0,
        reviewCount: 0,
        intro: '微信公众号文章（来自微信读书）',
        pcUrl: (0, shelf_1.buildPcUrl)(`article:${item.articleId || item.docId}`),
    }));
}
exports.getArticleBooks = getArticleBooks;
//# sourceMappingURL=articles.js.map