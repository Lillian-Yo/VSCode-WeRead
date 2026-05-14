/**
 * 微信读书 VSCode 插件入口
 */

import * as vscode from 'vscode';
import { activateRuntime, deactivateRuntime } from './runtimeExtension';

console.log('[Activation][Module] weread extension module loaded');

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('WeRead');
  context.subscriptions.push(output);
  const log = {
    info: (message: string) => {
      output.appendLine(message);
      console.log(message);
    },
    warn: (message: string) => {
      output.appendLine(message);
      console.warn(message);
    },
    error: (message: string) => {
      output.appendLine(message);
      console.error(message);
    },
  };

  log.info('[Activation] 微信读书插件开始激活');
  log.info('[Activation] 入口已返回，运行时将在后台加载');

  // 关键兜底：不等待后台初始化，避免扩展一直处于“正在激活”
  void activateRuntime(context, log).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[Activation] 运行时入口加载失败: ${message}`);
    vscode.window.showErrorMessage(`微信读书插件入口加载失败: ${message}`);
  });
  log.info('[Activation] activate() 已同步返回');
}

export function deactivate() {
  try {
    deactivateRuntime();
  } catch (error) {
    console.warn('[Activation] 运行时停用失败', error);
  }
}
