"use strict";
/**
 * 微信读书 VSCode 插件入口
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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const runtimeExtension_1 = require("./runtimeExtension");
console.log('[Activation][Module] weread extension module loaded');
function activate(context) {
    const output = vscode.window.createOutputChannel('WeRead');
    context.subscriptions.push(output);
    const log = {
        info: (message) => {
            output.appendLine(message);
            console.log(message);
        },
        warn: (message) => {
            output.appendLine(message);
            console.warn(message);
        },
        error: (message) => {
            output.appendLine(message);
            console.error(message);
        },
    };
    log.info('[Activation] 微信读书插件开始激活');
    log.info('[Activation] 入口已返回，运行时将在后台加载');
    // 关键兜底：不等待后台初始化，避免扩展一直处于“正在激活”
    void (0, runtimeExtension_1.activateRuntime)(context, log).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[Activation] 运行时入口加载失败: ${message}`);
        vscode.window.showErrorMessage(`微信读书插件入口加载失败: ${message}`);
    });
    log.info('[Activation] activate() 已同步返回');
}
exports.activate = activate;
function deactivate() {
    try {
        (0, runtimeExtension_1.deactivateRuntime)();
    }
    catch (error) {
        console.warn('[Activation] 运行时停用失败', error);
    }
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map