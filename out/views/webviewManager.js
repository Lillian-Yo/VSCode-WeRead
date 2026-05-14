"use strict";
/**
 * WebView 管理器
 * 统一管理 WebView 的创建、销毁和通信
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
exports.getWebviewManager = exports.initializeWebviewManager = exports.WebviewManager = void 0;
const vscode = __importStar(require("vscode"));
class WebviewManager {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.messageHandlers = new Map();
        this.disposables = [];
    }
    /**
     * 创建 WebView
     */
    create(options) {
        // 如果已存在，先关闭
        if (this.panel) {
            this.panel.dispose();
        }
        const column = options.column || vscode.ViewColumn.One;
        this.panel = vscode.window.createWebviewPanel('wereadWebview', options.title, column, {
            enableScripts: options.enableScripts ?? true,
            retainContextWhenHidden: options.retainContextWhenHidden ?? true,
            localResourceRoots: options.localResourceRoots || [
                this.extensionUri,
                vscode.Uri.joinPath(this.extensionUri, 'out'),
                vscode.Uri.joinPath(this.extensionUri, 'src', 'views'),
            ],
        });
        // 监听消息
        this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables);
        // 监听关闭
        this.panel.onDidDispose(() => {
            this.panel = undefined;
            this.dispose();
        }, null, this.disposables);
        return this.panel;
    }
    /**
     * 设置 HTML 内容
     */
    setContent(html) {
        if (this.panel) {
            this.panel.webview.html = html;
        }
    }
    /**
     * 发送消息到 WebView
     */
    postMessage(command, data) {
        if (this.panel) {
            this.panel.webview.postMessage({ command, data });
        }
    }
    /**
     * 注册消息处理器
     */
    onMessage(command, handler) {
        this.messageHandlers.set(command, handler);
    }
    /**
     * 处理收到的消息
     */
    handleMessage(message) {
        const handler = this.messageHandlers.get(message.command);
        if (handler) {
            handler(message.data);
        }
    }
    /**
     * 获取 WebView URI
     */
    asWebviewUri(localPath) {
        return this.panel?.webview.asWebviewUri(localPath);
    }
    /**
     * 显示 WebView
     */
    reveal(column) {
        if (this.panel) {
            this.panel.reveal(column);
        }
    }
    /**
     * 关闭 WebView
     */
    close() {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
    /**
     * 是否可见
     */
    get visible() {
        return this.panel?.visible ?? false;
    }
    /**
     * 清理资源
     */
    dispose() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.messageHandlers.clear();
    }
}
exports.WebviewManager = WebviewManager;
let webviewManagerInstance;
function initializeWebviewManager(extensionUri) {
    webviewManagerInstance = new WebviewManager(extensionUri);
    return webviewManagerInstance;
}
exports.initializeWebviewManager = initializeWebviewManager;
function getWebviewManager() {
    if (!webviewManagerInstance) {
        throw new Error('WebviewManager not initialized');
    }
    return webviewManagerInstance;
}
exports.getWebviewManager = getWebviewManager;
//# sourceMappingURL=webviewManager.js.map