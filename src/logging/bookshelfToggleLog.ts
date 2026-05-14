import * as vscode from 'vscode';

const BOOKSHELF_TOGGLE_CHANNEL_NAME = 'WeRead 书架切换日志';
const MAX_LOG_LINES = 400;

let outputChannel: vscode.OutputChannel | undefined;
const bufferedLines: string[] = [];

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(BOOKSHELF_TOGGLE_CHANNEL_NAME);
  }
  return outputChannel;
}

function appendLine(line: string): void {
  bufferedLines.push(line);
  if (bufferedLines.length > MAX_LOG_LINES) {
    bufferedLines.splice(0, bufferedLines.length - MAX_LOG_LINES);
  }
  getOutputChannel().appendLine(line);
}

function formatLine(level: 'INFO' | 'WARN' | 'ERROR', message: string): string {
  return `[${new Date().toISOString()}] [${level}] [BookshelfToggle] ${message}`;
}

export function logBookshelfToggle(
  message: string,
  level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'
): void {
  const line = formatLine(level, message);
  appendLine(line);
  if (level === 'ERROR') {
    console.error(line);
    return;
  }
  if (level === 'WARN') {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function showBookshelfToggleLogs(preserveFocus = false): void {
  getOutputChannel().show(preserveFocus);
}

export async function copyBookshelfToggleLogs(): Promise<number> {
  const content = bufferedLines.length > 0
    ? bufferedLines.join('\n')
    : formatLine('INFO', '当前还没有捕获到书架切换日志');
  await vscode.env.clipboard.writeText(content);
  return bufferedLines.length;
}

export function clearBookshelfToggleLogs(): void {
  bufferedLines.length = 0;
  getOutputChannel().clear();
  appendLine(formatLine('INFO', '日志已清空，等待下一次书架切换操作'));
}
