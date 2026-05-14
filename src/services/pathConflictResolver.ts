import * as path from 'path';

type ExistsFn = (filePath: string) => Promise<boolean>;

export class PathConflictResolver {
  private readonly reservedPaths = new Set<string>();
  private readonly lockChains = new Map<string, Promise<void>>();

  async reserveUniquePath(
    desiredFilePath: string,
    exists: ExistsFn,
    onConflict?: (fromPath: string, toPath: string, index: number) => void
  ): Promise<string> {
    const normalizedDesired = path.resolve(desiredFilePath);
    const ext = path.extname(normalizedDesired);
    const dir = path.dirname(normalizedDesired);
    const baseName = path.basename(normalizedDesired, ext);
    const lockKey = `${dir}::${baseName.toLowerCase()}::${ext.toLowerCase()}`;

    return this.withLock(lockKey, async () => {
      let index = 0;
      while (true) {
        const candidateName = index === 0 ? baseName : `${baseName}_${index}`;
        const candidatePath = path.join(dir, `${candidateName}${ext}`);
        const normalizedCandidate = path.resolve(candidatePath);

        const usedByRuntime = this.reservedPaths.has(normalizedCandidate);
        const usedByDisk = await exists(normalizedCandidate);
        if (!usedByRuntime && !usedByDisk) {
          this.reservedPaths.add(normalizedCandidate);
          if (index > 0 && onConflict) {
            onConflict(normalizedDesired, normalizedCandidate, index);
          }
          return normalizedCandidate;
        }
        index += 1;
      }
    });
  }

  release(filePath: string): void {
    this.reservedPaths.delete(path.resolve(filePath));
  }

  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.lockChains.get(key) || Promise.resolve();
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.lockChains.set(key, previous.then(() => current));

    await previous;
    try {
      return await task();
    } finally {
      releaseCurrent?.();
      if (this.lockChains.get(key) === current) {
        this.lockChains.delete(key);
      }
    }
  }
}
