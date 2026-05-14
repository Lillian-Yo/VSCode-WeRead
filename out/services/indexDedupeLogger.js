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
exports.logIndexDedupeConflicts = void 0;
const vscode = __importStar(require("vscode"));
let dedupeOutput;
function getDedupeOutput() {
    if (!dedupeOutput) {
        dedupeOutput = vscode.window.createOutputChannel('WeRead 书架去重日志');
    }
    return dedupeOutput;
}
function logIndexDedupeConflicts(source, conflicts) {
    if (conflicts.length === 0) {
        return;
    }
    const output = getDedupeOutput();
    output.appendLine(`[${new Date().toISOString()}] [index.dedupe] source=${source} collapsed=${conflicts.length}`);
    for (const conflict of conflicts) {
        output.appendLine(`[index.dedupe.item] key=${conflict.key} dropped=${conflict.dropped.filePath} kept=${conflict.kept.filePath} reason=${conflict.reason}`);
    }
}
exports.logIndexDedupeConflicts = logIndexDedupeConflicts;
//# sourceMappingURL=indexDedupeLogger.js.map