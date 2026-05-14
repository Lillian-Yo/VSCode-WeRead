"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDebouncedAsync = void 0;
/**
 * 将高频异步触发合并为单次调用，并把同一批次结果透传给所有调用者。
 */
function createDebouncedAsync(fn, waitMs) {
    let timer;
    let lastArgs;
    let queued = [];
    let inFlight;
    const flush = () => {
        timer = undefined;
        const args = lastArgs;
        const currentBatch = queued;
        queued = [];
        inFlight = Promise.resolve()
            .then(() => fn(...args))
            .then((result) => {
            currentBatch.forEach((item) => item.resolve(result));
            return result;
        }, (error) => {
            currentBatch.forEach((item) => item.reject(error));
            throw error;
        })
            .finally(() => {
            inFlight = undefined;
        });
    };
    return (...args) => {
        if (inFlight) {
            return inFlight;
        }
        lastArgs = args;
        if (timer) {
            clearTimeout(timer);
        }
        return new Promise((resolve, reject) => {
            queued.push({ resolve, reject });
            timer = setTimeout(flush, waitMs);
        });
    };
}
exports.createDebouncedAsync = createDebouncedAsync;
//# sourceMappingURL=debounceAsync.js.map