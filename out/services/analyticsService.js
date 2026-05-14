"use strict";
/**
 * 阅读洞察分析服务
 * 基于已同步的 books + notes 数据计算统计指标
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalyticsService = exports.AnalyticsService = void 0;
const models_1 = require("../models");
const storageService_1 = require("./storageService");
const indexService_1 = require("./indexService");
const auth_1 = require("../auth");
const deprecation_1 = require("../utils/deprecation");
class AnalyticsService {
    constructor(storageProvider = storageService_1.getStorageService, indexProvider = indexService_1.getIndexService) {
        this.cache = new Map();
        this.latestByAccount = new Map();
        this.storageProvider = storageProvider;
        this.indexProvider = indexProvider;
    }
    getDashboardData(filter, accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('analyticsService.getDashboardData()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const targetAccountId = this.resolveAccountId(accountId);
        const storage = this.storageProvider();
        const allBooks = targetAccountId ? storage.getBooks(targetAccountId) : storage.getBooks();
        const noteMap = targetAccountId ? storage.getAllNotes(targetAccountId) : storage.getAllNotes();
        const hasDefaultData = storage.getBooks().length > 0 || Object.keys(storage.getAllNotes()).length > 0;
        if (targetAccountId && allBooks.length === 0 && Object.keys(noteMap).length === 0 && hasDefaultData) {
            const dataVersion = buildDataVersion(storage, storage.getBooks(), storage.getAllNotes(), undefined);
            return this.computeDashboardData(filter, storage.getBooks(), storage.getAllNotes(), dataVersion, undefined);
        }
        const dataVersion = buildDataVersion(storage, allBooks, noteMap, targetAccountId);
        return this.computeDashboardData(filter, allBooks, noteMap, dataVersion, targetAccountId);
    }
    async getDashboardDataFromIndex(filter, accountId) {
        if (!accountId) {
            (0, deprecation_1.warnDeprecatedNoAccountParam)('analyticsService.getDashboardDataFromIndex()', (0, auth_1.getCookieManager)().getActiveAccountId());
        }
        const targetAccountId = this.resolveAccountId(accountId);
        const indexService = this.indexProvider();
        const allBooks = await indexService.queryBooks(targetAccountId);
        if (targetAccountId && allBooks.length === 0) {
            const fallbackBooks = await indexService.queryBooks(undefined);
            if (fallbackBooks.length > 0) {
                const fallbackEntries = await Promise.all(fallbackBooks.map(async (book) => [book.bookId, await indexService.getNotesByBookId(book.bookId, undefined)]));
                const fallbackNoteMap = Object.fromEntries(fallbackEntries);
                const fallbackVersion = buildIndexDataVersion(fallbackBooks, fallbackNoteMap, undefined);
                return this.computeDashboardData(filter, fallbackBooks, fallbackNoteMap, fallbackVersion, undefined);
            }
        }
        const noteEntries = await Promise.all(allBooks.map(async (book) => [book.bookId, await indexService.getNotesByBookId(book.bookId, targetAccountId)]));
        const noteMap = Object.fromEntries(noteEntries);
        const dataVersion = buildIndexDataVersion(allBooks, noteMap, targetAccountId);
        return this.computeDashboardData(filter, allBooks, noteMap, dataVersion, targetAccountId);
    }
    async getDashboardDataResilient(filter, accountId, options) {
        const retries = Math.max(0, Number(options?.retries ?? 1));
        const retryDelayMs = Math.max(50, Number(options?.retryDelayMs ?? 300));
        const normalizedAccountId = String(accountId || '').trim();
        let attempts = 0;
        let lastError;
        for (let i = 0; i <= retries; i++) {
            attempts += 1;
            try {
                const data = await this.getDashboardDataFromIndex(filter, accountId);
                this.latestByAccount.set(normalizedAccountId || 'default', data);
                return {
                    data,
                    source: 'index',
                    attempts,
                    degraded: false,
                };
            }
            catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`[Insights][account:${normalizedAccountId || 'default'}] 读取索引数据失败（第 ${i + 1} 次）：${message}`);
                if (i < retries) {
                    await wait(retryDelayMs * (i + 1));
                }
            }
        }
        try {
            const fallbackData = this.getDashboardData(filter, accountId);
            this.latestByAccount.set(normalizedAccountId || 'default', fallbackData);
            return {
                data: fallbackData,
                source: 'storage',
                attempts,
                degraded: true,
                error: lastError instanceof Error ? lastError.message : String(lastError || ''),
            };
        }
        catch (fallbackError) {
            const cached = this.latestByAccount.get(normalizedAccountId || 'default');
            if (cached) {
                const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError || '');
                console.error(`[Insights][account:${normalizedAccountId || 'default'}] 使用缓存兜底：${message}`);
                return {
                    data: cached,
                    source: 'cache',
                    attempts,
                    degraded: true,
                    error: message,
                };
            }
            throw fallbackError;
        }
    }
    computeDashboardData(filter, allBooks, noteMap, dataVersion, accountId) {
        const normalizedFilter = normalizeFilter(filter);
        const cacheKey = `${String(accountId || 'default')}::${dataVersion}::${serializeFilter(normalizedFilter)}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }
        const now = Date.now();
        const days = normalizedFilter.days;
        const category = normalizedFilter.category;
        const finishedOnly = normalizedFilter.finishedOnly;
        const noteType = normalizedFilter.noteType;
        const startAt = resolveStartAt(allBooks, noteMap, now, days);
        const scopedDays = Math.max(1, Math.floor((startOfDay(now) - startAt) / DAY_MS) + 1);
        const availableCategories = collectCategories(allBooks);
        const scopedBooks = allBooks.filter((book) => {
            if (category && category !== 'all' && resolveBookCategory(book) !== category) {
                return false;
            }
            if (!finishedOnly) {
                return true;
            }
            return book.readingStatus === models_1.ReadingStatus.Finished || clampRate(book.progress) >= 100;
        });
        const scopedBookIds = new Set(scopedBooks.map((book) => book.bookId));
        const allNotes = Object.values(noteMap).flat();
        const scopedNotes = allNotes.filter((note) => {
            const ts = noteTimestampMs(note);
            if (ts < startAt || ts > now) {
                return false;
            }
            if (!scopedBookIds.has(note.bookId)) {
                return false;
            }
            return matchesNoteType(note, noteType);
        });
        const notesByBook = groupByBook(scopedNotes);
        const heatmap = buildHeatmap(scopedNotes);
        const categoryShare = buildCategoryShare(scopedBooks, notesByBook);
        const scatter = buildScatter(scopedBooks, notesByBook);
        const authorCloud = buildAuthorCloud(scopedBooks);
        const categoryRadar = buildCategoryRadar(scopedBooks);
        const result = {
            filter: { days, category, finishedOnly, noteType, trendGranularity: normalizedFilter.trendGranularity },
            availableCategories,
            kpis: buildKpis(scopedBooks, scopedNotes, notesByBook),
            trend: buildTrend(scopedNotes, startAt, scopedDays, normalizedFilter.trendGranularity),
            heatmap,
            categoryShare,
            scatter,
            topBooks: buildTopBooks(scopedBooks, notesByBook),
            timeline: buildTimeline(scopedNotes, scopedBooks),
            authorCloud,
            categoryRadar,
        };
        this.cache.clear();
        this.cache.set(cacheKey, result);
        return result;
    }
    clearCache() {
        this.cache.clear();
    }
    resolveAccountId(accountId) {
        const normalized = String(accountId || '').trim();
        if (normalized) {
            return normalized;
        }
        return (0, auth_1.getCookieManager)().getActiveAccountId();
    }
}
exports.AnalyticsService = AnalyticsService;
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const DAY_MS = 24 * 60 * 60 * 1000;
function buildKpis(books, scopedNotes, notesByBook) {
    const dayKeys = Array.from(new Set(scopedNotes.map((note) => dayKeyFromMs(noteTimestampMs(note))).filter((day) => !!day))).sort();
    const activeDays = dayKeys.length;
    const longestStreakDays = calculateLongestStreak(dayKeys);
    const totalNotes = scopedNotes.length;
    const estimatedReadPages = books.reduce((sum, book) => {
        const totalPages = extractTotalPages(book);
        if (totalPages <= 0) {
            return sum;
        }
        const readPages = totalPages * (clampRate(book.progress) / 100);
        return sum + readPages;
    }, 0);
    const noteDensityPer100Pages = estimatedReadPages <= 0 ? 0 : round2((totalNotes / Math.max(1, estimatedReadPages)) * 100);
    const deepNotes = scopedNotes.filter((note) => isDeepNote(note)).length;
    const deepNoteRatio = toPercent(totalNotes === 0 ? 0 : deepNotes / totalNotes);
    const completionRates = books.map((book) => clampRate(book.progress)).filter((rate) => rate > 0);
    const averageCompletionRate = completionRates.length === 0 ? 0 : round2(completionRates.reduce((sum, rate) => sum + rate, 0) / completionRates.length);
    const touchedBooks = notesByBook.size;
    const averageNotesPerBook = touchedBooks === 0 ? 0 : round2(totalNotes / touchedBooks);
    return {
        activeDays,
        longestStreakDays,
        totalNotes,
        noteDensityPer100Pages,
        deepNoteRatio,
        averageCompletionRate,
        averageNotesPerBook,
    };
}
function buildTrend(notes, startAt, days, granularity) {
    if (granularity === 'week') {
        return buildWeeklyTrend(notes, startAt, days);
    }
    return buildDailyTrend(notes, startAt, days);
}
function buildDailyTrend(notes, startAt, days) {
    const bucket = new Map();
    for (let i = 0; i < days; i++) {
        const date = formatDate(startAt + i * DAY_MS);
        bucket.set(date, { notesCount: 0, books: new Set() });
    }
    for (const note of notes) {
        const date = formatDate(noteTimestampMs(note));
        const item = bucket.get(date);
        if (!item) {
            continue;
        }
        item.notesCount += 1;
        item.books.add(note.bookId);
    }
    return Array.from(bucket.entries()).map(([date, value]) => ({
        date,
        notesCount: value.notesCount,
        touchedBooks: value.books.size,
    }));
}
function buildWeeklyTrend(notes, startAt, days) {
    const startWeek = startOfWeek(startAt);
    const endWeek = startOfWeek(startAt + (days - 1) * DAY_MS);
    const bucket = new Map();
    for (let cursor = startWeek; cursor <= endWeek; cursor += 7 * DAY_MS) {
        const label = formatWeekLabel(cursor);
        bucket.set(label, { notesCount: 0, books: new Set() });
    }
    for (const note of notes) {
        const weekStart = startOfWeek(noteTimestampMs(note));
        const label = formatWeekLabel(weekStart);
        const item = bucket.get(label);
        if (!item) {
            continue;
        }
        item.notesCount += 1;
        item.books.add(note.bookId);
    }
    return Array.from(bucket.entries()).map(([date, value]) => ({
        date,
        notesCount: value.notesCount,
        touchedBooks: value.books.size,
    }));
}
function buildTopBooks(books, notesByBook) {
    const bookMap = new Map(books.map((book) => [book.bookId, book]));
    const items = [];
    for (const [bookId, notes] of notesByBook.entries()) {
        const book = bookMap.get(bookId);
        if (!book) {
            continue;
        }
        const notesCount = notes.length;
        const completionRate = clampRate(book.progress);
        const deepCount = notes.filter((note) => isDeepNote(note)).length;
        const deepNoteRatio = toPercent(notesCount === 0 ? 0 : deepCount / notesCount);
        const valueScore = round2(normalizeScore(notesCount, deepNoteRatio, completionRate));
        items.push({
            bookId,
            title: book.title,
            author: book.author,
            completionRate,
            notesCount,
            deepNoteRatio,
            valueScore,
        });
    }
    return items.sort((a, b) => b.valueScore - a.valueScore).slice(0, 10);
}
function buildHeatmap(notes) {
    const counter = new Map();
    for (let weekDay = 0; weekDay < 7; weekDay++) {
        for (let hour = 0; hour < 24; hour++) {
            counter.set(`${weekDay}-${hour}`, 0);
        }
    }
    for (const note of notes) {
        const date = new Date(noteTimestampMs(note));
        const weekDay = date.getDay();
        const hour = date.getHours();
        const key = `${weekDay}-${hour}`;
        counter.set(key, (counter.get(key) || 0) + 1);
    }
    const cells = [];
    for (let weekDay = 0; weekDay < 7; weekDay++) {
        for (let hour = 0; hour < 24; hour++) {
            const key = `${weekDay}-${hour}`;
            cells.push({
                weekDay,
                hour,
                value: counter.get(key) || 0,
            });
        }
    }
    return cells;
}
function buildCategoryShare(books, notesByBook) {
    const buckets = new Map();
    for (const book of books) {
        const category = (book.category || '未分类').trim() || '未分类';
        const current = buckets.get(category) || { readBooks: 0, notesCount: 0 };
        current.readBooks += 1;
        current.notesCount += notesByBook.get(book.bookId)?.length || 0;
        buckets.set(category, current);
    }
    const allItems = Array.from(buckets.entries())
        .map(([category, value]) => ({
        category,
        readBooks: value.readBooks,
        notesCount: value.notesCount,
    }))
        .sort((a, b) => b.notesCount - a.notesCount);
    if (allItems.length <= 12) {
        return allItems;
    }
    const top11 = allItems.slice(0, 11);
    const others = allItems.slice(11);
    const othersNotesCount = others.reduce((sum, item) => sum + item.notesCount, 0);
    const othersReadBooks = others.reduce((sum, item) => sum + item.readBooks, 0);
    if (othersNotesCount > 0 || othersReadBooks > 0) {
        top11.push({
            category: '其他',
            readBooks: othersReadBooks,
            notesCount: othersNotesCount,
        });
    }
    return top11;
}
function buildScatter(books, notesByBook) {
    const raw = books
        .map((book) => {
        const notesCount = notesByBook.get(book.bookId)?.length || 0;
        if (notesCount <= 0) {
            return undefined;
        }
        const readingTime = Math.max(0, Number(book.readingTime || 0));
        const totalPages = extractTotalPages(book);
        const readPages = totalPages * (clampRate(book.progress) / 100);
        const noteDensity = readPages > 0 ? round2((notesCount / readPages) * 100) : 0;
        const pseudoX = readingTime > 0 ? readingTime : Math.max(0.1, round2(notesCount * 0.1));
        return {
            bookId: book.bookId,
            title: book.title,
            readingTime: pseudoX,
            noteDensity,
        };
    })
        .filter((item) => !!item);
    if (raw.length === 0) {
        return [];
    }
    const readingMedian = percentile(raw.map((i) => i.readingTime), 0.5);
    const densityMedian = percentile(raw.map((i) => i.noteDensity), 0.5);
    return raw
        .sort((a, b) => {
        if (b.noteDensity !== a.noteDensity) {
            return b.noteDensity - a.noteDensity;
        }
        return b.readingTime - a.readingTime;
    })
        .map((item) => ({
        ...item,
        quadrant: resolveQuadrant(item.readingTime, item.noteDensity, readingMedian, densityMedian),
    }))
        .slice(0, 60);
}
function resolveQuadrant(readingTime, noteDensity, readingMedian, densityMedian) {
    const highTime = readingTime >= readingMedian;
    const highDensity = noteDensity >= densityMedian;
    if (highTime && highDensity) {
        return 'high_value';
    }
    if (!highTime && highDensity) {
        return 'high_density';
    }
    if (highTime && !highDensity) {
        return 'high_time';
    }
    return 'low_value';
}
function buildTimeline(notes, books) {
    const bookMap = new Map(books.map((book) => [book.bookId, book]));
    return [...notes]
        .sort((a, b) => noteTimestampMs(b) - noteTimestampMs(a))
        .slice(0, 50)
        .map((note) => ({
        noteId: note.noteId,
        bookId: note.bookId,
        bookTitle: bookMap.get(note.bookId)?.title || '未知书籍',
        chapterTitle: note.chapterTitle || '未分类章节',
        noteType: resolveNoteType(note),
        highlightText: trimText(note.highlightText || '', 120),
        thoughtText: trimText(note.thoughtText || '', 120),
        createdAt: noteTimestampMs(note),
    }));
}
function buildAuthorCloud(books) {
    const authorMap = new Map();
    for (const book of books) {
        if (!book.author)
            continue;
        const authors = book.author.split(/[,\s]+/).map(a => a.trim()).filter(Boolean);
        for (const author of authors) {
            if (!author || author === '无')
                continue;
            authorMap.set(author, (authorMap.get(author) || 0) + 1);
        }
    }
    return Array.from(authorMap.entries())
        .map(([author, count]) => ({ author, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50); // limit to top 50 authors
}
function buildCategoryRadar(books) {
    const firstLevelMap = new Map();
    const secondLevelMap = new Map();
    for (const book of books) {
        const rawCat = (book.category || '未分类').trim() || '未分类';
        const parts = rawCat.split(/[-_/\\]+/);
        const firstLevel = parts[0] || '未分类';
        const secondLevel = parts.length > 1 ? parts[1] : firstLevel;
        firstLevelMap.set(firstLevel, (firstLevelMap.get(firstLevel) || 0) + 1);
        secondLevelMap.set(secondLevel, (secondLevelMap.get(secondLevel) || 0) + 1);
    }
    const items = [];
    for (const [category, count] of firstLevelMap.entries()) {
        items.push({ category, count, level: 1 });
    }
    for (const [category, count] of secondLevelMap.entries()) {
        items.push({ category, count, level: 2 });
    }
    return items.sort((a, b) => b.count - a.count);
}
function groupByBook(notes) {
    const map = new Map();
    for (const note of notes) {
        const current = map.get(note.bookId);
        if (current) {
            current.push(note);
            continue;
        }
        map.set(note.bookId, [note]);
    }
    return map;
}
function collectCategories(books) {
    return Array.from(new Set(books.map((book) => resolveBookCategory(book)).filter((value) => !!value))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}
function resolveBookCategory(book) {
    return (book.category || '').trim() || '未分类';
}
function normalizeFilter(filter) {
    return {
        days: normalizeDays(filter.days),
        category: (filter.category || '').trim(),
        finishedOnly: !!filter.finishedOnly,
        noteType: normalizeNoteType(filter.noteType),
        trendGranularity: normalizeTrendGranularity(filter.trendGranularity),
    };
}
function serializeFilter(filter) {
    return `${filter.days}|${filter.category}|${filter.finishedOnly ? 1 : 0}|${filter.noteType}|${filter.trendGranularity}`;
}
function normalizeDays(days) {
    if (!Number.isFinite(days) || days === 0) {
        return 0;
    }
    return Math.max(1, Math.floor(days));
}
function buildDataVersion(storage, books, noteMap, accountId) {
    const syncState = storage.getSyncState(accountId);
    const noteBookCount = Object.keys(noteMap).length;
    const noteCount = Object.values(noteMap).reduce((sum, notes) => sum + notes.length, 0);
    return `${syncState.lastSyncTime || 0}|${books.length}|${noteBookCount}|${noteCount}`;
}
function buildIndexDataVersion(books, noteMap, accountId) {
    const noteBookCount = Object.keys(noteMap).length;
    const noteCount = Object.values(noteMap).reduce((sum, notes) => sum + notes.length, 0);
    const latestBookTs = books.reduce((max, book) => Math.max(max, normalizeBookTimestamp(book.lastReadTime)), 0);
    return `${String(accountId || 'default')}|${latestBookTs}|${books.length}|${noteBookCount}|${noteCount}`;
}
function normalizeNoteType(noteType) {
    if (!noteType || noteType === 'all') {
        return 'all';
    }
    if (noteType === 'highlight' || noteType === 'thought' || noteType === 'chapter' || noteType === 'review') {
        return noteType;
    }
    return 'all';
}
function normalizeTrendGranularity(value) {
    return value === 'week' ? 'week' : 'day';
}
function matchesNoteType(note, noteType) {
    if (noteType === 'all') {
        return true;
    }
    if (noteType === 'highlight') {
        return note.type === models_1.NoteType.Highlight;
    }
    if (noteType === 'thought') {
        return note.type === models_1.NoteType.Thought;
    }
    if (noteType === 'chapter') {
        return note.type === models_1.NoteType.Chapter;
    }
    return note.type === models_1.NoteType.Review;
}
function calculateLongestStreak(dayKeys) {
    if (dayKeys.length === 0) {
        return 0;
    }
    let longest = 1;
    let current = 1;
    for (let i = 1; i < dayKeys.length; i++) {
        const prev = toDate(dayKeys[i - 1]);
        const curr = toDate(dayKeys[i]);
        if (!prev || !curr) {
            continue;
        }
        const diff = Math.round((curr.getTime() - prev.getTime()) / DAY_MS);
        if (diff === 1) {
            current += 1;
            longest = Math.max(longest, current);
        }
        else {
            current = 1;
        }
    }
    return longest;
}
function noteTimestampMs(note) {
    const raw = note.modifyTime || note.createTime || 0;
    return raw > 1000000000000 ? raw : raw * 1000;
}
function resolveStartAt(books, noteMap, now, days) {
    if (days > 0) {
        return startOfDay(now - (days - 1) * DAY_MS);
    }
    const noteTimestamps = Object.values(noteMap)
        .flat()
        .map((note) => noteTimestampMs(note))
        .filter((ts) => ts > 0);
    const bookTimestamps = books
        .map((book) => normalizeBookTimestamp(book.lastReadTime))
        .filter((ts) => ts > 0);
    const earliest = Math.min(...noteTimestamps, ...bookTimestamps);
    if (!Number.isFinite(earliest)) {
        return startOfDay(now);
    }
    return startOfDay(Math.min(earliest, now));
}
function normalizeBookTimestamp(raw) {
    if (!raw || !Number.isFinite(raw)) {
        return 0;
    }
    return raw > 1000000000000 ? raw : raw * 1000;
}
function isDeepNote(note) {
    const thoughtLength = (note.thoughtText || '').trim().length;
    const highlightLength = (note.highlightText || '').trim().length;
    return thoughtLength >= 50 || highlightLength >= 100;
}
function normalizeScore(notesCount, deepNoteRatio, completionRate) {
    const notesScore = Math.min(100, notesCount * 5);
    return notesScore * 0.5 + deepNoteRatio * 0.3 + completionRate * 0.2;
}
function resolveNoteType(note) {
    if (note.thoughtText && note.highlightText) {
        return '划线+想法';
    }
    if (note.thoughtText) {
        return '想法';
    }
    if (note.highlightText) {
        return '划线';
    }
    return '笔记';
}
function trimText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}...`;
}
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function dayKeyFromMs(timestamp) {
    return formatDate(timestamp);
}
function startOfDay(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}
function startOfWeek(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date.getTime();
}
function formatWeekLabel(weekStartTs) {
    const date = new Date(weekStartTs);
    const year = date.getFullYear();
    const week = getIsoWeek(date);
    return `${year}-W${String(week).padStart(2, '0')}`;
}
function getIsoWeek(date) {
    const workingDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = workingDate.getUTCDay() || 7;
    workingDate.setUTCDate(workingDate.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
    return Math.ceil(((workingDate.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}
function toDate(dayKey) {
    const parsed = new Date(`${dayKey}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return parsed;
}
function toPercent(value) {
    return round2(value * 100);
}
function clampRate(progress) {
    if (!Number.isFinite(progress)) {
        return 0;
    }
    return Math.max(0, Math.min(100, progress));
}
function round2(value) {
    return Math.round(value * 100) / 100;
}
function percentile(values, ratio) {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
    return sorted[index];
}
function extractTotalPages(book) {
    const raw = book.totalPages
        ?? book.total_pages
        ?? book.pageCount
        ?? 0;
    if (!Number.isFinite(raw)) {
        return 0;
    }
    return Math.max(0, Number(raw));
}
let analyticsServiceInstance;
function getAnalyticsService() {
    if (!analyticsServiceInstance) {
        analyticsServiceInstance = new AnalyticsService();
    }
    return analyticsServiceInstance;
}
exports.getAnalyticsService = getAnalyticsService;
//# sourceMappingURL=analyticsService.js.map