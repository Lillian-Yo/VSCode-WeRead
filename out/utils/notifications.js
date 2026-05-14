"use strict";
/**
 * 通知工具
 * 统一错误提示和用户通知
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
exports.showQuickPick = exports.showInput = exports.showConfirm = exports.showProgress = exports.showWarning = exports.showInfo = exports.showSuccess = exports.showError = void 0;
const vscode = __importStar(require("vscode"));
const errors_1 = require("./errors");
/**
 * 显示错误通知
 */
function showError(error, action) {
    const weReadError = (0, errors_1.parseError)(error);
    // 根据错误类型显示不同的提示
    switch (weReadError.code) {
        case errors_1.ErrorCode.LOGIN_EXPIRED:
            showLoginExpiredError(weReadError, action);
            break;
        case errors_1.ErrorCode.NETWORK_ERROR:
        case errors_1.ErrorCode.TIMEOUT_ERROR:
            showNetworkError(weReadError, action);
            break;
        case errors_1.ErrorCode.SYNC_ERROR:
            showSyncError(weReadError, action);
            break;
        case errors_1.ErrorCode.EXPORT_ERROR:
            showExportError(weReadError);
            break;
        default:
            showGenericError(weReadError, action);
    }
}
exports.showError = showError;
/**
 * 显示登录过期错误
 */
function showLoginExpiredError(error, action) {
    const message = error.message;
    if (action) {
        vscode.window.showErrorMessage(message, action.title, '取消').then((result) => {
            if (result === action.title) {
                action.callback();
            }
        });
    }
    else {
        vscode.window
            .showErrorMessage(message, '重新登录', '取消')
            .then((result) => {
            if (result === '重新登录') {
                vscode.commands.executeCommand('weread.login');
            }
        });
    }
}
/**
 * 显示网络错误
 */
function showNetworkError(error, action) {
    const message = error.message;
    if (action && error.retryable) {
        vscode.window.showErrorMessage(message, action.title, '重试', '取消').then((result) => {
            if (result === action.title) {
                action.callback();
            }
            else if (result === '重试') {
                // 重新执行操作
                action.callback();
            }
        });
    }
    else {
        vscode.window.showErrorMessage(message);
    }
}
/**
 * 显示同步错误
 */
function showSyncError(error, action) {
    const message = `同步失败: ${error.message}`;
    if (action && error.retryable) {
        vscode.window.showErrorMessage(message, '重试', '取消').then((result) => {
            if (result === '重试') {
                action.callback();
            }
        });
    }
    else {
        vscode.window.showErrorMessage(message);
    }
}
/**
 * 显示导出错误
 */
function showExportError(error) {
    vscode.window.showErrorMessage(`导出失败: ${error.message}`);
}
/**
 * 显示通用错误
 */
function showGenericError(error, action) {
    if (action) {
        vscode.window.showErrorMessage(error.message, action.title).then((result) => {
            if (result === action.title) {
                action.callback();
            }
        });
    }
    else {
        vscode.window.showErrorMessage(error.message);
    }
}
/**
 * 显示成功通知
 */
function showSuccess(message) {
    vscode.window.showInformationMessage(`✅ ${message}`);
}
exports.showSuccess = showSuccess;
/**
 * 显示信息通知
 */
function showInfo(message) {
    vscode.window.showInformationMessage(message);
}
exports.showInfo = showInfo;
/**
 * 显示警告通知
 */
function showWarning(message) {
    vscode.window.showWarningMessage(`⚠️ ${message}`);
}
exports.showWarning = showWarning;
/**
 * 显示进度通知
 */
async function showProgress(title, task) {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
    }, task);
}
exports.showProgress = showProgress;
/**
 * 显示确认对话框
 */
async function showConfirm(message, confirmText = '确认', cancelText = '取消') {
    const result = await vscode.window.showInformationMessage(message, confirmText, cancelText);
    return result === confirmText;
}
exports.showConfirm = showConfirm;
/**
 * 显示输入框
 */
async function showInput(prompt, placeHolder, validateInput) {
    return vscode.window.showInputBox({
        prompt,
        placeHolder,
        validateInput,
    });
}
exports.showInput = showInput;
/**
 * 显示快速选择
 */
async function showQuickPick(items, placeHolder) {
    return vscode.window.showQuickPick(items, {
        placeHolder,
    });
}
exports.showQuickPick = showQuickPick;
//# sourceMappingURL=notifications.js.map