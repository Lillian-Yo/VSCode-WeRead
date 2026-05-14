"use strict";
/**
 * 搜索命令
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
exports.registerSearchCommands = exports.clearBookshelfFilter = exports.searchBookshelf = exports.searchNotes = void 0;
const vscode = __importStar(require("vscode"));
const indexService_1 = require("../services/indexService");
const providers_1 = require("../providers");
const i18n_1 = require("../i18n");
/**
 * 执行搜索
 */
async function searchNotes() {
    const books = await (0, indexService_1.getIndexService)().queryBooks();
    const allNotes = (await Promise.all(books.map(async (book) => (0, indexService_1.getIndexService)().getNotesByBookId(book.bookId)))).flat();
    if (allNotes.length === 0) {
        vscode.window.showInformationMessage((0, i18n_1.t)('search_notes_empty'));
        return;
    }
    // 创建 QuickPick
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = (0, i18n_1.t)('search_notes_placeholder');
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    // 初始显示所有笔记
    quickPick.items = createSearchItems(allNotes, books);
    // 监听输入变化进行搜索
    quickPick.onDidChangeValue((value) => {
        if (value.trim()) {
            const results = performSearch(value, allNotes, books);
            quickPick.items = results.map((r) => createSearchItem(r));
        }
        else {
            quickPick.items = createSearchItems(allNotes, books);
        }
    });
    // 监听选择
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            // 打开对应的书籍详情
            vscode.commands.executeCommand('weread.openBookDetail', selected.bookId);
        }
        quickPick.hide();
    });
    quickPick.show();
}
exports.searchNotes = searchNotes;
async function searchBookshelf() {
    const books = await (0, indexService_1.getIndexService)().queryBooks();
    if (books.length === 0) {
        vscode.window.showInformationMessage((0, i18n_1.t)('search_bookshelf_empty'));
        return;
    }
    const provider = (0, providers_1.getBookshelfProvider)();
    const input = vscode.window.createInputBox();
    input.title = (0, i18n_1.t)('search_bookshelf_title');
    input.prompt = (0, i18n_1.t)('search_bookshelf_prompt');
    input.value = provider.getSearchQuery();
    input.onDidChangeValue((value) => {
        if (!value.trim()) {
            provider.clearSearchQuery();
            return;
        }
        provider.setSearchQuery(value);
    });
    input.onDidAccept(() => {
        input.hide();
    });
    input.show();
}
exports.searchBookshelf = searchBookshelf;
function clearBookshelfFilter() {
    (0, providers_1.getBookshelfProvider)().clearSearchQuery();
    vscode.window.showInformationMessage((0, i18n_1.t)('search_filter_cleared'));
}
exports.clearBookshelfFilter = clearBookshelfFilter;
/**
 * 注册搜索命令
 */
function registerSearchCommands(context) {
    const searchNotesCommand = vscode.commands.registerCommand('weread.searchNotes', searchNotes);
    const searchBookshelfCommand = vscode.commands.registerCommand('weread.searchBookshelf', searchBookshelf);
    const clearBookshelfFilterCommand = vscode.commands.registerCommand('weread.clearBookshelfFilter', clearBookshelfFilter);
    context.subscriptions.push(searchNotesCommand, searchBookshelfCommand, clearBookshelfFilterCommand);
}
exports.registerSearchCommands = registerSearchCommands;
/**
 * 创建搜索项列表
 */
function createSearchItems(notes, books) {
    const bookMap = new Map(books.map((b) => [b.bookId, b]));
    return notes.slice(0, 50).map((note) => {
        const book = bookMap.get(note.bookId);
        return createSearchItem({ note, book: book, score: 0 });
    });
}
/**
 * 创建单个搜索项
 */
function createSearchItem(result) {
    const { note, book } = result;
    // 截断文本
    const highlightText = note.highlightText
        ? note.highlightText.substring(0, 100) + (note.highlightText.length > 100 ? '...' : '')
        : '';
    const thoughtText = note.thoughtText
        ? note.thoughtText.substring(0, 80) + (note.thoughtText.length > 80 ? '...' : '')
        : '';
    let label = highlightText || thoughtText || (0, i18n_1.t)('search_default_note');
    if (label.length > 60) {
        label = label.substring(0, 60) + '...';
    }
    return {
        label,
        description: `《${book?.title || (0, i18n_1.t)('search_unknown_book')}》`,
        detail: note.thoughtText ? `💭 ${thoughtText}` : undefined,
        bookId: note.bookId,
        noteId: note.noteId,
    };
}
/**
 * 执行搜索
 */
function performSearch(query, notes, books) {
    const bookMap = new Map(books.map((b) => [b.bookId, b]));
    const lowerQuery = query.toLowerCase();
    const keywords = lowerQuery.split(/\s+/).filter((k) => k.length > 0);
    const results = [];
    for (const note of notes) {
        let score = 0;
        const textToSearch = [
            note.highlightText || '',
            note.thoughtText || '',
            note.chapterTitle || '',
        ]
            .join(' ')
            .toLowerCase();
        // 计算匹配分数
        for (const keyword of keywords) {
            if (textToSearch.includes(keyword)) {
                score += 1;
                // 标题匹配加分
                if (note.chapterTitle?.toLowerCase().includes(keyword)) {
                    score += 2;
                }
                // 想法匹配加分
                if (note.thoughtText?.toLowerCase().includes(keyword)) {
                    score += 1;
                }
            }
        }
        if (score > 0) {
            results.push({
                note,
                book: bookMap.get(note.bookId),
                score,
            });
        }
    }
    // 按分数排序
    return results.sort((a, b) => b.score - a.score).slice(0, 20);
}
//# sourceMappingURL=search.js.map