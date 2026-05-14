/**
 * 数据差异检测服务
 * 用于检测本地和云端数据的变更
 */

import { Book, Note, BookSyncState } from '../models';

export interface BookDiff {
  bookId: string;
  title: string;
  needsSync: boolean;
  changes: {
    progressChanged: boolean;
    highlightCountChanged: boolean;
    noteCountChanged: boolean;
  };
}

export interface SyncPlan {
  booksToSync: Book[];
  totalBooks: number;
}

export class DiffService {
  /**
   * 检测书籍变更
   */
  detectBookChanges(localBooks: Book[], remoteBooks: Book[]): BookDiff[] {
    const localMap = new Map(localBooks.map((b) => [b.bookId, b]));
    const diffs: BookDiff[] = [];

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
      } else {
        // 检测变更
        const changes = {
          progressChanged: localBook.progress !== remoteBook.progress,
          highlightCountChanged: localBook.highlightCount !== remoteBook.highlightCount,
          noteCountChanged: localBook.noteCount !== remoteBook.noteCount,
        };

        const needsSync =
          changes.progressChanged ||
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
  generateSyncPlan(diffs: BookDiff[], remoteBooks: Book[]): SyncPlan {
    const booksToSync = diffs
      .filter((diff) => diff.needsSync)
      .map((diff) => remoteBooks.find((b) => b.bookId === diff.bookId)!)
      .filter(Boolean);

    return {
      booksToSync,
      totalBooks: booksToSync.length,
    };
  }

  /**
   * 检测笔记变更
   */
  detectNoteChanges(localNotes: Note[], remoteNotes: Note[]): {
    added: Note[];
    modified: Note[];
    deleted: Note[];
  } {
    const localMap = new Map(localNotes.map((n) => [n.noteId, n]));
    const remoteMap = new Map(remoteNotes.map((n) => [n.noteId, n]));

    const added: Note[] = [];
    const modified: Note[] = [];
    const deleted: Note[] = [];

    // 检测新增和修改
    for (const remoteNote of remoteNotes) {
      const localNote = localMap.get(remoteNote.noteId);

      if (!localNote) {
        added.push(remoteNote);
      } else if (this.isNoteChanged(localNote, remoteNote)) {
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
  private isNoteChanged(local: Note, remote: Note): boolean {
    return (
      local.highlightText !== remote.highlightText ||
      local.thoughtText !== remote.thoughtText ||
      local.modifyTime !== remote.modifyTime
    );
  }

  /**
   * 获取书籍同步状态
   */
  getBookSyncState(book: Book, lastSyncTime: number): BookSyncState {
    return {
      bookId: book.bookId,
      lastSyncTime,
      localNoteCount: book.noteCount,
      remoteNoteCount: book.noteCount,
      needsSync: false,
    };
  }
}

let diffServiceInstance: DiffService | undefined;

export function getDiffService(): DiffService {
  if (!diffServiceInstance) {
    diffServiceInstance = new DiffService();
  }
  return diffServiceInstance;
}
