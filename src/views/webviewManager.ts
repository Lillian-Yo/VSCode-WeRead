/**
 * WebView 管理器
 * 统一管理 WebView 的创建、销毁和通信
 */

import * as vscode from 'vscode';

export interface WebViewOptions {
  title: string;
  column?: vscode.ViewColumn;
  localResourceRoots?: vscode.Uri[];
  enableScripts?: boolean;
  retainContextWhenHidden?: boolean;
}

export class WebviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * 创建 WebView
   */
  create(options: WebViewOptions): vscode.WebviewPanel {
    // 如果已存在，先关闭
    if (this.panel) {
      this.panel.dispose();
    }

    const column = options.column || vscode.ViewColumn.One;

    this.panel = vscode.window.createWebviewPanel(
      'wereadWebview',
      options.title,
      column,
      {
        enableScripts: options.enableScripts ?? true,
        retainContextWhenHidden: options.retainContextWhenHidden ?? true,
        localResourceRoots: options.localResourceRoots || [
          this.extensionUri,
          vscode.Uri.joinPath(this.extensionUri, 'out'),
          vscode.Uri.joinPath(this.extensionUri, 'src', 'views'),
        ],
      }
    );

    // 监听消息
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );

    // 监听关闭
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.dispose();
      },
      null,
      this.disposables
    );

    return this.panel;
  }

  /**
   * 设置 HTML 内容
   */
  setContent(html: string): void {
    if (this.panel) {
      this.panel.webview.html = html;
    }
  }

  /**
   * 发送消息到 WebView
   */
  postMessage(command: string, data?: any): void {
    if (this.panel) {
      this.panel.webview.postMessage({ command, data });
    }
  }

  /**
   * 注册消息处理器
   */
  onMessage(command: string, handler: (data: any) => void): void {
    this.messageHandlers.set(command, handler);
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(message: { command: string; data: any }): void {
    const handler = this.messageHandlers.get(message.command);
    if (handler) {
      handler(message.data);
    }
  }

  /**
   * 获取 WebView URI
   */
  asWebviewUri(localPath: vscode.Uri): vscode.Uri | undefined {
    return this.panel?.webview.asWebviewUri(localPath);
  }

  /**
   * 显示 WebView
   */
  reveal(column?: vscode.ViewColumn): void {
    if (this.panel) {
      this.panel.reveal(column);
    }
  }

  /**
   * 关闭 WebView
   */
  close(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }

  /**
   * 是否可见
   */
  get visible(): boolean {
    return this.panel?.visible ?? false;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.messageHandlers.clear();
  }
}

let webviewManagerInstance: WebviewManager | undefined;

export function initializeWebviewManager(extensionUri: vscode.Uri): WebviewManager {
  webviewManagerInstance = new WebviewManager(extensionUri);
  return webviewManagerInstance;
}

export function getWebviewManager(): WebviewManager {
  if (!webviewManagerInstance) {
    throw new Error('WebviewManager not initialized');
  }
  return webviewManagerInstance;
}
