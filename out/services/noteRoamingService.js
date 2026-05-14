"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNoteRoamingService = exports.NoteRoamingService = exports.resolveRoamingChapterKey = exports.resolveRoamingNoteKey = void 0;
const crypto_1 = require("crypto");
const auth_1 = require("../auth");
const models_1 = require("../models");
const indexService_1 = require("./indexService");
const storageService_1 = require("./storageService");
function normalizeSecToMs(value) {
    if (!value || !Number.isFinite(value)) {
        return undefined;
    }
    return value > 1000000000000 ? Math.floor(value) : Math.floor(value * 1000);
}
function truncateText(text, maxLen = 200) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLen) {
        return normalized;
    }
    return `${normalized.slice(0, maxLen - 1)}…`;
}
function toFilterType(noteType) {
    if (noteType === models_1.NoteType.Thought) {
        return 'thought';
    }
    if (noteType === models_1.NoteType.Chapter) {
        return 'chapter';
    }
    if (noteType === models_1.NoteType.Review) {
        return 'review';
    }
    return 'highlight';
}
function buildFallbackNoteKey(note) {
    const chapterPart = String(note.chapterUid || 0);
    const textPart = `${note.highlightText || ''}|${note.thoughtText || ''}|${note.chapterTitle || ''}`.trim();
    const hash = (0, crypto_1.createHash)('sha1').update(textPart).digest('hex').slice(0, 12);
    return `${note.bookId}:${chapterPart}:${hash}`;
}
function isVolatileLocalNoteId(noteId) {
    return /^local_[a-z0-9]+_\d{9,}$/i.test(noteId);
}
function resolveRoamingNoteKey(note) {
    const noteId = String(note.noteId || '').trim();
    if (noteId && !isVolatileLocalNoteId(noteId)) {
        return noteId;
    }
    return buildFallbackNoteKey(note);
}
exports.resolveRoamingNoteKey = resolveRoamingNoteKey;
function resolveRoamingChapterKey(candidate) {
    return `${candidate.bookId}:${candidate.chapterUid || 0}`;
}
exports.resolveRoamingChapterKey = resolveRoamingChapterKey;
class NoteRoamingService {
    constructor(deps = {
        indexService: (0, indexService_1.getIndexService)(),
        storageService: (0, storageService_1.getStorageService)(),
        getActiveAccountId: () => (0, auth_1.getCookieManager)().getActiveAccountId(),
    }) {
        this.deps = deps;
        this.poolCache = new Map();
        this.poolCacheTtlMs = 30000;
    }
    buildFilterKey(filter) {
        const noteTypes = (filter.noteTypes || []).slice().sort().join(',');
        const favoriteOnly = filter.favoriteOnly ? '1' : '0';
        const days = Number(filter.minDaysUnreviewed || 0);
        return `${noteTypes}|${favoriteOnly}|${days}`;
    }
    resolveAccountId(accountId) {
        const normalized = String(accountId || '').trim();
        if (normalized) {
            return normalized;
        }
        return this.deps.getActiveAccountId();
    }
    async getCandidatePool(filter = {}, accountId) {
        const resolvedAccountId = this.resolveAccountId(accountId);
        const cacheKey = `${resolvedAccountId || 'default'}::${this.buildFilterKey(filter)}`;
        const cached = this.poolCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        const books = await this.deps.indexService.queryBooks(resolvedAccountId);
        const meta = this.deps.storageService.getRoamingMeta(resolvedAccountId);
        const candidates = [];
        const seenKeys = new Set();
        for (const book of books) {
            const notes = await this.deps.indexService.getNotesByBookId(book.bookId, resolvedAccountId);
            for (const note of notes) {
                const bookId = String(note.bookId || book.bookId || '').trim();
                if (!bookId) {
                    continue;
                }
                const noteKey = resolveRoamingNoteKey(note);
                if (seenKeys.has(noteKey)) {
                    continue;
                }
                const metaRecord = this.resolveMetaRecord(meta, noteKey, note.noteId);
                if (!this.matchesFilter(note, metaRecord, filter)) {
                    continue;
                }
                const text = truncateText(note.thoughtText || note.highlightText || note.chapterTitle || '');
                if (!text) {
                    continue;
                }
                seenKeys.add(noteKey);
                candidates.push({
                    noteKey,
                    noteId: note.noteId,
                    bookId,
                    bookTitle: book.title,
                    bookAuthor: book.author,
                    author: book.author ? String(book.author).trim() : undefined,
                    category: book.category,
                    chapterUid: Number(note.chapterUid || 0),
                    chapterTitle: note.chapterTitle,
                    noteType: note.type,
                    text,
                    createTime: Number(note.createTime || 0),
                    meta: metaRecord,
                });
            }
        }
        const sorted = candidates.sort((a, b) => b.createTime - a.createTime);
        this.poolCache.set(cacheKey, {
            data: sorted,
            expiresAt: Date.now() + this.poolCacheTtlMs,
        });
        if (this.poolCache.size > 20) {
            const oldestKey = this.poolCache.keys().next().value;
            if (oldestKey) {
                this.poolCache.delete(oldestKey);
            }
        }
        return sorted;
    }
    pickNext(candidates, options = {}) {
        if (candidates.length === 0) {
            return { totalCandidates: 0, eligibleCandidates: 0, reason: 'empty_pool' };
        }
        const nowMs = options.nowMs || Date.now();
        const cooldownMs = options.cooldownMs ?? 6 * 60 * 60 * 1000;
        const recentNotes = new Set((options.recentNoteKeys || []).filter(Boolean));
        const recentChapters = new Set((options.recentChapterKeys || []).filter(Boolean));
        const recentBooks = new Set((options.recentBookIds || []).filter(Boolean));
        const filtered = candidates.filter((item) => {
            if (recentNotes.has(item.noteKey)) {
                return false;
            }
            if (recentBooks.has(item.bookId)) {
                return false;
            }
            const chapterKey = resolveRoamingChapterKey(item);
            if (recentChapters.has(chapterKey)) {
                return false;
            }
            const lastSeenAt = item.meta.lastSeenAt || 0;
            if (lastSeenAt > 0 && nowMs - lastSeenAt < cooldownMs) {
                return false;
            }
            return true;
        });
        if (filtered.length === 0) {
            const fallbackPicked = this.weightedPick(candidates, options.rng);
            return {
                candidate: fallbackPicked,
                totalCandidates: candidates.length,
                eligibleCandidates: 0,
                reason: 'cooldown_filtered',
            };
        }
        const picked = this.weightedPick(filtered, options.rng);
        return {
            candidate: picked,
            totalCandidates: candidates.length,
            eligibleCandidates: filtered.length,
        };
    }
    async recordAction(noteKey, action, accountId) {
        const resolvedAccountId = this.resolveAccountId(accountId);
        const now = Date.now();
        const patch = { lastSeenAt: now, seenCount: 1 };
        if (action === 'review') {
            patch.lastReviewedAt = now;
            patch.reviewCount = 1;
        }
        if (action === 'skip') {
            patch.skipCount = 1;
        }
        if (action === 'openSource') {
            patch.openSourceCount = 1;
        }
        if (action === 'favorite') {
            patch.favorite = true;
            patch.favoriteAt = now;
        }
        if (action === 'unfavorite') {
            patch.favorite = false;
            patch.favoriteAt = undefined;
        }
        const current = this.deps.storageService.getRoamingMeta(resolvedAccountId).records[noteKey];
        await this.deps.storageService.upsertRoamingNoteMeta(noteKey, {
            noteId: current?.noteId || noteKey,
            lastSeenAt: now,
            seenCount: (current?.seenCount || 0) + 1,
            reviewCount: (current?.reviewCount || 0) + Number(patch.reviewCount || 0),
            skipCount: (current?.skipCount || 0) + Number(patch.skipCount || 0),
            openSourceCount: (current?.openSourceCount || 0) + Number(patch.openSourceCount || 0),
            lastReviewedAt: patch.lastReviewedAt || current?.lastReviewedAt,
            favorite: patch.favorite ?? current?.favorite ?? false,
            favoriteAt: patch.favoriteAt ?? current?.favoriteAt,
        }, resolvedAccountId);
        this.clearPoolCache(resolvedAccountId);
    }
    clearPoolCache(accountId) {
        const target = this.resolveAccountId(accountId);
        if (!target) {
            this.poolCache.clear();
            return;
        }
        for (const key of Array.from(this.poolCache.keys())) {
            if (key.startsWith(`${target}::`)) {
                this.poolCache.delete(key);
            }
        }
    }
    weightedPick(items, rng) {
        const random = typeof rng === 'function' ? rng : Math.random;
        const weighted = items.map((item) => {
            const favoriteBonus = item.meta.favorite ? 1.5 : 0;
            const reviewPenalty = Math.min(item.meta.reviewCount * 0.2, 1.2);
            const skipPenalty = Math.min(item.meta.skipCount * 0.12, 1.2);
            const sourceBonus = Math.min(item.meta.openSourceCount * 0.08, 0.8);
            const score = Math.max(0.1, 1 + favoriteBonus + sourceBonus - reviewPenalty - skipPenalty);
            return { item, score };
        });
        const total = weighted.reduce((sum, cur) => sum + cur.score, 0);
        let cursor = random() * total;
        for (const entry of weighted) {
            cursor -= entry.score;
            if (cursor <= 0) {
                return entry.item;
            }
        }
        return weighted[weighted.length - 1].item;
    }
    matchesFilter(note, metaRecord, filter) {
        if (filter.noteTypes && filter.noteTypes.length > 0) {
            const mapped = toFilterType(note.type);
            if (!filter.noteTypes.includes(mapped)) {
                return false;
            }
        }
        if (filter.favoriteOnly && !metaRecord.favorite) {
            return false;
        }
        if ((filter.minDaysUnreviewed || 0) > 0) {
            const thresholdMs = (filter.minDaysUnreviewed || 0) * 24 * 60 * 60 * 1000;
            const lastReviewedAtMs = normalizeSecToMs(metaRecord.lastReviewedAt);
            if (lastReviewedAtMs && Date.now() - lastReviewedAtMs < thresholdMs) {
                return false;
            }
        }
        return true;
    }
    resolveMetaRecord(meta, noteKey, noteId) {
        const current = meta.records[noteKey];
        if (current) {
            return current;
        }
        const normalizedNoteId = String(noteId || '').trim();
        if (normalizedNoteId) {
            for (const item of Object.values(meta.records || {})) {
                if (String(item?.noteId || '').trim() === normalizedNoteId) {
                    return item;
                }
            }
        }
        return {
            noteKey,
            noteId: normalizedNoteId || undefined,
            favorite: false,
            reviewCount: 0,
            skipCount: 0,
            openSourceCount: 0,
            seenCount: 0,
            updatedAt: 0,
        };
    }
}
exports.NoteRoamingService = NoteRoamingService;
let noteRoamingServiceInstance;
function getNoteRoamingService() {
    if (!noteRoamingServiceInstance) {
        noteRoamingServiceInstance = new NoteRoamingService();
    }
    return noteRoamingServiceInstance;
}
exports.getNoteRoamingService = getNoteRoamingService;
//# sourceMappingURL=noteRoamingService.js.map
