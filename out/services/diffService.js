"use strict";
/**
 * 数据差异检测服务
 * 用于检测本地和云端数据的变更
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiffService = exports.DiffService = void 0;
class DiffService {
    /**
     * 检测书籍变更
     */
    detectBookChanges(localBooks, remoteBooks) {
        const localMap = new Map(localBooks.map((b) => [b.bookId, b]));
        const diffs = [];
        for (const remoteBook of remoteBooks) {
            const localBook = localMap.get(remoteBook.bookId);
            if (!localBook) {
                // 新书籍，需要同步
                diffs.push({
                    bookId: remoteBook.bookId,
                    title: remoteBook.title,
                    needsSync: true,
                    changes: {
                        progressChanged: true,
                        highlightCountChanged: true,
                        noteCountChanged: true,
                    },
                });
            }
            else {
                // 检测变更
                const changes = {
                    progressChanged: localBook.progress !== remoteBook.progress,
                    highlightCountChanged: localBook.highlightCount !== remoteBook.highlightCount,
                    noteCountChanged: localBook.noteCount !== remoteBook.noteCount,
                };
                const needsSync = changes.progressChanged ||
                    changes.highlightCountChanged ||
                    changes.noteCountChanged;
                diffs.push({
                    bookId: remoteBook.bookId,
                    title: remoteBook.title,
                    needsSync,
                    changes,
                });
            }
        }
        // 检测已删除的书籍（本地有，云端没有）- 可选实现
        return diffs;
    }
    /**
     * 生成同步计划
     */
    generateSyncPlan(diffs, remoteBooks) {
        const booksToSync = diffs
            .filter((diff) => diff.needsSync)
            .map((diff) => remoteBooks.find((b) => b.bookId === diff.bookId))
            .filter(Boolean);
        return {
            booksToSync,
            totalBooks: booksToSync.length,
        };
    }
    /**
     * 检测笔记变更
     */
    detectNoteChanges(localNotes, remoteNotes) {
        const localMap = new Map(localNotes.map((n) => [n.noteId, n]));
        const remoteMap = new Map(remoteNotes.map((n) => [n.noteId, n]));
        const added = [];
        const modified = [];
        const deleted = [];
        // 检测新增和修改
        for (const remoteNote of remoteNotes) {
            const localNote = localMap.get(remoteNote.noteId);
            if (!localNote) {
                added.push(remoteNote);
            }
            else if (this.isNoteChanged(localNote, remoteNote)) {
                modified.push(remoteNote);
            }
        }
        // 检测删除
        for (const localNote of localNotes) {
            if (!remoteMap.has(localNote.noteId)) {
                deleted.push(localNote);
            }
        }
        return { added, modified, deleted };
    }
    /**
     * 判断笔记是否变更
     */
    isNoteChanged(local, remote) {
        return (local.highlightText !== remote.highlightText ||
            local.thoughtText !== remote.thoughtText ||
            local.modifyTime !== remote.modifyTime);
    }
    /**
     * 获取书籍同步状态
     */
    getBookSyncState(book, lastSyncTime) {
        return {
            bookId: book.bookId,
            lastSyncTime,
            localNoteCount: book.noteCount,
            remoteNoteCount: book.noteCount,
            needsSync: false,
        };
    }
}
exports.DiffService = DiffService;
let diffServiceInstance;
function getDiffService() {
    if (!diffServiceInstance) {
        diffServiceInstance = new DiffService();
    }
    return diffServiceInstance;
}
exports.getDiffService = getDiffService;
//# sourceMappingURL=diffService.js.map