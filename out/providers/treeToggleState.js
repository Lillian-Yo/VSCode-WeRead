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
exports.collectCollapsibleIds = exports.syncBookshelfCollapsedContext = exports.isBookshelfAllCollapsed = exports.setBookshelfAllCollapsed = void 0;
const vscode = __importStar(require("vscode"));
const bookshelfToggleLog_1 = require("../logging/bookshelfToggleLog");
let bookshelfAllCollapsed = false;
const BOOKSHELF_CONTEXT_KEYS = ['weread:bookshelfAllCollapsed', 'weread.bookshelfAllCollapsed'];
function setBookshelfAllCollapsed(value) {
    bookshelfAllCollapsed = value;
}
exports.setBookshelfAllCollapsed = setBookshelfAllCollapsed;
function isBookshelfAllCollapsed() {
    return bookshelfAllCollapsed;
}
exports.isBookshelfAllCollapsed = isBookshelfAllCollapsed;
async function syncBookshelfCollapsedContext(value, source) {
    setBookshelfAllCollapsed(value);
    (0, bookshelfToggleLog_1.logBookshelfToggle)(`sync context from=${source} collapsed=${value}`);
    await Promise.all(BOOKSHELF_CONTEXT_KEYS.map((key) => vscode.commands.executeCommand('setContext', key, value)));
}
exports.syncBookshelfCollapsedContext = syncBookshelfCollapsedContext;
function collectCollapsibleIds(rootItems, childrenByRoot) {
    const ids = new Set();
    for (const root of rootItems) {
        if (root.collapsibleState !== vscode.TreeItemCollapsibleState.None && root.id) {
            ids.add(root.id);
        }
        const childItems = childrenByRoot.get(root.id || '') || [];
        for (const child of childItems) {
            if (child.collapsibleState !== vscode.TreeItemCollapsibleState.None && child.id) {
                ids.add(child.id);
            }
        }
    }
    return ids;
}
exports.collectCollapsibleIds = collectCollapsibleIds;
//# sourceMappingURL=treeToggleState.js.map