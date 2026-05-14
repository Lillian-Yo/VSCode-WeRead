"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathConflictResolver = void 0;
const path = __importStar(require("path"));
class PathConflictResolver {
    constructor() {
        this.reservedPaths = new Set();
        this.lockChains = new Map();
    }
    async reserveUniquePath(desiredFilePath, exists, onConflict) {
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
    release(filePath) {
        this.reservedPaths.delete(path.resolve(filePath));
    }
    async withLock(key, task) {
        const previous = this.lockChains.get(key) || Promise.resolve();
        let releaseCurrent;
        const current = new Promise((resolve) => {
            releaseCurrent = resolve;
        });
        this.lockChains.set(key, previous.then(() => current));
        await previous;
        try {
            return await task();
        }
        finally {
            releaseCurrent?.();
            if (this.lockChains.get(key) === current) {
                this.lockChains.delete(key);
            }
        }
    }
}
exports.PathConflictResolver = PathConflictResolver;
//# sourceMappingURL=pathConflictResolver.js.map