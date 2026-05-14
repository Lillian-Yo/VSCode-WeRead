"use strict";
/**
 * 存储服务
 * 使用 VSCode Memento 存储同步数据
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageService = exports.getStorageService = exports.initializeStorageService = exports.StorageService = exports.CURRENT_INDEX_SCHEMA_VERSION = void 0;
const models_1 = require("../models");
/** @deprecated 迁移期兼容键：后续切换到文件真源后移除 */
const BOOKS_KEY = 'weread.books';
/** @deprecated 迁移期兼容键：后续切换到文件真源后移除 */
const NOTES_KEY = 'weread.notes';
const SYNC_STATE_KEY = 'weread.syncState';
const DAILY_AGG_KEY = 'weread.dailyAgg';
const INDEX_VERSION_KEY = 'weread.index.version';
const INDEX_SNAPSHOT_KEY = 'weread.index.snapshot';
const INDEX_SCAN_STATE_KEY = 'weread.index.scanState';
const ROAMING_META_KEY = 'weread.roaming.meta';
const DATA_VERSION_KEY = 'weread.dataVersion';
const CURRENT_DATA_VERSION = 1;
exports.CURRENT_INDEX_SCHEMA_VERSION = 1;
class StorageService {
    constructor(context) {
        this.globalState = context.globalState;
    }
    scopedKey(baseKey, accountId) {
        const normalized = String(accountId || '').trim();
        return normalized ? `${baseKey}.${normalized}` : baseKey;
    }
    /**
     * 初始化存储
     */
    async initialize() {
        const version = this.globalState.get(DATA_VERSION_KEY, 0);
        if (version < CURRENT_DATA_VERSION) {
            // 数据迁移逻辑
            await this.migrateData(version);
            await this.globalState.update(DATA_VERSION_KEY, CURRENT_DATA_VERSION);
        }
    }
    /**
     * 数据迁移
     */
    async migrateData(fromVersion) {
        // 当前版本为初始版本，无需迁移
        if (fromVersion === 0) {
            return;
        }
        // 后续版本添加迁移逻辑
    }
    /**
     * 保存书籍列表
     * @deprecated 迁移期兼容接口：文件真源模式下不再写入完整书籍列表。
     */
    async saveBooks(books, accountId) {
        await this.globalState.update(this.scopedKey(BOOKS_KEY, accountId), books);
    }
    /**
     * 批量替换书籍与笔记数据，并重建 daily_agg
     * @deprecated 迁移期兼容接口：文件真源模式下由索引构建替代。
     */
    async replaceBooksAndNotes(books, notesByBook, accountId) {
        await this.globalState.update(this.scopedKey(BOOKS_KEY, accountId), books);
        await this.globalState.update(this.scopedKey(NOTES_KEY, accountId), notesByBook);
        await this.rebuildDailyAggFromNotes(accountId);
    }
    /**
     * 获取书籍列表
     * @deprecated 迁移期兼容接口：文件真源模式下改为读取索引快照。
     */
    getBooks(accountId) {
        return this.globalState.get(this.scopedKey(BOOKS_KEY, accountId), []);
    }
    /**
     * 获取单本书籍
     * @deprecated 迁移期兼容接口：文件真源模式下改为按 filePath 回源读取。
     */
    getBook(bookId, accountId) {
        const books = this.getBooks(accountId);
        return books.find((b) => b.bookId === bookId);
    }
    /**
     * 保存笔记
     * @deprecated 迁移期兼容接口：文件真源模式下不再写入完整笔记。
     */
    async saveNotes(bookId, notes, accountId) {
        const allNotes = this.getAllNotes(accountId);
        allNotes[bookId] = notes;
        await this.globalState.update(this.scopedKey(NOTES_KEY, accountId), allNotes);
    }
    /**
     * 获取书籍的笔记
     * @deprecated 迁移期兼容接口：文件真源模式下改为按文件读取。
     */
    getNotes(bookId, accountId) {
        const allNotes = this.getAllNotes(accountId);
        return allNotes[bookId] || [];
    }
    /**
     * 获取所有笔记
     * @deprecated 迁移期兼容接口：文件真源模式下改为扫描索引/文件。
     */
    getAllNotes(accountId) {
        return this.globalState.get(this.scopedKey(NOTES_KEY, accountId), {});
    }
    /**
     * 获取所有笔记（扁平化）
     * @deprecated 迁移期兼容接口：文件真源模式下改为索引聚合。
     */
    getAllNotesFlat(accountId) {
        const allNotes = this.getAllNotes(accountId);
        return Object.values(allNotes).flat();
    }
    /**
     * 保存每日聚合数据
     */
    async saveDailyAgg(records, accountId) {
        const normalized = [...records].sort((a, b) => a.date.localeCompare(b.date));
        await this.globalState.update(this.scopedKey(DAILY_AGG_KEY, accountId), normalized);
    }
    /**
     * 获取每日聚合数据
     */
    getDailyAgg(accountId) {
        return this.globalState.get(this.scopedKey(DAILY_AGG_KEY, accountId), []);
    }
    /**
     * 基于当前本地笔记重建 daily_agg（幂等）
     */
    async rebuildDailyAggFromNotes(accountId) {
        const notes = this.getAllNotesFlat(accountId);
        const dailyMap = new Map();
        for (const note of notes) {
            const timestamp = this.normalizeTimestampMs(note.modifyTime || note.createTime || 0);
            if (!timestamp) {
                continue;
            }
            const date = this.formatDate(timestamp);
            const current = dailyMap.get(date);
            if (current) {
                current.notesCount += 1;
                current.booksTouched.add(note.bookId);
                continue;
            }
            dailyMap.set(date, {
                notesCount: 1,
                booksTouched: new Set([note.bookId]),
            });
        }
        const records = Array.from(dailyMap.entries())
            .map(([date, value]) => ({
            date,
            readDaysFlag: (value.notesCount > 0 ? 1 : 0),
            notesCount: value.notesCount,
            booksTouched: value.booksTouched.size,
        }))
            .sort((a, b) => a.date.localeCompare(b.date));
        await this.saveDailyAgg(records, accountId);
        return records;
    }
    /**
     * 获取笔记漫游元数据（账号维度）
     */
    getRoamingMeta(accountId) {
        const raw = this.globalState.get(this.scopedKey(ROAMING_META_KEY, accountId));
        if (!raw || typeof raw !== 'object' || !raw.records) {
            return { version: 1, records: {}, updatedAt: 0 };
        }
        const records = {};
        for (const [key, value] of Object.entries(raw.records || {})) {
            if (!value || typeof value !== 'object') {
                continue;
            }
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) {
                continue;
            }
            records[normalizedKey] = this.normalizeRoamingMetaRecord({
                ...value,
                noteKey: normalizedKey,
            });
        }
        return {
            version: 1,
            records,
            updatedAt: Number(raw.updatedAt || 0),
        };
    }
    /**
     * 保存笔记漫游元数据（账号维度）
     */
    async saveRoamingMeta(meta, accountId) {
        const records = {};
        for (const [key, value] of Object.entries(meta.records || {})) {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) {
                continue;
            }
            records[normalizedKey] = this.normalizeRoamingMetaRecord({
                ...value,
                noteKey: normalizedKey,
            });
        }
        await this.globalState.update(this.scopedKey(ROAMING_META_KEY, accountId), {
            version: 1,
            records,
            updatedAt: Number(meta.updatedAt || Date.now()),
        });
    }
    /**
     * 读取单条漫游元数据
     */
    getRoamingNoteMeta(noteKey, accountId) {
        const key = String(noteKey || '').trim();
        if (!key) {
            return undefined;
        }
        const meta = this.getRoamingMeta(accountId);
        return meta.records[key];
    }
    /**
     * 更新单条漫游元数据（不存在则创建）
     */
    async upsertRoamingNoteMeta(noteKey, patch, accountId) {
        const key = String(noteKey || '').trim();
        if (!key) {
            throw new Error('无效 noteKey');
        }
        const meta = this.getRoamingMeta(accountId);
        const now = Date.now();
        const current = meta.records[key];
        const seed = {
            noteKey: key,
            favorite: false,
            reviewCount: 0,
            skipCount: 0,
            openSourceCount: 0,
            seenCount: 0,
            updatedAt: now,
        };
        const next = {
            ...seed,
            ...(current || {}),
            ...patch,
            noteKey: key,
            updatedAt: now,
        };
        const normalized = this.normalizeRoamingMetaRecord(next);
        meta.records[key] = normalized;
        meta.updatedAt = now;
        await this.saveRoamingMeta(meta, accountId);
        return normalized;
    }
    /**
     * 保存同步状态
     */
    async saveSyncState(state, accountId) {
        await this.globalState.update(this.scopedKey(SYNC_STATE_KEY, accountId), state);
    }
    /**
     * 获取同步状态
     */
    getSyncState(accountId) {
        return (this.globalState.get(this.scopedKey(SYNC_STATE_KEY, accountId)) || {
            lastSyncTime: 0,
            status: models_1.SyncStatus.Idle,
            dataVersion: CURRENT_DATA_VERSION,
        });
    }
    /**
     * 更新同步状态
     */
    async updateSyncStatus(status, error, accountId) {
        const state = this.getSyncState(accountId);
        state.status = status;
        state.error = error;
        if (status === models_1.SyncStatus.Success) {
            state.lastSyncTime = Date.now();
        }
        await this.saveSyncState(state, accountId);
    }
    /**
     * 保存索引快照（文件真源模式）
     */
    async saveIndexSnapshot(snapshot, accountId) {
        await this.globalState.update(this.scopedKey(INDEX_SNAPSHOT_KEY, accountId), snapshot);
        await this.globalState.update(this.scopedKey(INDEX_VERSION_KEY, accountId), snapshot.schemaVersion || exports.CURRENT_INDEX_SCHEMA_VERSION);
    }
    /**
     * 获取索引快照
     */
    getIndexSnapshot(accountId) {
        return this.globalState.get(this.scopedKey(INDEX_SNAPSHOT_KEY, accountId));
    }
    /**
     * 获取索引结构版本
     */
    getIndexVersion(accountId) {
        return this.globalState.get(this.scopedKey(INDEX_VERSION_KEY, accountId), 0);
    }
    /**
     * 清理索引快照与版本
     */
    async clearIndexSnapshot(accountId) {
        await this.globalState.update(this.scopedKey(INDEX_SNAPSHOT_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(INDEX_VERSION_KEY, accountId), undefined);
    }
    /**
     * 保存最近扫描状态
     */
    async saveIndexScanState(state, accountId) {
        await this.globalState.update(this.scopedKey(INDEX_SCAN_STATE_KEY, accountId), state);
    }
    /**
     * 获取最近扫描状态
     */
    getIndexScanState(accountId) {
        return this.globalState.get(this.scopedKey(INDEX_SCAN_STATE_KEY, accountId));
    }
    /**
     * 清理扫描状态
     */
    async clearIndexScanState(accountId) {
        await this.globalState.update(this.scopedKey(INDEX_SCAN_STATE_KEY, accountId), undefined);
    }
    /**
     * 清除所有数据
     */
    async clearAll(accountId) {
        await this.globalState.update(this.scopedKey(BOOKS_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(NOTES_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(SYNC_STATE_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(DAILY_AGG_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(INDEX_VERSION_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(INDEX_SNAPSHOT_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(INDEX_SCAN_STATE_KEY, accountId), undefined);
        await this.globalState.update(this.scopedKey(ROAMING_META_KEY, accountId), undefined);
    }
    /**
     * 获取书籍详情（包含笔记）
     */
    getBookDetail(bookId, accountId) {
        const book = this.getBook(bookId, accountId);
        if (!book) {
            return undefined;
        }
        const notes = this.getNotes(bookId, accountId);
        return {
            ...book,
            chapters: [],
            notes,
        };
    }
    normalizeTimestampMs(raw) {
        if (!raw || !Number.isFinite(raw)) {
            return 0;
        }
        return raw > 1000000000000 ? raw : raw * 1000;
    }
    formatDate(timestamp) {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    normalizeRoamingMetaRecord(input) {
        const toCount = (value) => {
            const num = Number(value || 0);
            if (!Number.isFinite(num) || num < 0) {
                return 0;
            }
            return Math.floor(num);
        };
        const toMaybeTs = (value) => {
            const num = Number(value || 0);
            if (!Number.isFinite(num) || num <= 0) {
                return undefined;
            }
            return Math.floor(num);
        };
        const noteKey = String(input.noteKey || '').trim();
        return {
            noteKey,
            noteId: String(input.noteId || '').trim() || undefined,
            favorite: !!input.favorite,
            favoriteAt: toMaybeTs(input.favoriteAt),
            lastReviewedAt: toMaybeTs(input.lastReviewedAt),
            reviewCount: toCount(input.reviewCount),
            skipCount: toCount(input.skipCount),
            openSourceCount: toCount(input.openSourceCount),
            seenCount: toCount(input.seenCount),
            lastSeenAt: toMaybeTs(input.lastSeenAt),
            updatedAt: toMaybeTs(input.updatedAt) || Date.now(),
        };
    }
}
exports.StorageService = StorageService;
let storageServiceInstance;
exports.storageService = storageServiceInstance;
function initializeStorageService(context) {
    exports.storageService = storageServiceInstance = new StorageService(context);
    return storageServiceInstance;
}
exports.initializeStorageService = initializeStorageService;
function getStorageService() {
    if (!storageServiceInstance) {
        throw new Error('StorageService not initialized');
    }
    return storageServiceInstance;
}
exports.getStorageService = getStorageService;
//# sourceMappingURL=storageService.js.map