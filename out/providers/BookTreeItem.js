"use strict";
/**
 * 书籍 TreeItem 定义
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
exports.InitializingTreeItem = exports.SyncingTreeItem = exports.ClearBookshelfFilterTreeItem = exports.InsightsEntryTreeItem = exports.BookshelfSearchTreeItem = exports.EmptyBookshelfTreeItem = exports.LoginRequiredTreeItem = exports.CategoryTreeItem = exports.BookTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const models_1 = require("../models");
const i18n_1 = require("../i18n");
class BookTreeItem extends vscode.TreeItem {
    constructor(book, collapsibleState, parentKey = '') {
        super(book.title, collapsibleState);
        this.book = book;
        this.collapsibleState = collapsibleState;
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.contextValue = 'book';
        const sourceKey = book.localFilePath || book.rawBookId || book.bookId;
        this.id = `book:${parentKey}:${sourceKey}`;
        this.iconPath = this.getIconPath();
        this.command = {
            command: 'weread.openBookDetail',
            title: '打开书籍笔记',
            arguments: [book.bookId],
        };
    }
    getTooltip() {
        const lines = [
            (0, i18n_1.t)('book_tooltip_category', { value: this.book.category || (0, i18n_1.t)('common_notCategorized') }),
            (0, i18n_1.t)('book_tooltip_title', { value: this.book.title }),
            (0, i18n_1.t)('book_tooltip_author', { value: this.book.author }),
        ];
        if (this.book.publisher) {
            lines.push((0, i18n_1.t)('book_tooltip_publisher', { value: this.book.publisher }));
        }
        lines.push((0, i18n_1.t)('book_tooltip_progress', { value: this.book.progress }));
        lines.push((0, i18n_1.t)('book_tooltip_highlight', { value: this.book.highlightCount }));
        lines.push((0, i18n_1.t)('book_tooltip_note', { value: this.book.noteCount }));
        return lines.join('\n');
    }
    getDescription() {
        const parts = [this.book.author];
        if (this.book.progress > 0) {
            parts.push(`${this.book.progress}%`);
        }
        return parts.join(' · ');
    }
    getIconPath() {
        switch (this.book.readingStatus) {
            case models_1.ReadingStatus.Reading:
                return new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.yellow'));
            case models_1.ReadingStatus.Finished:
                return new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.green'));
            default:
                return new vscode.ThemeIcon('book');
        }
    }
}
exports.BookTreeItem = BookTreeItem;
class CategoryTreeItem extends vscode.TreeItem {
    constructor(label, books, collapsibleState, idSuffix = '') {
        super(label, collapsibleState);
        this.label = label;
        this.books = books;
        this.collapsibleState = collapsibleState;
        this.description = `${books.length} ${(0, i18n_1.t)('common_book')}`;
        this.contextValue = 'category';
        this.id = `category:${label}:${idSuffix}`;
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}
exports.CategoryTreeItem = CategoryTreeItem;
class LoginRequiredTreeItem extends vscode.TreeItem {
    constructor(label = (0, i18n_1.t)('bookshelf_login_hint')) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('sign-in');
        this.command = {
            command: 'weread.login',
            title: '登录',
        };
    }
}
exports.LoginRequiredTreeItem = LoginRequiredTreeItem;
class EmptyBookshelfTreeItem extends vscode.TreeItem {
    constructor() {
        super((0, i18n_1.t)('bookshelf_empty'), vscode.TreeItemCollapsibleState.None);
        this.description = (0, i18n_1.t)('bookshelf_empty_desc');
        this.iconPath = new vscode.ThemeIcon('info');
    }
}
exports.EmptyBookshelfTreeItem = EmptyBookshelfTreeItem;
class BookshelfSearchTreeItem extends vscode.TreeItem {
    constructor(query) {
        super(query ? (0, i18n_1.t)('bookshelf_search_label', { query }) : (0, i18n_1.t)('bookshelf_search_placeholder'), vscode.TreeItemCollapsibleState.None);
        this.description = query ? (0, i18n_1.t)('bookshelf_search_clickClear') : (0, i18n_1.t)('bookshelf_search_clickInput');
        this.contextValue = 'weread.searchBar';
        this.iconPath = new vscode.ThemeIcon(query ? 'close' : 'search');
        this.command = {
            command: query ? 'weread.clearBookshelfFilter' : 'weread.searchBookshelf',
            title: query ? '清除筛选' : '搜索书架',
        };
    }
}
exports.BookshelfSearchTreeItem = BookshelfSearchTreeItem;
class InsightsEntryTreeItem extends vscode.TreeItem {
    constructor() {
        super((0, i18n_1.t)('bookshelf_insights_entry'), vscode.TreeItemCollapsibleState.None);
        this.description = (0, i18n_1.t)('bookshelf_insights_entry_desc');
        this.contextValue = 'weread.insightsEntry';
        this.iconPath = new vscode.ThemeIcon('graph');
        this.command = {
            command: 'weread.openInsights',
            title: '打开阅读洞察',
        };
    }
}
exports.InsightsEntryTreeItem = InsightsEntryTreeItem;
class ClearBookshelfFilterTreeItem extends vscode.TreeItem {
    constructor() {
        super('清空搜索', vscode.TreeItemCollapsibleState.None);
        this.description = '点击清除当前筛选';
        this.contextValue = 'weread.clearFilter';
        this.iconPath = new vscode.ThemeIcon('filter-filled');
        this.command = {
            command: 'weread.clearBookshelfFilter',
            title: '清除筛选',
        };
    }
}
exports.ClearBookshelfFilterTreeItem = ClearBookshelfFilterTreeItem;
class SyncingTreeItem extends vscode.TreeItem {
    constructor(message = (0, i18n_1.t)('bookshelf_syncing')) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('sync~spin');
    }
}
exports.SyncingTreeItem = SyncingTreeItem;
class InitializingTreeItem extends vscode.TreeItem {
    constructor(message = (0, i18n_1.t)('bookshelf_initializing')) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('loading~spin');
    }
}
exports.InitializingTreeItem = InitializingTreeItem;
//# sourceMappingURL=BookTreeItem.js.map