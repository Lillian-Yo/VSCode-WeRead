const warnedKeys = new Set<string>();

export function warnDeprecatedNoAccountParam(scope: string, activeAccountId?: string): void {
  const key = `${scope}:${activeAccountId || ''}`;
  if (warnedKeys.has(key)) {
    return;
  }
  warnedKeys.add(key);
  const suffix = activeAccountId ? ` (activeAccountId=${activeAccountId})` : '';
  console.warn(`[weread][deprecated] ${scope} 未显式传入 accountId，已转发到当前活跃账号${suffix}`);
}
