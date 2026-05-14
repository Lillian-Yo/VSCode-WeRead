import { getStorageService } from './storageService';
import { getExportService } from './exportService';
import { getLocalDataService } from './localDataService';
import { Book, Note } from '../models';
import { getConfiguredOutputPath } from '../utils';

export type MementoMigrationResult = {
  success: boolean;
  totalBooks: number;
  exportedBooks: number;
  skippedBooks: number;
  failedBooks: number;
  errors: Array<{ bookId: string; title: string; message: string }>;
};

export class MigrationService {
  async migrateMementoToFiles(): Promise<MementoMigrationResult> {
    const outputPath = getConfiguredOutputPath();
    if (!outputPath) {
      throw new Error('未设置笔记保存目录，请先配置 weread.outputPath');
    }

    const storage = getStorageService();
    const exportService = getExportService();
    const books = storage.getBooks();
    const result: MementoMigrationResult = {
      success: true,
      totalBooks: books.length,
      exportedBooks: 0,
      skippedBooks: 0,
      failedBooks: 0,
      errors: [],
    };

    for (const book of books) {
      const notes = storage.getNotes(book.bookId);
      if (!this.shouldExportBook(book, notes)) {
        result.skippedBooks += 1;
        continue;
      }
      const exported = await exportService.exportBookForSyncWithNotes(book, notes);
      if (exported.success) {
        result.exportedBooks += 1;
        continue;
      }
      result.failedBooks += 1;
      result.errors.push({
        bookId: book.bookId,
        title: book.title,
        message: exported.error || '迁移失败',
      });
    }

    try {
      const reload = await getLocalDataService().reloadFromConfiguredPath();
      if (result.exportedBooks > 0 && reload.booksCount === 0) {
        throw new Error('迁移已导出文件，但索引未扫描到书籍，请检查 weread.outputPath 与目录权限');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '索引重建失败');
      throw new Error(`迁移后索引重建失败：${message}`);
    }

    result.success = result.failedBooks === 0;
    return result;
  }

  private shouldExportBook(book: Book, notes: Note[]): boolean {
    if (notes.length > 0) {
      return true;
    }
    if ((book.noteCount || 0) > 0 || (book.highlightCount || 0) > 0 || (book.reviewCount || 0) > 0) {
      return true;
    }
    return false;
  }
}

let migrationServiceInstance: MigrationService | undefined;

export function getMigrationService(): MigrationService {
  if (!migrationServiceInstance) {
    migrationServiceInstance = new MigrationService();
  }
  return migrationServiceInstance;
}
