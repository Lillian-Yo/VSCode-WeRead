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
exports.validateOutputPathWritable = exports.validateOutputPathReadable = exports.isPathWithinBase = exports.getConfiguredOutputPath = exports.normalizeOutputPath = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
function normalizeOutputPath(inputPath) {
    const trimmed = inputPath.trim().replace(/^['"]|['"]$/g, '');
    if (trimmed === '~') {
        return os.homedir();
    }
    if (trimmed.startsWith('~/')) {
        return path.join(os.homedir(), trimmed.slice(2));
    }
    return path.resolve(trimmed);
}
exports.normalizeOutputPath = normalizeOutputPath;
function getConfiguredOutputPath() {
    const configPath = vscode.workspace.getConfiguration('weread').get('outputPath');
    if (!configPath || !configPath.trim()) {
        return undefined;
    }
    return normalizeOutputPath(configPath);
}
exports.getConfiguredOutputPath = getConfiguredOutputPath;
function isPathWithinBase(targetPath, basePath) {
    const relative = path.relative(basePath, targetPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
exports.isPathWithinBase = isPathWithinBase;
async function ensureDirectoryIfMissing(normalizedPath, error) {
    const code = error.code;
    if (code !== 'ENOENT') {
        throw error;
    }
    await fs.promises.mkdir(normalizedPath, { recursive: true });
}
async function validateOutputPathReadable(inputPath) {
    const normalizedPath = normalizeOutputPath(inputPath);
    try {
        let stat;
        try {
            stat = await fs.promises.stat(normalizedPath);
        }
        catch (error) {
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
    }
    catch (error) {
        const code = error.code || 'READ_CHECK_FAILED';
        return {
            ok: false,
            normalizedPath,
            code,
            reason: `路径不可读：${normalizedPath}`,
        };
    }
}
exports.validateOutputPathReadable = validateOutputPathReadable;
async function validateOutputPathWritable(inputPath) {
    const normalizedPath = normalizeOutputPath(inputPath);
    try {
        let stat;
        try {
            stat = await fs.promises.stat(normalizedPath);
        }
        catch (error) {
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
    }
    catch (error) {
        const code = error.code || 'WRITE_CHECK_FAILED';
        return {
            ok: false,
            normalizedPath,
            code,
            reason: `路径不可写：${normalizedPath}`,
        };
    }
}
exports.validateOutputPathWritable = validateOutputPathWritable;
//# sourceMappingURL=outputPath.js.map