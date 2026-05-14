"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runActivationStep = exports.withTimeout = void 0;
async function withTimeout(task, timeoutMs, timeoutMessage) {
    let timer;
    try {
        return await Promise.race([
            task(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
exports.withTimeout = withTimeout;
async function runActivationStep(stepName, step, options) {
    const { timeoutMs, critical = false, logger } = options;
    const start = Date.now();
    logger.info(`[Activation] Step start: ${stepName}`);
    try {
        await withTimeout(step, timeoutMs, `[Activation] Step timeout: ${stepName} (${timeoutMs}ms)`);
        logger.info(`[Activation] Step success: ${stepName} (${Date.now() - start}ms)`);
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[Activation] Step failed: ${stepName} (${Date.now() - start}ms) - ${message}`);
        if (critical) {
            throw error;
        }
        return false;
    }
}
exports.runActivationStep = runActivationStep;
//# sourceMappingURL=async.js.map