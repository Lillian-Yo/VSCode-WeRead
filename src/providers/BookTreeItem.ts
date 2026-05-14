/**
 * 书籍 TreeItem 定义
 */

import * as vscode from 'vscode';
import { Book, ReadingStatus } from '../models';
import { t } from '../i18n';

export class BookTreeItem extends vscode.TreeItem {
  constructor(
    public readonly book: Book,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    parentKey = ''
  ) {
    super(book.title, collapsibleState);

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

  private getTooltip(): string {
    const lines = [
      t('book_tooltip_category', { value: this.book.category || t('common_notCategorized') }),
      t('book_tooltip_title', { value: this.book.title }),
      t('book_tooltip_author', { value: this.book.author }),
    ];

    if (this.book.publisher) {
      lines.push(t('book_tooltip_publisher', { value: this.book.publisher }));
    }

    lines.push(t('book_tooltip_progress', { value: this.book.progress }));
    lines.push(t('book_tooltip_highlight', { value: this.book.highlightCount }));
    lines.push(t('book_tooltip_note', { value: this.book.noteCount }));

    return lines.join('\n');
  }

  private getDescription(): string {
    const parts = [this.book.author];

    if (this.book.progress > 0) {
      parts.push(`${this.book.progress}%`);
    }

    return parts.join(' · ');
  }

  private getIconPath(): vscode.ThemeIcon {
    switch (this.book.readingStatus) {
      case ReadingStatus.Reading:
        return new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.yellow'));
      case ReadingStatus.Finished:
        return new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.green'));
      default:
        return new vscode.ThemeIcon('book');
    }
  }
}

export class CategoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly books: Book[],
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    idSuffix = ''
  ) {
    super(label, collapsibleState);
    this.description = `${books.length} ${t('common_book')}`;
    this.contextValue = 'category';
    this.id = `category:${label}:${idSuffix}`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class LoginRequiredTreeItem extends vscode.TreeItem {
  constructor(label = t('bookshelf_login_hint')) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('sign-in');
    this.command = {
      command: 'weread.login',
      title: '登录',
    };
  }
}

export class EmptyBookshelfTreeItem extends vscode.TreeItem {
  constructor() {
    super(t('bookshelf_empty'), vscode.TreeItemCollapsibleState.None);
    this.description = t('bookshelf_empty_desc');
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class BookshelfSearchTreeItem extends vscode.TreeItem {
  constructor(query: string) {
    super(
      query ? t('bookshelf_search_label', { query }) : t('bookshelf_search_placeholder'),
      vscode.TreeItemCollapsibleState.None
    );
    this.description = query ? t('bookshelf_search_clickClear') : t('bookshelf_search_clickInput');
    this.contextValue = 'weread.searchBar';
    this.iconPath = new vscode.ThemeIcon(query ? 'close' : 'search');
    this.command = {
      command: query ? 'weread.clearBookshelfFilter' : 'weread.searchBookshelf',
      title: query ? '清除筛选' : '搜索书架',
    };
  }
}

export class InsightsEntryTreeItem extends vscode.TreeItem {
  constructor() {
    super(t('bookshelf_insights_entry'), vscode.TreeItemCollapsibleState.None);
    this.description = t('bookshelf_insights_entry_desc');
    this.contextValue = 'weread.insightsEntry';
    this.iconPath = new vscode.ThemeIcon('graph');
    this.command = {
      command: 'weread.openInsights',
      title: '打开阅读洞察',
    };
  }
}

export class ClearBookshelfFilterTreeItem extends vscode.TreeItem {
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

export class SyncingTreeItem extends vscode.TreeItem {
  constructor(message = t('bookshelf_syncing')) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('sync~spin');
  }
}

export class InitializingTreeItem extends vscode.TreeItem {
  constructor(message = t('bookshelf_initializing')) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
  }
}
