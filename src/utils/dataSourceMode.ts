import * as vscode from 'vscode';

export type WeReadDataSourceMode = 'dual' | 'file_ssot';

export function resolveDataSourceMode(raw: string | undefined): WeReadDataSourceMode {
  if (raw === 'dual') {
    return 'dual';
  }
  return 'file_ssot';
}

export function getDataSourceMode(): WeReadDataSourceMode {
  const raw = vscode.workspace.getConfiguration('weread').get<string>('dataSourceMode');
  return resolveDataSourceMode(raw);
}

export function isFileSsotMode(): boolean {
  return getDataSourceMode() === 'file_ssot';
}
