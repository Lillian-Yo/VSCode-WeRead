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
exports.getFileRepository = exports.FileRepository = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class FileRepository {
    async ensureDirectory(dirPath) {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }
    async atomicWrite(filePath, content) {
        const dirPath = path.dirname(filePath);
        await this.ensureDirectory(dirPath);
        const fileName = path.basename(filePath);
        const tempFile = path.join(dirPath, `.${fileName}.${Date.now()}.${process.pid}.tmp`);
        try {
            await fs.promises.writeFile(tempFile, content, 'utf-8');
            await fs.promises.rename(tempFile, filePath);
        }
        catch (error) {
            try {
                await fs.promises.unlink(tempFile);
            }
            catch {
                // ignore temp cleanup error
            }
            throw error;
        }
    }
    async readFile(filePath) {
        return fs.promises.readFile(filePath, 'utf-8');
    }
    async stat(filePath) {
        return fs.promises.stat(filePath);
    }
}
exports.FileRepository = FileRepository;
let fileRepositoryInstance;
function getFileRepository() {
    if (!fileRepositoryInstance) {
        fileRepositoryInstance = new FileRepository();
    }
    return fileRepositoryInstance;
}
exports.getFileRepository = getFileRepository;
//# sourceMappingURL=fileRepository.js.map