/**
 * 文件真源模式下的索引元数据模型
 */

export interface IndexErrorEntry {
  /** 发生错误的文件路径 */
  filePath: string;
  /** 错误码 */
  code: string;
  /** 错误信息 */
  message: string;
}

export interface IndexBookEntry {
  /** 归一化后的书籍ID */
  bookId: string;
  /** 原始书籍ID */
  rawBookId?: string;
  /** 书名 */
  title: string;
  /** 作者 */
  author?: string;
  /** 分类 */
  category?: string;
  /** 笔记数量 */
  noteCount: number;
  /** 划线数量 */
  highlightCount: number;
  /** 最近阅读时间 */
  lastReadTime?: number;
  /** 文件绝对路径 */
  filePath: string;
  /** 文件修改时间（毫秒） */
  fileMtimeMs: number;
  /** 文件大小（字节） */
  fileSize: number;
  /** 文件内容摘要（可选） */
  contentHash?: string;
}

export interface IndexSnapshot {
  /** 索引结构版本 */
  schemaVersion: number;
  /** 索引对应的输出目录 */
  outputPath: string;
  /** 索引构建时间（毫秒） */
  builtAt: number;
  /** 书籍索引项 */
  books: IndexBookEntry[];
  /** 构建过程中的错误集合 */
  errors: IndexErrorEntry[];
}

export interface IndexScanState {
  /** 最近扫描时间（毫秒） */
  lastScanAt: number;
  /** 最近扫描耗时（毫秒） */
  durationMs?: number;
  /** 最近扫描根目录 */
  outputPath?: string;
  /** 最近扫描文件数 */
  scannedFiles?: number;
  /** 最近变更文件数 */
  changedFiles?: number;
  /** 最近错误数 */
  errorCount?: number;
}
