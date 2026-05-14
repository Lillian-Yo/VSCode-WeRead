"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSyncInProgressSkip = exports.isSyncInProgressError = void 0;
function isSyncInProgressError(error) {
    return error === '同步正在进行中';
}
exports.isSyncInProgressError = isSyncInProgressError;
function isSyncInProgressSkip(result) {
    return !!result && result.skipped && result.reason === 'sync_in_progress';
}
exports.isSyncInProgressSkip = isSyncInProgressSkip;
//# sourceMappingURL=syncFlowGuard.js.map