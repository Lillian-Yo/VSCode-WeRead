import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export function normalizeOutputPath(inputPath: string): string {
  const trimmed = inputPath.trim().replace(/^['"]|['"]$/g, '');
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export function getConfiguredOutputPath(): string | undefined {
  const configPath = vscode.workspace.getConfiguration('weread').get<string>('outputPath');
  if (!configPath || !configPath.trim()) {
    return undefined;
  }
  return normalizeOutputPath(configPath);
}

export function isPathWithinBase(targetPath: string, basePath: string): boolean {
  const relative = path.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export type OutputPathValidationResult = {
  ok: boolean;
  normalizedPath: string;
  reason?: string;
  code?: string;
};

async function ensureDirectoryIfMissing(normalizedPath: string, error: unknown): Promise<void> {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'ENOENT') {
    throw error;
  }
  await fs.promises.mkdir(normalizedPath, { recursive: true });
}

export async function validateOutputPathReadable(inputPath: string): Promise<OutputPathValidationResult> {
  const normalizedPath = normalizeOutputPath(inputPath);
  try {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(normalizedPath);
    } catch (error) {
      await ensureDirectoryIfMissing(normalizedPath, error);
      stat = await fs.promises.stat(normalizedPath);
    }
    if (!stat.isDirectory()) {
      return {
        ok: false,
        normalizedPath,
        code: 'NOT_DIRECTORY',
        reason: `路径不是目录：${normalizedPath}`,
      };
    }
    await fs.promises.access(normalizedPath, fs.constants.R_OK);
    return { ok: true, normalizedPath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code || 'READ_CHECK_FAILED';
    return {
      ok: false,
      normalizedPath,
      code,
      reason: `路径不可读：${normalizedPath}`,
    };
  }
}

export async function validateOutputPathWritable(inputPath: string): Promise<OutputPathValidationResult> {
  const normalizedPath = normalizeOutputPath(inputPath);
  try {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(normalizedPath);
    } catch (error) {
      await ensureDirectoryIfMissing(normalizedPath, error);
      stat = await fs.promises.stat(normalizedPath);
    }
    if (!stat.isDirectory()) {
      return {
        ok: false,
        normalizedPath,
        code: 'NOT_DIRECTORY',
        reason: `路径不是目录：${normalizedPath}`,
      };
    }
    await fs.promises.access(normalizedPath, fs.constants.W_OK);
    return { ok: true, normalizedPath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code || 'WRITE_CHECK_FAILED';
    return {
      ok: false,
      normalizedPath,
      code,
      reason: `路径不可写：${normalizedPath}`,
    };
  }
}
