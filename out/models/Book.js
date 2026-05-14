"use strict";
/**
 * 书籍模型定义
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoteType = exports.ReadingStatus = void 0;
var ReadingStatus;
(function (ReadingStatus) {
    ReadingStatus[ReadingStatus["NotStarted"] = 0] = "NotStarted";
    ReadingStatus[ReadingStatus["Reading"] = 1] = "Reading";
    ReadingStatus[ReadingStatus["Finished"] = 2] = "Finished";
})(ReadingStatus = exports.ReadingStatus || (exports.ReadingStatus = {}));
var NoteType;
(function (NoteType) {
    /** 划线 */
    NoteType[NoteType["Highlight"] = 1] = "Highlight";
    /** 想法 */
    NoteType[NoteType["Thought"] = 2] = "Thought";
    /** 章节笔记 */
    NoteType[NoteType["Chapter"] = 3] = "Chapter";
    /** 书评 */
    NoteType[NoteType["Review"] = 4] = "Review";
})(NoteType = exports.NoteType || (exports.NoteType = {}));
//# sourceMappingURL=Book.js.map