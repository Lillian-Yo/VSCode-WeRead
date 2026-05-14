"use strict";
/**
 * 统一的 bookId 归一化工具
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBookId = void 0;
function normalizeBookId(raw) {
    return raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').trim() || `local_${Date.now()}`;
}
exports.normalizeBookId = normalizeBookId;
//# sourceMappingURL=bookId.js.map