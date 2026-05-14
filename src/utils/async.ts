export interface ActivationLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ActivationStepOptions {
  timeoutMs: number;
  critical?: boolean;
  logger: ActivationLogger;
}

export async function withTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function runActivationStep(
  stepName: string,
  step: () => Promise<void>,
  options: ActivationStepOptions
): Promise<boolean> {
  const { timeoutMs, critical = false, logger } = options;
  const start = Date.now();
  logger.info(`[Activation] Step start: ${stepName}`);

  try {
    await withTimeout(
      step,
      timeoutMs,
      `[Activation] Step timeout: ${stepName} (${timeoutMs}ms)`
    );
    logger.info(`[Activation] Step success: ${stepName} (${Date.now() - start}ms)`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[Activation] Step failed: ${stepName} (${Date.now() - start}ms) - ${message}`);
    if (critical) {
      throw error;
    }
    return false;
  }
}
