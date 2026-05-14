"use strict";
/**
 * 配置管理
 */
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
exports.onConfigChange = exports.updateConfig = exports.getConfig = exports.DEFAULT_CONFIG = void 0;
const vscode = __importStar(require("vscode"));
exports.DEFAULT_CONFIG = {
    outputPath: '',
    manualOutputPathInput: false,
    outputPathInputMode: 'picker',
    lastValidationStatus: 'passed',
    lastValidationFailReason: '',
    lastValidationSummary: 'passed',
    fileNameTemplate: '{{title}}',
    noteTemplate: '',
    autoSync: true,
    syncInterval: '24h',
    categoryMode: 'level1',
    showCover: true,
    language: 'zh-CN',
    debugCanonicalIdLog: false,
    multiAccountEnabled: true,
};
/**
 * 获取配置
 */
function getConfig() {
    const config = vscode.workspace.getConfiguration('weread');
    return {
        outputPath: config.get('outputPath', exports.DEFAULT_CONFIG.outputPath),
        manualOutputPathInput: config.get('manualOutputPathInput', exports.DEFAULT_CONFIG.manualOutputPathInput),
        outputPathInputMode: config.get('outputPathInputMode', exports.DEFAULT_CONFIG.outputPathInputMode),
        lastValidationStatus: config.get('lastValidationStatus', exports.DEFAULT_CONFIG.lastValidationStatus),
        lastValidationFailReason: config.get('lastValidationFailReason', exports.DEFAULT_CONFIG.lastValidationFailReason),
        lastValidationSummary: config.get('lastValidationSummary', exports.DEFAULT_CONFIG.lastValidationSummary),
        fileNameTemplate: config.get('fileNameTemplate', exports.DEFAULT_CONFIG.fileNameTemplate),
        noteTemplate: config.get('noteTemplate', exports.DEFAULT_CONFIG.noteTemplate),
        autoSync: config.get('autoSync', exports.DEFAULT_CONFIG.autoSync),
        syncInterval: config.get('syncInterval', exports.DEFAULT_CONFIG.syncInterval),
        categoryMode: config.get('categoryMode', exports.DEFAULT_CONFIG.categoryMode),
        showCover: config.get('showCover', exports.DEFAULT_CONFIG.showCover),
        language: config.get('language', exports.DEFAULT_CONFIG.language),
        debugCanonicalIdLog: config.get('debugCanonicalIdLog', exports.DEFAULT_CONFIG.debugCanonicalIdLog),
        multiAccountEnabled: config.get('multiAccountEnabled', exports.DEFAULT_CONFIG.multiAccountEnabled),
    };
}
exports.getConfig = getConfig;
/**
 * 更新配置
 */
async function updateConfig(key, value) {
    const config = vscode.workspace.getConfiguration('weread');
    await config.update(key, value, true);
}
exports.updateConfig = updateConfig;
/**
 * 监听配置变化
 */
function onConfigChange(callback) {
    return vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('weread')) {
            callback(getConfig());
        }
    });
}
exports.onConfigChange = onConfigChange;
//# sourceMappingURL=config.js.map
