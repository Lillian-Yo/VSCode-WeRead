/**
 * 登录视图提供者
 * 在未登录状态下显示登录提示
 */

import * as vscode from 'vscode';
import { t } from '../i18n';

export class LoginTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.tooltip = label;
  }
}

export class LoginProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<vscode.TreeItem[]> {
    return Promise.resolve([
      new LoginTreeItem(
        t('login_provider_protocol'),
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'weread.login.protocol',
          title: t('login_provider_protocol_title'),
          arguments: [],
        }
      ),
      new LoginTreeItem(
        t('login_provider_cookie'),
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'weread.login.cookie',
          title: t('login_provider_cookie_title'),
          arguments: [],
        }
      ),
    ]);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

let loginProvider: LoginProvider | null = null;

export function createLoginProvider(): LoginProvider {
  loginProvider = new LoginProvider();
  return loginProvider;
}

export function getLoginProvider(): LoginProvider {
  if (!loginProvider) {
    throw new Error('LoginProvider not initialized');
  }
  return loginProvider;
}

export function resetLoginProvider(): void {
  loginProvider = null;
}
