/**
 * 书架 TreeDataProvider
 */

import * as vscode from 'vscode';
import { Book } from '../models';
import { getIndexService } from '../services/indexService';
import { getLocalDataService } from '../services/localDataService';
import {
  BookTreeItem,
  CategoryTreeItem,
  BookshelfSearchTreeItem,
  EmptyBookshelfTreeItem,
  LoginRequiredTreeItem,
  SyncingTreeItem,
} from './BookTreeItem';
import { t } from '../i18n';
import { logBookshelfToggle } from '../logging/bookshelfToggleLog';

export class BookshelfProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private isSyncing = false;
  private syncMessage = '正在同步...';
  private storageRetryScheduled = false;
  private searchQuery = '';
  private loggedIn = false;
  private localReloadPromise?: Promise<void>;
  private collapseMode: 'default' | 'allCollapsed' | 'allExpanded' = 'default';
  private collapseRevision = 0;
  private lastRootCategoryCount = 0;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query.trim().toLowerCase();
    void vscode.commands.executeCommand('setContext', 'weread:bookshelfFilterActive', !!this.searchQuery);
    this.refresh();
  }

  clearSearchQuery(): void {
    this.searchQuery = '';
    void vscode.commands.executeCommand('setContext', 'weread:bookshelfFilterActive', false);
    this.refresh();
  }

  expandAllCategories(): number {
    const categoryCount = this.lastRootCategoryCount;
    logBookshelfToggle(
      `provider expandAll requested count=${categoryCount} mode=${this.collapseMode} revision=${this.collapseRevision}`
    );
    if (categoryCount === 0) {
      return 0;
    }
    this.collapseMode = 'allExpanded';
    this.collapseRevision += 1;
    this.refresh();
    return categoryCount;
  }

  collapseAllCategories(): number {
    const categoryCount = this.lastRootCategoryCount;
    logBookshelfToggle(
      `provider collapseAll requested count=${categoryCount} mode=${this.collapseMode} revision=${this.collapseRevision}`
    );
    if (categoryCount === 0) {
      return 0;
    }
    this.collapseMode = 'allCollapsed';
    this.collapseRevision += 1;
    this.refresh();
    return categoryCount;
  }

  getSearchQuery(): string {
    return this.searchQuery;
  }

  getCollapseMode(): 'default' | 'allCollapsed' | 'allExpanded' {
    return this.collapseMode;
  }

  clearCollapseMode(): void {
    if (this.collapseMode !== 'default') {
      logBookshelfToggle(`provider clearCollapseMode from=${this.collapseMode}`);
    }
    this.collapseMode = 'default';
  }

  setLoggedIn(loggedIn: boolean): void {
    this.loggedIn = loggedIn;
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof BookshelfSearchTreeItem) {
      return [];
    }

    // 获取书籍数据
    let books: Book[] = [];
    try {
      books = await getIndexService().queryBooks();
    } catch {
      this.lastRootCategoryCount = 0;
      this.scheduleStorageRetryRefresh();
      return this.wrapTopItems([new EmptyBookshelfTreeItem()], !this.loggedIn);
    }

    books = await this.tryReloadLocalBooksIfNeeded(books, element);

    if (books.length === 0) {
      this.lastRootCategoryCount = 0;
      return this.wrapTopItems([new EmptyBookshelfTreeItem()], !this.loggedIn);
    }

    const filteredBooks = await this.filterBooks(books);
    if (filteredBooks.length === 0) {
      this.lastRootCategoryCount = 0;
      const emptyItem = new EmptyBookshelfTreeItem();
      emptyItem.label = t('bookshelf_search_notFound');
      emptyItem.description = this.searchQuery
        ? t('bookshelf_search_desc', { query: this.searchQuery })
        : t('bookshelf_search_desc_empty');
      return this.wrapTopItems([emptyItem], !this.loggedIn);
    }

    // 如果当前是分类节点，返回该分类下的书籍
    if (element instanceof CategoryTreeItem) {
      return element.books.map(
        (book) =>
          new BookTreeItem(book, vscode.TreeItemCollapsibleState.None, element.label)
      );
    }

    // 根节点，按分类分组
    const grouped = this.groupBooksByCategory(filteredBooks);
    this.lastRootCategoryCount = grouped.length;
    logBookshelfToggle(
      `provider root render categories=${grouped.length} mode=${this.collapseMode} revision=${this.collapseRevision}`
    );
    if (!this.loggedIn) {
      return this.wrapTopItems(grouped, true);
    }
    return this.wrapTopItems(grouped, false);
  }

  /**
   * 按分类分组
   */
  private groupBooksByCategory(books: Book[]): vscode.TreeItem[] {
    const groups = new Map<string, Book[]>();
    const publicAccountCategory = t('bookshelf_publicAccount');
    for (const book of books) {
      const category = this.getCategoryName(book);
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(book);
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

    const items: vscode.TreeItem[] = [];
    for (const category of sortedCategoryNames) {
      const categoryBooks = (groups.get(category) || []).sort(
        (a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0)
      );
      items.push(
        new CategoryTreeItem(
          category,
          categoryBooks,
          this.resolveCategoryState(category, publicAccountCategory),
          `${this.collapseMode}:${this.collapseRevision}`
        )
      );
    }

    return items;
  }

  private getCategoryName(book: Book): string {
    if (book.bookId.startsWith('article:')) {
      return t('bookshelf_publicAccount');
    }
    const category = (book.category || '').trim();
    if (!category) {
      return t('common_notCategorized');
    }

    const mode = vscode.workspace.getConfiguration('weread').get<string>('categoryMode', 'level1');
    if (mode === 'level2') {
      return category;
    }

    return extractPrimaryCategory(category);
  }

  private resolveCategoryState(
    category: string,
    publicAccountCategory: string
  ): vscode.TreeItemCollapsibleState {
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

  private async filterBooks(books: Book[]): Promise<Book[]> {
    if (!this.searchQuery) {
      return books;
    }

    const filtered: Book[] = [];
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

  private async getBookNoteText(bookId: string): Promise<string> {
    try {
      const notes = await getIndexService().getNotesByBookId(bookId);
      return notes
        .map((note) => `${note.highlightText || ''} ${note.thoughtText || ''} ${note.chapterTitle || ''}`)
        .join(' ');
    } catch {
      return '';
    }
  }

  private wrapTopItems(items: vscode.TreeItem[], showLoginHint = false): vscode.TreeItem[] {
    const top: vscode.TreeItem[] = [];
    if (showLoginHint) {
      top.push(new LoginRequiredTreeItem(t('bookshelf_login_hint')));
    }
    top.push(new BookshelfSearchTreeItem(this.searchQuery));
    return [...top, ...items];
  }

  /**
   * 设置同步状态
   */
  setSyncing(syncing: boolean, message?: string): void {
    this.isSyncing = syncing;
    if (message) {
      this.syncMessage = message;
    }
    this.refresh();
  }

  getSyncHintItem(): vscode.TreeItem | undefined {
    if (!this.isSyncing) {
      return undefined;
    }
    return new SyncingTreeItem(this.syncMessage);
  }

  /**
   * 获取选中的书籍
   */
  getBook(treeItem: vscode.TreeItem): Book | undefined {
    if (treeItem instanceof BookTreeItem) {
      return treeItem.book;
    }
    return undefined;
  }

  private scheduleStorageRetryRefresh(): void {
    if (this.storageRetryScheduled) {
      return;
    }
    this.storageRetryScheduled = true;
    setTimeout(() => {
      this.storageRetryScheduled = false;
      this.refresh();
    }, 300);
  }

  private async tryReloadLocalBooksIfNeeded(
    books: Book[],
    element?: vscode.TreeItem
  ): Promise<Book[]> {
    if (element || this.loggedIn || books.length > 0) {
      return books;
    }

    if (!this.localReloadPromise) {
      this.localReloadPromise = getLocalDataService()
        .reloadFromConfiguredPath()
        .then(() => undefined)
        .finally(() => {
          this.localReloadPromise = undefined;
        });
    }

    try {
      await this.localReloadPromise;
      return await getIndexService().queryBooks();
    } catch {
      return books;
    }
  }
}

function extractPrimaryCategory(category: string): string {
  const normalized = category.trim();
  if (!normalized) {
    return t('common_notCategorized');
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

let bookshelfProviderInstance: BookshelfProvider | undefined;

export function createBookshelfProvider(): BookshelfProvider {
  bookshelfProviderInstance = new BookshelfProvider();
  return bookshelfProviderInstance;
}

export function getBookshelfProvider(): BookshelfProvider {
  if (!bookshelfProviderInstance) {
    throw new Error('BookshelfProvider not initialized');
  }
  return bookshelfProviderInstance;
}
