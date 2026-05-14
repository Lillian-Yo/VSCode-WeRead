/**
 * 配置管理
 */

import * as vscode from 'vscode';

export interface WeReadConfig {
  /** 笔记导出路径 */
  outputPath: string;
  /** 是否手动输入路径 */
  manualOutputPathInput: boolean;
  /** 路径配置方式 */
  outputPathInputMode: 'picker' | 'manual';
  /** 最近一次路径校验状态（系统维护字段） */
  lastValidationStatus: 'passed' | 'failed';
  /** 最近一次路径校验失败原因（系统维护字段） */
  lastValidationFailReason: string;
  /** 最近一次路径校验结果摘要（只读） */
  lastValidationSummary: string;
  /** 文件名模板 */
  fileNameTemplate: string;
  /** 笔记内容模板 */
  noteTemplate: string;
  /** 是否自动同步 */
  autoSync: boolean;
  /** 同步间隔选项 */
  syncInterval: '12h' | '24h' | '72h';
  /** 书架分类模式 */
  categoryMode: 'level1' | 'level2';
  /** 是否显示封面 */
  showCover: boolean;
  /** 插件显示语言 */
  language: 'zh-CN' | 'zh-TW' | 'en';
  /** 是否开启 canonical id 排查日志 */
  debugCanonicalIdLog: boolean;
  /** 是否启用多账号模式（回滚开关） */
  multiAccountEnabled: boolean;
}

export const DEFAULT_CONFIG: WeReadConfig = {
  outputPath: '',
  manualOutputPathInput: false,
  outputPathInputMode: 'picker',
  lastValidationStatus: 'passed',
  lastValidationFailReason: '',
  lastValidationSummary: 'passed',
  fileNameTemplate: '{{title}}',
  noteTemplate: '',
  autoSync: true,
  syncInterval: '24h',
  categoryMode: 'level1',
  showCover: true,
  language: 'zh-CN',
  debugCanonicalIdLog: false,
  multiAccountEnabled: true,
};

/**
 * 获取配置
 */
export function getConfig(): WeReadConfig {
  const config = vscode.workspace.getConfiguration('weread');

  return {
    outputPath: config.get<string>('outputPath', DEFAULT_CONFIG.outputPath),
    manualOutputPathInput: config.get<boolean>('manualOutputPathInput', DEFAULT_CONFIG.manualOutputPathInput),
    outputPathInputMode: config.get<'picker' | 'manual'>('outputPathInputMode', DEFAULT_CONFIG.outputPathInputMode),
    lastValidationStatus: config.get<'passed' | 'failed'>('lastValidationStatus', DEFAULT_CONFIG.lastValidationStatus),
    lastValidationFailReason: config.get<string>('lastValidationFailReason', DEFAULT_CONFIG.lastValidationFailReason),
    lastValidationSummary: config.get<string>('lastValidationSummary', DEFAULT_CONFIG.lastValidationSummary),
    fileNameTemplate: config.get<string>('fileNameTemplate', DEFAULT_CONFIG.fileNameTemplate),
    noteTemplate: config.get<string>('noteTemplate', DEFAULT_CONFIG.noteTemplate),
    autoSync: config.get<boolean>('autoSync', DEFAULT_CONFIG.autoSync),
    syncInterval: config.get<'12h' | '24h' | '72h'>('syncInterval', DEFAULT_CONFIG.syncInterval),
    categoryMode: config.get<'level1' | 'level2'>('categoryMode', DEFAULT_CONFIG.categoryMode),
    showCover: config.get<boolean>('showCover', DEFAULT_CONFIG.showCover),
    language: config.get<'zh-CN' | 'zh-TW' | 'en'>('language', DEFAULT_CONFIG.language),
    debugCanonicalIdLog: config.get<boolean>('debugCanonicalIdLog', DEFAULT_CONFIG.debugCanonicalIdLog),
    multiAccountEnabled: config.get<boolean>('multiAccountEnabled', DEFAULT_CONFIG.multiAccountEnabled),
  };
}

/**
 * 更新配置
 */
export async function updateConfig<K extends keyof WeReadConfig>(
  key: K,
  value: WeReadConfig[K]
): Promise<void> {
  const config = vscode.workspace.getConfiguration('weread');
  await config.update(key, value, true);
}

/**
 * 监听配置变化
 */
export function onConfigChange(
  callback: (config: WeReadConfig) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('weread')) {
      callback(getConfig());
    }
  });
}
