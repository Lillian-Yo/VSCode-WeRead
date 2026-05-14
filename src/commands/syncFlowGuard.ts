export function isSyncInProgressError(error?: string): boolean {
  return error === '同步正在进行中';
}

export function isSyncInProgressSkip(
  result: { skipped: true; reason: string } | undefined
): boolean {
  return !!result && result.skipped && result.reason === 'sync_in_progress';
}
