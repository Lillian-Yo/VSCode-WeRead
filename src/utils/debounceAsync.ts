type Deferred<T> = {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

/**
 * 将高频异步触发合并为单次调用，并把同一批次结果透传给所有调用者。
 */
export function createDebouncedAsync<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  waitMs: number
): (...args: TArgs) => Promise<TResult> {
  let timer: NodeJS.Timeout | undefined;
  let lastArgs: TArgs | undefined;
  let queued: Array<Deferred<TResult>> = [];
  let inFlight: Promise<TResult> | undefined;

  const flush = (): void => {
    timer = undefined;
    const args = lastArgs as TArgs;
    const currentBatch = queued;
    queued = [];

    inFlight = Promise.resolve()
      .then(() => fn(...args))
      .then(
        (result) => {
          currentBatch.forEach((item) => item.resolve(result));
          return result;
        },
        (error) => {
          currentBatch.forEach((item) => item.reject(error));
          throw error;
        }
      )
      .finally(() => {
        inFlight = undefined;
      });
  };

  return (...args: TArgs): Promise<TResult> => {
    if (inFlight) {
      return inFlight;
    }

    lastArgs = args;
    if (timer) {
      clearTimeout(timer);
    }

    return new Promise<TResult>((resolve, reject) => {
      queued.push({ resolve, reject });
      timer = setTimeout(flush, waitMs);
    });
  };
}
