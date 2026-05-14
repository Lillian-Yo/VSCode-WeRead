import * as fs from 'fs';
import * as path from 'path';

export class FileRepository {
  async ensureDirectory(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  async atomicWrite(filePath: string, content: string): Promise<void> {
    const dirPath = path.dirname(filePath);
    await this.ensureDirectory(dirPath);
    const fileName = path.basename(filePath);
    const tempFile = path.join(dirPath, `.${fileName}.${Date.now()}.${process.pid}.tmp`);
    try {
      await fs.promises.writeFile(tempFile, content, 'utf-8');
      await fs.promises.rename(tempFile, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(tempFile);
      } catch {
        // ignore temp cleanup error
      }
      throw error;
    }
  }

  async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, 'utf-8');
  }

  async stat(filePath: string): Promise<fs.Stats> {
    return fs.promises.stat(filePath);
  }
}

let fileRepositoryInstance: FileRepository | undefined;

export function getFileRepository(): FileRepository {
  if (!fileRepositoryInstance) {
    fileRepositoryInstance = new FileRepository();
  }
  return fileRepositoryInstance;
}
