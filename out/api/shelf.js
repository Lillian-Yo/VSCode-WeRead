"use strict";
/**
 * 书架相关 API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBookInfo = exports.buildPcUrl = exports.getShelfList = void 0;
const client_1 = require("./client");
const crypto_1 = require("crypto");
/**
 * 获取书架列表
 */
async function getShelfList() {
    const books = await loadNotebookBooks();
    return {
        books: books.map((book) => ({
            book,
            lastReadTime: book.lastReadTime || 0,
            progress: book.progress,
        })),
        totalCount: books.length,
        syncTime: Date.now(),
    };
}
exports.getShelfList = getShelfList;
async function loadNotebookBooks() {
    try {
        const notebookResp = await client_1.apiClient.get('https://weread.qq.com/api/user/notebook');
        const rawBooks = Array.isArray(notebookResp?.books) ? notebookResp.books : [];
        return rawBooks
            .map((item) => normalizeBookItem(item))
            .filter((item) => !!item);
    }
    catch {
        // 兼容旧接口，避免已有用户无法使用
        const response = await client_1.apiClient.get('/shelf/sync', {
            params: {
                synckey: 0,
                teenmode: 0,
                album: 1,
            },
        });
        return response.books
            .map((item) => normalizeBookItem(item))
            .filter((item) => !!item);
    }
}
function normalizeBookItem(raw) {
    if (!raw) {
        return undefined;
    }
    const candidates = getBookCandidates(raw);
    const bookId = pickStringFrom(candidates, ['bookId', 'bookid', 'docId', 'docid']) || '';
    if (!bookId) {
        return undefined;
    }
    const progressRaw = pickNumberFrom(candidates, ['progress', 'readingProgress', 'readProgress'], 0) || 0;
    const progress = progressRaw > 1 ? Math.round(progressRaw) : Math.round(progressRaw * 100);
    const readingStatus = pickNumberFrom(candidates, ['readingStatus', 'readingStat', 'readStatus'], 0) || 0;
    const highlightCount = pickNumberFrom(candidates, ['highlightCount', 'markCount', 'underlineCount'], 0) || 0;
    const thoughtCount = pickNumberFrom(candidates, ['noteCount', 'note_count', 'thoughtCount', 'commentCount'], 0) || 0;
    const reviewCount = pickNumberFrom(candidates, ['reviewCount', 'thoughtCount', 'commentCount'], thoughtCount) || 0;
    const noteCount = pickNumberFrom(candidates, ['noteCount', 'note_count', 'bookmarkCount'], highlightCount + thoughtCount) || 0;
    const category = pickStringFrom(candidates, ['category', 'categoryName', 'bookCategory', 'cat']) || pickCategory(raw);
    const canonicalReaderId = pickCanonicalReaderId(candidates, bookId);
    return {
        bookId,
        rawBookId: pickStringFrom(candidates, ['bookid', 'bookId', 'docId', 'docid']) || bookId,
        docType: pickStringFrom(candidates, ['docType', 'doc_type', 'type']),
        title: pickStringFrom(candidates, ['title', 'bookName', 'name']) || '未命名书籍',
        author: pickStringFrom(candidates, ['author', 'authorName', 'writer']) || '',
        cover: pickStringFrom(candidates, ['cover', 'coverUrl', 'cover_url']) || '',
        isbn: pickStringFrom(candidates, ['isbn', 'isbn13', 'bookIsbn']),
        publisher: pickStringFrom(candidates, ['publisher', 'press', 'bookPublisher', 'publish']),
        publishTime: pickStringFrom(candidates, ['publishTime', 'publishDate', 'publish_date']),
        category,
        intro: pickStringFrom(candidates, ['intro', 'introduction', 'bookIntro', 'abstract', 'description']),
        reviewCount,
        progress,
        readingStatus,
        totalReadDay: pickNumberFrom(candidates, ['totalReadDay', 'readDay', 'readDays']),
        readingTime: pickNumberFrom(candidates, ['readingTime', 'readTime', 'totalReadingTime']),
        readingDate: pickStringFrom(candidates, ['readingDate', 'readDate', 'lastReadingDate']),
        lastReadTime: pickNumberFrom(candidates, ['lastReadTime', 'updateTime', 'readUpdateTime'], 0) || 0,
        highlightCount,
        noteCount,
        pcUrl: resolvePcUrl(candidates, bookId, canonicalReaderId),
    };
}
function getBookCandidates(raw) {
    const candidates = [
        raw,
        raw?.book,
        raw?.bookInfo,
        raw?.bookMeta,
        raw?.meta,
        raw?.extra,
        raw?.book?.bookInfo,
    ];
    return candidates.filter(Boolean);
}
function pickStringFrom(sources, keys) {
    for (const source of sources) {
        for (const key of keys) {
            const value = source?.[key];
            if (value !== undefined && value !== null && String(value).trim()) {
                return String(value).trim();
            }
        }
    }
    return undefined;
}
function pickNumberFrom(sources, keys, fallback) {
    for (const source of sources) {
        for (const key of keys) {
            const value = source?.[key];
            if (value !== undefined && value !== null && value !== '') {
                const parsed = Number(value);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            }
        }
    }
    return fallback;
}
function collectStringValuesFrom(sources, keys) {
    const values = [];
    for (const source of sources) {
        if (!source || typeof source !== 'object') {
            continue;
        }
        for (const key of keys) {
            const value = source[key];
            if (value !== undefined && value !== null) {
                const text = String(value).trim();
                if (text) {
                    values.push(text);
                }
            }
        }
    }
    return values;
}
function pickCanonicalReaderId(sources, sourceBookId) {
    const candidates = collectStringValuesFrom(sources, [
        'bookId',
        'bookid',
        'docId',
        'docid',
        'readerId',
        'infoId',
        'readerBookId',
        'mpBookId',
    ]);
    const uniqueCandidates = Array.from(new Set(candidates));
    const hexCandidate = uniqueCandidates.find((item) => item !== sourceBookId && /^[0-9a-f]{20,}$/i.test(item));
    if (hexCandidate) {
        return hexCandidate;
    }
    if (/^\d+$/.test(sourceBookId)) {
        return uniqueCandidates.find((item) => item !== sourceBookId && /^[a-z0-9]{20,}$/i.test(item) && /[a-z]/i.test(item));
    }
    return undefined;
}
function pickCategory(raw) {
    const categoryCandidates = [
        raw?.category,
        raw?.book?.category,
        raw?.bookInfo?.category,
        raw?.categoryName,
        raw?.book?.categoryName,
        raw?.bookInfo?.categoryName,
        raw?.categories,
        raw?.book?.categories,
        raw?.bookInfo?.categories,
        raw?.tags,
        raw?.book?.tags,
    ];
    for (const candidate of categoryCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
        if (Array.isArray(candidate)) {
            const names = candidate
                .map((item) => typeof item === 'string'
                ? item
                : item?.name || item?.title || item?.category || item?.categoryName)
                .filter((item) => !!item)
                .map((item) => String(item).trim());
            if (names.length > 0) {
                return names.join(' / ');
            }
        }
    }
    return undefined;
}
function buildPcUrl(bookId) {
    const sourceBookId = bookId.startsWith('article:') ? bookId.replace('article:', '') : bookId;
    const readerId = buildReaderIdFromBookId(sourceBookId);
    if (sourceBookId.startsWith('MP_WXS_')) {
        return `https://weread.qq.com/web/mp/reader/${readerId}`;
    }
    if (bookId.startsWith('article:')) {
        return `https://weread.qq.com/web/mp/reader/${readerId}`;
    }
    return `https://weread.qq.com/web/reader/${readerId}`;
}
exports.buildPcUrl = buildPcUrl;
function md5Hex(input) {
    return (0, crypto_1.createHash)('md5').update(input).digest('hex');
}
function getFa(id) {
    if (/^\d*$/.test(id)) {
        const segments = [];
        for (let cursor = 0; cursor < id.length; cursor += 9) {
            const piece = id.slice(cursor, Math.min(cursor + 9, id.length));
            segments.push(parseInt(piece, 10).toString(16));
        }
        return ['3', segments];
    }
    let hexText = '';
    for (let index = 0; index < id.length; index += 1) {
        hexText += id.charCodeAt(index).toString(16);
    }
    return ['4', [hexText]];
}
function buildReaderIdFromBookId(bookId) {
    const md5 = md5Hex(bookId);
    const fa = getFa(bookId);
    let readerId = md5.substring(0, 3);
    readerId += fa[0];
    readerId += `2${md5.substring(md5.length - 2)}`;
    for (let index = 0; index < fa[1].length; index += 1) {
        const piece = fa[1][index];
        readerId += piece.length.toString(16).padStart(2, '0');
        readerId += piece;
        if (index < fa[1].length - 1) {
            readerId += 'g';
        }
    }
    if (readerId.length < 20) {
        readerId += md5.substring(0, 20 - readerId.length);
    }
    readerId += md5Hex(readerId).substring(0, 3);
    return readerId;
}
function isMpReaderRouteBookId(bookId) {
    const sourceBookId = bookId.startsWith('article:') ? bookId.replace('article:', '') : bookId;
    return sourceBookId.startsWith('MP_WXS_') || bookId.startsWith('article:');
}
function buildReaderUrlByBookType(bookId, readerId) {
    if (isMpReaderRouteBookId(bookId)) {
        return `https://weread.qq.com/web/mp/reader/${readerId}`;
    }
    return `https://weread.qq.com/web/reader/${readerId}`;
}
function shouldPrintCanonicalDebugLogs() {
    if (process.env.NODE_ENV !== 'production') {
        return true;
    }
    if (process.env.WEREAD_DEBUG_CANONICAL_ID === '1') {
        return true;
    }
    try {
        // Lazy-load vscode to avoid hard dependency in pure runtime contexts.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vscode = require('vscode');
        return vscode.workspace.getConfiguration('weread').get('debugCanonicalIdLog', false);
    }
    catch {
        return false;
    }
}
function logCanonicalUnresolved(bookId, candidates, selectedPcUrl) {
    if (!shouldPrintCanonicalDebugLogs()) {
        return;
    }
    const keySamples = collectStringValuesFrom(candidates, ['bookId', 'bookid', 'docId', 'docid', 'readerId', 'infoId'])
        .slice(0, 8)
        .join('|');
    console.warn(`[pcurl.canonical.unresolved] bookId=${bookId} selectedPcUrl=${selectedPcUrl} keys=${keySamples}`);
}
function resolvePcUrl(candidates, bookId, canonicalReaderId) {
    const directUrl = pickStringFrom(candidates, ['pcUrl', 'pcURL', 'readerUrl', 'url', 'bookUrl', 'bookURL']);
    const deepReaderUrl = pickReaderUrlFromCandidates(candidates);
    const fallbackUrl = canonicalReaderId
        ? buildReaderUrlByBookType(bookId, canonicalReaderId)
        : buildPcUrl(bookId);
    const selected = normalizePcUrl(directUrl || deepReaderUrl || fallbackUrl, bookId);
    const unresolvedMp = bookId.startsWith('MP_WXS_') && /\/web\/mp\/reader\/MP_WXS_/i.test(selected);
    const unresolvedNumeric = /^\d+$/.test(bookId) && /\/web\/reader\/\d+(?:$|[?#])/i.test(selected);
    if (!canonicalReaderId && (unresolvedMp || unresolvedNumeric)) {
        logCanonicalUnresolved(bookId, candidates, selected);
    }
    return selected;
}
function pickReaderUrlFromCandidates(sources) {
    const visited = new Set();
    const stack = [...sources];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || visited.has(current)) {
            continue;
        }
        visited.add(current);
        for (const value of Object.values(current)) {
            if (typeof value === 'string') {
                const url = value.trim();
                if (/^https?:\/\/weread\.qq\.com\/web\/(mp\/reader|reader)\//i.test(url)) {
                    return url;
                }
            }
            else if (value && typeof value === 'object') {
                stack.push(value);
            }
        }
    }
    return undefined;
}
function normalizePcUrl(url, bookId) {
    const trimmed = String(url || '').trim();
    if (!trimmed) {
        return buildPcUrl(bookId);
    }
    // 兼容旧数据：公众号条目错误写成 /web/reader/MP_WXS_xxx 时会 404，这里强制改到 /web/mp/reader/
    if (/^https?:\/\/weread\.qq\.com\/web\/reader\/MP_WXS_/i.test(trimmed)) {
        return buildPcUrl(bookId);
    }
    // 兼容旧数据：公众号条目虽然是 /web/mp/reader/，但仍使用了原始 MP_WXS_xxx，改为算法 readerId
    if (/^https?:\/\/weread\.qq\.com\/web\/mp\/reader\/MP_WXS_/i.test(trimmed)) {
        return buildPcUrl(bookId);
    }
    // 兼容旧数据：普通书错误写成 /web/reader/{纯数字bookId} 时会 404，改为算法生成的 readerId
    const numericReaderMatch = trimmed.match(/^https?:\/\/weread\.qq\.com\/web\/reader\/(\d+)(?:$|[?#])/i);
    if (numericReaderMatch && /^\d+$/.test(bookId)) {
        return buildPcUrl(bookId);
    }
    return trimmed;
}
/**
 * 获取书籍详情
 */
async function getBookInfo(bookId) {
    const response = await client_1.apiClient.get('/book/info', {
        params: { bookId },
    });
    const canonicalBookId = String(response.bookId || '').trim() || bookId;
    const canonicalReaderId = pickCanonicalReaderId([response], bookId);
    const pcUrl = resolvePcUrl([response], bookId, canonicalReaderId || (canonicalBookId !== bookId ? canonicalBookId : undefined));
    return {
        bookId: canonicalBookId,
        title: response.title,
        author: response.author,
        cover: response.cover,
        isbn: response.isbn,
        publisher: response.publisher,
        publishTime: response.publishTime,
        category: response.category,
        intro: response.intro,
        progress: Math.round(response.progress * 100),
        readingStatus: response.readingStatus,
        pcUrl,
    };
}
exports.getBookInfo = getBookInfo;
//# sourceMappingURL=shelf.js.map