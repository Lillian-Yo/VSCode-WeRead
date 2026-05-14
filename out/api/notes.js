"use strict";
/**
 * 笔记相关 API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformReviews = exports.transformChapters = exports.transformNotes = exports.getChapterInfo = exports.getBestBookmarks = exports.getBookNotes = void 0;
const client_1 = require("./client");
const models_1 = require("../models");
/**
 * 获取书籍的笔记列表
 */
async function getBookNotes(bookId) {
    try {
        return await client_1.apiClient.get(`https://weread.qq.com/web/book/bookmarklist`, { params: { bookId } });
    }
    catch {
        // 兼容旧接口
        return await client_1.apiClient.get('/book/bookmarklist', {
            params: { bookId },
        });
    }
}
exports.getBookNotes = getBookNotes;
/**
 * 获取书籍的热门划线
 */
async function getBestBookmarks(bookId) {
    const response = await client_1.apiClient.get('/book/bestbookmarks', {
        params: { bookId },
    });
    return response;
}
exports.getBestBookmarks = getBestBookmarks;
/**
 * 获取章节信息
 */
async function getChapterInfo(bookId, chapterUid) {
    const response = await client_1.apiClient.get('/book/chapter', {
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
exports.getChapterInfo = getChapterInfo;
/**
 * 转换笔记数据
 */
function transformNotes(data, bookId) {
    const source = pickRawNotes(data);
    if (!source || source.length === 0) {
        return [];
    }
    return source.map((item) => ({
        noteId: item.bookmarkId || item.reviewId || `${bookId}-${item.chapterUid || 0}-${item.createTime || Date.now()}`,
        bookId: item.bookId || bookId,
        chapterUid: item.chapterUid || 0,
        chapterTitle: item.chapterTitle,
        type: item.type || models_1.NoteType.Highlight,
        highlightText: item.markText || item.text || item.abstract,
        thoughtText: item.content,
        createTime: item.createTime || item.updateTime || Math.floor(Date.now() / 1000),
        modifyTime: item.modifyTime || item.updateTime,
        range: item.range,
        style: item.style ? parseStyle(item.style) : undefined,
    }));
}
exports.transformNotes = transformNotes;
function pickRawNotes(data) {
    const directCandidates = [
        data.bookmarks,
        data.updated,
        data.notes,
        data.items,
        data.data,
        data.list,
    ];
    for (const c of directCandidates) {
        if (Array.isArray(c) && c.length > 0) {
            return c;
        }
    }
    // 有些接口会把列表挂在对象字段下
    for (const value of Object.values(data)) {
        if (Array.isArray(value) && value.length > 0) {
            const first = value[0];
            if (first && (first.bookmarkId || first.reviewId || first.markText || first.text || first.content)) {
                return value;
            }
        }
    }
    // 兜底：递归查找嵌套对象中的笔记数组，兼容 data.list / data.items 等结构
    const visited = new Set();
    const stack = [data];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || visited.has(current)) {
            continue;
        }
        visited.add(current);
        if (Array.isArray(current) && current.length > 0) {
            const first = current[0];
            if (first && (first.bookmarkId || first.reviewId || first.markText || first.text || first.content)) {
                return current;
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
function transformChapters(data) {
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
exports.transformChapters = transformChapters;
/**
 * 转换书评数据
 */
function transformReviews(data, bookId) {
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
exports.transformReviews = transformReviews;
function parseStyle(styleStr) {
    try {
        const style = JSON.parse(styleStr);
        return {
            color: style.color,
        };
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=notes.js.map