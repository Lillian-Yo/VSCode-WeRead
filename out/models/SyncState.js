"use strict";
/**
 * 同步状态模型定义
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncStep = exports.SyncStatus = void 0;
var SyncStatus;
(function (SyncStatus) {
    /** 空闲 */
    SyncStatus["Idle"] = "idle";
    /** 同步中 */
    SyncStatus["Syncing"] = "syncing";
    /** 成功 */
    SyncStatus["Success"] = "success";
    /** 失败 */
    SyncStatus["Failed"] = "failed";
})(SyncStatus = exports.SyncStatus || (exports.SyncStatus = {}));
var SyncStep;
(function (SyncStep) {
    /** 获取书架 */
    SyncStep["FetchingShelf"] = "fetching_shelf";
    /** 获取书籍详情 */
    SyncStep["FetchingBookDetails"] = "fetching_book_details";
    /** 获取笔记 */
    SyncStep["FetchingNotes"] = "fetching_notes";
    /** 保存数据 */
    SyncStep["SavingData"] = "saving_data";
    /** 完成 */
    SyncStep["Completed"] = "completed";
})(SyncStep = exports.SyncStep || (exports.SyncStep = {}));
//# sourceMappingURL=SyncState.js.map