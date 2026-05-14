"use strict";
/**
 * 书架 TreeDataProvider
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
exports.getBookshelfProvider = exports.createBookshelfProvider = exports.BookshelfProvider = void 0;
const vscode = __importStar(require("vscode"));
const indexService_1 = require("../services/indexService");
const localDataService_1 = require("../services/localDataService");
const BookTreeItem_1 = require("./BookTreeItem");
const i18n_1 = require("../i18n");
const bookshelfToggleLog_1 = require("../logging/bookshelfToggleLog");
class BookshelfProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.isSyncing = false;
        this.syncMessage = '正在同步...';
        this.storageRetryScheduled = false;
        this.searchQuery = '';
        this.loggedIn = false;
        this.collapseMode = 'default';
        this.collapseRevision = 0;
        this.lastRootCategoryCount = 0;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    setSearchQuery(query) {
        this.searchQuery = query.trim().toLowerCase();
        void vscode.commands.executeCommand('setContext', 'weread:bookshelfFilterActive', !!this.searchQuery);
        this.refresh();
    }
    clearSearchQuery() {
        this.searchQuery = '';
        void vscode.commands.executeCommand('setContext', 'weread:bookshelfFilterActive', false);
        this.refresh();
    }
    expandAllCategories() {
        const categoryCount = this.lastRootCategoryCount;
        (0, bookshelfToggleLog_1.logBookshelfToggle)(`provider expandAll requested count=${categoryCount} mode=${this.collapseMode} revision=${this.collapseRevision}`);
        if (categoryCount === 0) {
            return 0;
        }
        this.collapseMode = 'allExpanded';
        this.collapseRevision += 1;
        this.refresh();
        return categoryCount;
    }
    collapseAllCategories() {
        const categoryCount = this.lastRootCategoryCount;
        (0, bookshelfToggleLog_1.logBookshelfToggle)(`provider collapseAll requested count=${categoryCount} mode=${this.collapseMode} revision=${this.collapseRevision}`);
        if (categoryCount === 0) {
            return 0;
        }
        this.collapseMode = 'allCollapsed';
        this.collapseRevision += 1;
        this.refresh();
        return categoryCount;
    }
    getSearchQuery() {
        return this.searchQuery;
    }
    getCollapseMode() {
        return this.collapseMode;
    }
    clearCollapseMode() {
        if (this.collapseMode !== 'default') {
            (0, bookshelfToggleLog_1.logBookshelfToggle)(`provider clearCollapseMode from=${this.collapseMode}`);
        }
        this.collapseMode = 'default';
    }
    setLoggedIn(loggedIn) {
        this.loggedIn = loggedIn;
        this.refresh();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof BookTreeItem_1.BookshelfSearchTreeItem) {
            return [];
        }
        // 获取书籍数据
        let books = [];
        try {
            books = await (0, indexService_1.getIndexService)().queryBooks();
        }
        catch {
            this.lastRootCategoryCount = 0;
            this.scheduleStorageRetryRefresh();
            return this.wrapTopItems([new BookTreeItem_1.EmptyBookshelfTreeItem()], !this.loggedIn);
        }
        books = await this.tryReloadLocalBooksIfNeeded(books, element);
        if (books.length === 0) {
            this.lastRootCategoryCount = 0;
            return this.wrapTopItems([new BookTreeItem_1.EmptyBookshelfTreeItem()], !this.loggedIn);
        }
        const filteredBooks = await this.filterBooks(books);
        if (filteredBooks.length === 0) {
            this.lastRootCategoryCount = 0;
            const emptyItem = new BookTreeItem_1.EmptyBookshelfTreeItem();
            emptyItem.label = (0, i18n_1.t)('bookshelf_search_notFound');
            emptyItem.description = this.searchQuery
                ? (0, i18n_1.t)('bookshelf_search_desc', { query: this.searchQuery })
                : (0, i18n_1.t)('bookshelf_search_desc_empty');
            return this.wrapTopItems([emptyItem], !this.loggedIn);
        }
        // 如果当前是分类节点，返回该分类下的书籍
        if (element instanceof BookTreeItem_1.CategoryTreeItem) {
            return element.books.map((book) => new BookTreeItem_1.BookTreeItem(book, vscode.TreeItemCollapsibleState.None, element.label));
        }
        // 根节点，按分类分组
        const grouped = this.groupBooksByCategory(filteredBooks);
        this.lastRootCategoryCount = grouped.length;
        (0, bookshelfToggleLog_1.logBookshelfToggle)(`provider root render categories=${grouped.length} mode=${this.collapseMode} revision=${this.collapseRevision}`);
        if (!this.loggedIn) {
            return this.wrapTopItems(grouped, true);
        }
        return this.wrapTopItems(grouped, false);
    }
    /**
     * 按分类分组
     */
    groupBooksByCategory(books) {
        const groups = new Map();
        const publicAccountCategory = (0, i18n_1.t)('bookshelf_publicAccount');
        for (const book of books) {
            const category = this.getCategoryName(book);
            if (!groups.has(category)) {
                groups.set(category, []);
            }
            groups.get(category).push(book);
        }
        const sortedCategoryNames = Array.from(groups.keys()).sort((a, b) => {
            if (a === publicAccountCategory) {
                return -1;
            }
            if (b === publicAccountCategory) {
                return 1;
            }
            if (a === '未分类') {
                return 1;
            }
            if (b === '未分类') {
                return -1;
            }
            return a.localeCompare(b, 'zh-CN');
        });
        const items = [];
        for (const category of sortedCategoryNames) {
            const categoryBooks = (groups.get(category) || []).sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0));
            items.push(new BookTreeItem_1.CategoryTreeItem(category, categoryBooks, this.resolveCategoryState(category, publicAccountCategory), `${this.collapseMode}:${this.collapseRevision}`));
        }
        return items;
    }
    getCategoryName(book) {
        if (book.bookId.startsWith('article:')) {
            return (0, i18n_1.t)('bookshelf_publicAccount');
        }
        const category = (book.category || '').trim();
        if (!category) {
            return (0, i18n_1.t)('common_notCategorized');
        }
        const mode = vscode.workspace.getConfiguration('weread').get('categoryMode', 'level1');
        if (mode === 'level2') {
            return category;
        }
        return extractPrimaryCategory(category);
    }
    resolveCategoryState(category, publicAccountCategory) {
        if (this.collapseMode === 'allCollapsed') {
            return vscode.TreeItemCollapsibleState.Collapsed;
        }
        if (this.collapseMode === 'allExpanded') {
            return vscode.TreeItemCollapsibleState.Expanded;
        }
        return category === publicAccountCategory
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.Expanded;
    }
    async filterBooks(books) {
        if (!this.searchQuery) {
            return books;
        }
        const filtered = [];
        for (const book of books) {
            const noteText = await this.getBookNoteText(book.bookId);
            const haystack = [
                book.title,
                book.author,
                book.category,
                book.publisher,
                noteText,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            if (haystack.includes(this.searchQuery)) {
                filtered.push(book);
            }
        }
        return filtered;
    }
    async getBookNoteText(bookId) {
        try {
            const notes = await (0, indexService_1.getIndexService)().getNotesByBookId(bookId);
            return notes
                .map((note) => `${note.highlightText || ''} ${note.thoughtText || ''} ${note.chapterTitle || ''}`)
                .join(' ');
        }
        catch {
            return '';
        }
    }
    wrapTopItems(items, showLoginHint = false) {
        const top = [];
        if (showLoginHint) {
            top.push(new BookTreeItem_1.LoginRequiredTreeItem((0, i18n_1.t)('bookshelf_login_hint')));
        }
        top.push(new BookTreeItem_1.BookshelfSearchTreeItem(this.searchQuery));
        return [...top, ...items];
    }
    /**
     * 设置同步状态
     */
    setSyncing(syncing, message) {
        this.isSyncing = syncing;
        if (message) {
            this.syncMessage = message;
        }
        this.refresh();
    }
    getSyncHintItem() {
        if (!this.isSyncing) {
            return undefined;
        }
        return new BookTreeItem_1.SyncingTreeItem(this.syncMessage);
    }
    /**
     * 获取选中的书籍
     */
    getBook(treeItem) {
        if (treeItem instanceof BookTreeItem_1.BookTreeItem) {
            return treeItem.book;
        }
        return undefined;
    }
    scheduleStorageRetryRefresh() {
        if (this.storageRetryScheduled) {
            return;
        }
        this.storageRetryScheduled = true;
        setTimeout(() => {
            this.storageRetryScheduled = false;
            this.refresh();
        }, 300);
    }
    async tryReloadLocalBooksIfNeeded(books, element) {
        if (element || this.loggedIn || books.length > 0) {
            return books;
        }
        if (!this.localReloadPromise) {
            this.localReloadPromise = (0, localDataService_1.getLocalDataService)()
                .reloadFromConfiguredPath()
                .then(() => undefined)
                .finally(() => {
                this.localReloadPromise = undefined;
            });
        }
        try {
            await this.localReloadPromise;
            return await (0, indexService_1.getIndexService)().queryBooks();
        }
        catch {
            return books;
        }
    }
}
exports.BookshelfProvider = BookshelfProvider;
function extractPrimaryCategory(category) {
    const normalized = category.trim();
    if (!normalized) {
        return (0, i18n_1.t)('common_notCategorized');
    }
    // 兼容常见分级分隔符，如：精品小说-纪实小说、精品小说｜科幻、精品小说 / 科幻 等
    const match = normalized.match(/^(.*?)\s*(?:\/|｜|\||>|·|•|：|:|—|–|－|-)\s*.+$/);
    if (match?.[1]) {
        const level1 = match[1].trim();
        if (level1) {
            return level1;
        }
    }
    return normalized;
}
let bookshelfProviderInstance;
function createBookshelfProvider() {
    bookshelfProviderInstance = new BookshelfProvider();
    return bookshelfProviderInstance;
}
exports.createBookshelfProvider = createBookshelfProvider;
function getBookshelfProvider() {
    if (!bookshelfProviderInstance) {
        throw new Error('BookshelfProvider not initialized');
    }
    return bookshelfProviderInstance;
}
exports.getBookshelfProvider = getBookshelfProvider;
//# sourceMappingURL=BookshelfProvider.js.map