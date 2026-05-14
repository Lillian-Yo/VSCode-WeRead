import * as vscode from 'vscode';
import { DedupeConflict } from './indexDedup';

let dedupeOutput: vscode.OutputChannel | undefined;

function getDedupeOutput(): vscode.OutputChannel {
  if (!dedupeOutput) {
    dedupeOutput = vscode.window.createOutputChannel('WeRead 书架去重日志');
  }
  return dedupeOutput;
}

export function logIndexDedupeConflicts(source: string, conflicts: DedupeConflict[]): void {
  if (conflicts.length === 0) {
    return;
  }
  const output = getDedupeOutput();
  output.appendLine(
    `[${new Date().toISOString()}] [index.dedupe] source=${source} collapsed=${conflicts.length}`
  );
  for (const conflict of conflicts) {
    output.appendLine(
      `[index.dedupe.item] key=${conflict.key} dropped=${conflict.dropped.filePath} kept=${conflict.kept.filePath} reason=${conflict.reason}`
    );
  }
}
