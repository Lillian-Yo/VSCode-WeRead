import * as vscode from 'vscode';
import { logBookshelfToggle } from '../logging/bookshelfToggleLog';

let bookshelfAllCollapsed = false;
const BOOKSHELF_CONTEXT_KEYS = ['weread:bookshelfAllCollapsed', 'weread.bookshelfAllCollapsed'] as const;

export function setBookshelfAllCollapsed(value: boolean): void {
  bookshelfAllCollapsed = value;
}

export function isBookshelfAllCollapsed(): boolean {
  return bookshelfAllCollapsed;
}

export async function syncBookshelfCollapsedContext(value: boolean, source: string): Promise<void> {
  setBookshelfAllCollapsed(value);
  logBookshelfToggle(`sync context from=${source} collapsed=${value}`);
  await Promise.all(
    BOOKSHELF_CONTEXT_KEYS.map((key) => vscode.commands.executeCommand('setContext', key, value))
  );
}

export function collectCollapsibleIds(
  rootItems: readonly vscode.TreeItem[],
  childrenByRoot: ReadonlyMap<string, readonly vscode.TreeItem[]>
): Set<string> {
  const ids = new Set<string>();
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
