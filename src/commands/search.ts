/**
 * 搜索命令
 */

import * as vscode from 'vscode';
import { getIndexService } from '../services/indexService';
import { Note, Book } from '../models';
import { getBookshelfProvider } from '../providers';
import { t } from '../i18n';

interface SearchResult {
  note: Note;
  book: Book;
  score: number;
}

/**
 * 执行搜索
 */
export async function searchNotes(): Promise<void> {
  const books = await getIndexService().queryBooks();
  const allNotes = (
    await Promise.all(
      books.map(async (book) => getIndexService().getNotesByBookId(book.bookId))
    )
  ).flat();

  if (allNotes.length === 0) {
    vscode.window.showInformationMessage(t('search_notes_empty'));
    return;
  }

  // 创建 QuickPick
  const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
  quickPick.placeholder = t('search_notes_placeholder');
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  // 初始显示所有笔记
  quickPick.items = createSearchItems(allNotes, books);

  // 监听输入变化进行搜索
  quickPick.onDidChangeValue((value) => {
    if (value.trim()) {
      const results = performSearch(value, allNotes, books);
      quickPick.items = results.map((r) => createSearchItem(r));
    } else {
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

export async function searchBookshelf(): Promise<void> {
  const books = await getIndexService().queryBooks();
  if (books.length === 0) {
    vscode.window.showInformationMessage(t('search_bookshelf_empty'));
    return;
  }

  const provider = getBookshelfProvider();
  const input = vscode.window.createInputBox();
  input.title = t('search_bookshelf_title');
  input.prompt = t('search_bookshelf_prompt');
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

export function clearBookshelfFilter(): void {
  getBookshelfProvider().clearSearchQuery();
  vscode.window.showInformationMessage(t('search_filter_cleared'));
}

/**
 * 注册搜索命令
 */
export function registerSearchCommands(context: vscode.ExtensionContext): void {
  const searchNotesCommand = vscode.commands.registerCommand('weread.searchNotes', searchNotes);
  const searchBookshelfCommand = vscode.commands.registerCommand('weread.searchBookshelf', searchBookshelf);
  const clearBookshelfFilterCommand = vscode.commands.registerCommand(
    'weread.clearBookshelfFilter',
    clearBookshelfFilter
  );
  context.subscriptions.push(searchNotesCommand, searchBookshelfCommand, clearBookshelfFilterCommand);
}

interface SearchQuickPickItem extends vscode.QuickPickItem {
  bookId: string;
  noteId: string;
}

/**
 * 创建搜索项列表
 */
function createSearchItems(notes: Note[], books: Book[]): SearchQuickPickItem[] {
  const bookMap = new Map(books.map((b) => [b.bookId, b]));

  return notes.slice(0, 50).map((note) => {
    const book = bookMap.get(note.bookId);
    return createSearchItem({ note, book: book!, score: 0 });
  });
}

/**
 * 创建单个搜索项
 */
function createSearchItem(result: SearchResult): SearchQuickPickItem {
  const { note, book } = result;

  // 截断文本
  const highlightText = note.highlightText
    ? note.highlightText.substring(0, 100) + (note.highlightText.length > 100 ? '...' : '')
    : '';

  const thoughtText = note.thoughtText
    ? note.thoughtText.substring(0, 80) + (note.thoughtText.length > 80 ? '...' : '')
    : '';

  let label = highlightText || thoughtText || t('search_default_note');
  if (label.length > 60) {
    label = label.substring(0, 60) + '...';
  }

  return {
    label,
    description: `《${book?.title || t('search_unknown_book')}》`,
    detail: note.thoughtText ? `💭 ${thoughtText}` : undefined,
    bookId: note.bookId,
    noteId: note.noteId,
  };
}

/**
 * 执行搜索
 */
function performSearch(query: string, notes: Note[], books: Book[]): SearchResult[] {
  const bookMap = new Map(books.map((b) => [b.bookId, b]));
  const lowerQuery = query.toLowerCase();
  const keywords = lowerQuery.split(/\s+/).filter((k) => k.length > 0);

  const results: SearchResult[] = [];

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
        book: bookMap.get(note.bookId)!,
        score,
      });
    }
  }

  // 按分数排序
  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}
