"use strict";
/**
 * 登录视图提供者
 * 在未登录状态下显示登录提示
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
exports.resetLoginProvider = exports.getLoginProvider = exports.createLoginProvider = exports.LoginProvider = exports.LoginTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const i18n_1 = require("../i18n");
class LoginTreeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, command) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.command = command;
        this.tooltip = label;
    }
}
exports.LoginTreeItem = LoginTreeItem;
class LoginProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        return Promise.resolve([
            new LoginTreeItem((0, i18n_1.t)('login_provider_protocol'), vscode.TreeItemCollapsibleState.None, {
                command: 'weread.login.protocol',
                title: (0, i18n_1.t)('login_provider_protocol_title'),
                arguments: [],
            }),
            new LoginTreeItem((0, i18n_1.t)('login_provider_cookie'), vscode.TreeItemCollapsibleState.None, {
                command: 'weread.login.cookie',
                title: (0, i18n_1.t)('login_provider_cookie_title'),
                arguments: [],
            }),
        ]);
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
}
exports.LoginProvider = LoginProvider;
let loginProvider = null;
function createLoginProvider() {
    loginProvider = new LoginProvider();
    return loginProvider;
}
exports.createLoginProvider = createLoginProvider;
function getLoginProvider() {
    if (!loginProvider) {
        throw new Error('LoginProvider not initialized');
    }
    return loginProvider;
}
exports.getLoginProvider = getLoginProvider;
function resetLoginProvider() {
    loginProvider = null;
}
exports.resetLoginProvider = resetLoginProvider;
//# sourceMappingURL=LoginProvider.js.map