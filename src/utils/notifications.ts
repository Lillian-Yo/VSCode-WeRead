/**
 * 通知工具
 * 统一错误提示和用户通知
 */

import * as vscode from 'vscode';
import { WeReadError, ErrorCode, parseError } from './errors';

/**
 * 显示错误通知
 */
export function showError(error: unknown, action?: { title: string; callback: () => void }): void {
  const weReadError = parseError(error);

  // 根据错误类型显示不同的提示
  switch (weReadError.code) {
    case ErrorCode.LOGIN_EXPIRED:
      showLoginExpiredError(weReadError, action);
      break;
    case ErrorCode.NETWORK_ERROR:
    case ErrorCode.TIMEOUT_ERROR:
      showNetworkError(weReadError, action);
      break;
    case ErrorCode.SYNC_ERROR:
      showSyncError(weReadError, action);
      break;
    case ErrorCode.EXPORT_ERROR:
      showExportError(weReadError);
      break;
    default:
      showGenericError(weReadError, action);
  }
}

/**
 * 显示登录过期错误
 */
function showLoginExpiredError(error: WeReadError, action?: { title: string; callback: () => void }): void {
  const message = error.message;

  if (action) {
    vscode.window.showErrorMessage(message, action.title, '取消').then((result) => {
      if (result === action.title) {
        action.callback();
      }
    });
  } else {
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
function showNetworkError(error: WeReadError, action?: { title: string; callback: () => void }): void {
  const message = error.message;

  if (action && error.retryable) {
    vscode.window.showErrorMessage(message, action.title, '重试', '取消').then((result) => {
      if (result === action.title) {
        action.callback();
      } else if (result === '重试') {
        // 重新执行操作
        action.callback();
      }
    });
  } else {
    vscode.window.showErrorMessage(message);
  }
}

/**
 * 显示同步错误
 */
function showSyncError(error: WeReadError, action?: { title: string; callback: () => void }): void {
  const message = `同步失败: ${error.message}`;

  if (action && error.retryable) {
    vscode.window.showErrorMessage(message, '重试', '取消').then((result) => {
      if (result === '重试') {
        action.callback();
      }
    });
  } else {
    vscode.window.showErrorMessage(message);
  }
}

/**
 * 显示导出错误
 */
function showExportError(error: WeReadError): void {
  vscode.window.showErrorMessage(`导出失败: ${error.message}`);
}

/**
 * 显示通用错误
 */
function showGenericError(error: WeReadError, action?: { title: string; callback: () => void }): void {
  if (action) {
    vscode.window.showErrorMessage(error.message, action.title).then((result) => {
      if (result === action.title) {
        action.callback();
      }
    });
  } else {
    vscode.window.showErrorMessage(error.message);
  }
}

/**
 * 显示成功通知
 */
export function showSuccess(message: string): void {
  vscode.window.showInformationMessage(`✅ ${message}`);
}

/**
 * 显示信息通知
 */
export function showInfo(message: string): void {
  vscode.window.showInformationMessage(message);
}

/**
 * 显示警告通知
 */
export function showWarning(message: string): void {
  vscode.window.showWarningMessage(`⚠️ ${message}`);
}

/**
 * 显示进度通知
 */
export async function showProgress<T>(
  title: string,
  task: (progress: vscode.Progress<{ increment?: number; message?: string }>) => Promise<T>
): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    task
  );
}

/**
 * 显示确认对话框
 */
export async function showConfirm(message: string, confirmText = '确认', cancelText = '取消'): Promise<boolean> {
  const result = await vscode.window.showInformationMessage(message, confirmText, cancelText);
  return result === confirmText;
}

/**
 * 显示输入框
 */
export async function showInput(
  prompt: string,
  placeHolder?: string,
  validateInput?: (value: string) => string | undefined
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    placeHolder,
    validateInput,
  });
}

/**
 * 显示快速选择
 */
export async function showQuickPick<T extends vscode.QuickPickItem>(
  items: T[],
  placeHolder?: string
): Promise<T | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder,
  });
}
