"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dedupeIndexBooks = void 0;
function dedupeIndexBooks(entries, onConflict) {
    const merged = new Map();
    for (const entry of entries) {
        const key = entry.bookId || entry.rawBookId || entry.filePath;
        const prev = merged.get(key);
        if (!prev) {
            merged.set(key, entry);
            continue;
        }
        const prevLastRead = prev.lastReadTime || 0;
        const nextLastRead = entry.lastReadTime || 0;
        if (nextLastRead > prevLastRead) {
            merged.set(key, entry);
            onConflict?.({
                key,
                kept: entry,
                dropped: prev,
                reason: 'newer_last_read',
            });
            continue;
        }
        if (nextLastRead === prevLastRead && entry.fileMtimeMs > prev.fileMtimeMs) {
            merged.set(key, entry);
            onConflict?.({
                key,
                kept: entry,
                dropped: prev,
                reason: 'newer_file_mtime',
            });
            continue;
        }
        onConflict?.({
            key,
            kept: prev,
            dropped: entry,
            reason: 'kept_existing',
        });
    }
    return Array.from(merged.values());
}
exports.dedupeIndexBooks = dedupeIndexBooks;
//# sourceMappingURL=indexDedup.js.map