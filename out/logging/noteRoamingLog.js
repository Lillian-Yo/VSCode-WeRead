"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearNoteRoamingLogs = exports.copyNoteRoamingLogs = exports.showNoteRoamingLogs = exports.logNoteRoaming = void 0;
const vscode = __importStar(require("vscode"));
const NOTE_ROAMING_CHANNEL_NAME = 'WeRead 笔记漫游日志';
const MAX_LOG_LINES = 400;
let outputChannel;
const bufferedLines = [];
function getOutputChannel() {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel(NOTE_ROAMING_CHANNEL_NAME);
    }
    return outputChannel;
}
function appendLine(line) {
    bufferedLines.push(line);
    if (bufferedLines.length > MAX_LOG_LINES) {
        bufferedLines.splice(0, bufferedLines.length - MAX_LOG_LINES);
    }
    getOutputChannel().appendLine(line);
}
function formatLine(level, message) {
    return `[${new Date().toISOString()}] [${level}] [NoteRoaming] ${message}`;
}
function logNoteRoaming(message, level = 'INFO') {
    const line = formatLine(level, message);
    appendLine(line);
    if (level === 'ERROR') {
        console.error(line);
        return;
    }
    if (level === 'WARN') {
        console.warn(line);
        return;
    }
    console.info(line);
}
exports.logNoteRoaming = logNoteRoaming;
function showNoteRoamingLogs(preserveFocus = false) {
    getOutputChannel().show(preserveFocus);
}
exports.showNoteRoamingLogs = showNoteRoamingLogs;
async function copyNoteRoamingLogs() {
    const content = bufferedLines.length > 0
        ? bufferedLines.join('\n')
        : formatLine('INFO', '当前还没有捕获到笔记漫游日志');
    await vscode.env.clipboard.writeText(content);
    return bufferedLines.length;
}
exports.copyNoteRoamingLogs = copyNoteRoamingLogs;
function clearNoteRoamingLogs() {
    bufferedLines.length = 0;
    getOutputChannel().clear();
    appendLine(formatLine('INFO', '日志已清空，等待下一次笔记漫游操作'));
}
exports.clearNoteRoamingLogs = clearNoteRoamingLogs;
//# sourceMappingURL=noteRoamingLog.js.map