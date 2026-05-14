"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMigrationService = exports.MigrationService = void 0;
const storageService_1 = require("./storageService");
const exportService_1 = require("./exportService");
const localDataService_1 = require("./localDataService");
const utils_1 = require("../utils");
class MigrationService {
    async migrateMementoToFiles() {
        const outputPath = (0, utils_1.getConfiguredOutputPath)();
        if (!outputPath) {
            throw new Error('未设置笔记保存目录，请先配置 weread.outputPath');
        }
        const storage = (0, storageService_1.getStorageService)();
        const exportService = (0, exportService_1.getExportService)();
        const books = storage.getBooks();
        const result = {
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
            const reload = await (0, localDataService_1.getLocalDataService)().reloadFromConfiguredPath();
            if (result.exportedBooks > 0 && reload.booksCount === 0) {
                throw new Error('迁移已导出文件，但索引未扫描到书籍，请检查 weread.outputPath 与目录权限');
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error || '索引重建失败');
            throw new Error(`迁移后索引重建失败：${message}`);
        }
        result.success = result.failedBooks === 0;
        return result;
    }
    shouldExportBook(book, notes) {
        if (notes.length > 0) {
            return true;
        }
        if ((book.noteCount || 0) > 0 || (book.highlightCount || 0) > 0 || (book.reviewCount || 0) > 0) {
            return true;
        }
        return false;
    }
}
exports.MigrationService = MigrationService;
let migrationServiceInstance;
function getMigrationService() {
    if (!migrationServiceInstance) {
        migrationServiceInstance = new MigrationService();
    }
    return migrationServiceInstance;
}
exports.getMigrationService = getMigrationService;
//# sourceMappingURL=migrationService.js.map