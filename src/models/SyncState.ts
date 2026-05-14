/**
 * 同步状态模型定义
 */

export interface SyncState {
  /** 上次同步时间 */
  lastSyncTime: number;
  /** 同步状态 */
  status: SyncStatus;
  /** 同步进度 */
  progress?: SyncProgress;
  /** 错误信息 */
  error?: string;
  /** 数据版本 */
  dataVersion: number;
}

export enum SyncStatus {
  /** 空闲 */
  Idle = 'idle',
  /** 同步中 */
  Syncing = 'syncing',
  /** 成功 */
  Success = 'success',
  /** 失败 */
  Failed = 'failed',
}

export interface SyncProgress {
  /** 账号 ID */
  accountId?: string;
  /** 当前步骤 */
  currentStep: SyncStep;
  /** 当前书籍索引 */
  currentBookIndex: number;
  /** 总书籍数 */
  totalBooks: number;
  /** 已同步笔记数 */
  syncedNotes?: number;
  /** 总笔记数（估算或统计） */
  totalNotes?: number;
  /** 已同步书籍数 */
  syncedBooks?: number;
  /** 当前书籍名称 */
  currentBookName?: string;
  /** 完成百分比 */
  percentage: number;
}

export enum SyncStep {
  /** 获取书架 */
  FetchingShelf = 'fetching_shelf',
  /** 获取书籍详情 */
  FetchingBookDetails = 'fetching_book_details',
  /** 获取笔记 */
  FetchingNotes = 'fetching_notes',
  /** 保存数据 */
  SavingData = 'saving_data',
  /** 完成 */
  Completed = 'completed',
}

export interface BookSyncState {
  /** 书籍ID */
  bookId: string;
  /** 上次同步时间 */
  lastSyncTime: number;
  /** 本地笔记数量 */
  localNoteCount: number;
  /** 云端笔记数量 */
  remoteNoteCount: number;
  /** 是否需要同步 */
  needsSync: boolean;
}

export interface SyncResult {
  /** 账号 ID */
  accountId?: string;
  /** 是否成功 */
  success: boolean;
  /** 同步的书籍数量 */
  syncedBooks: number;
  /** 同步的笔记数量 */
  syncedNotes: number;
  /** 错误信息 */
  error?: string;
  /** 同步时间 */
  syncTime: number;
}
