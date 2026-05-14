/**
 * 书籍模型定义
 */

export enum ReadingStatus {
  NotStarted = 0,
  Reading = 1,
  Finished = 2,
}

export interface Book {
  /** 书籍ID */
  bookId: string;
  /** 原始 bookid / docid */
  rawBookId?: string;
  /** 文档类型 */
  docType?: string;
  /** 书名 */
  title: string;
  /** 作者 */
  author: string;
  /** 封面图片URL */
  cover: string;
  /** ISBN */
  isbn?: string;
  /** 出版社 */
  publisher?: string;
  /** 出版时间 */
  publishTime?: string;
  /** 分类 */
  category?: string;
  /** 书评数量 */
  reviewCount?: number;
  /** 阅读进度 (0-100) */
  progress: number;
  /** 阅读状态 */
  readingStatus: ReadingStatus;
  /** 总阅读天数 */
  totalReadDay?: number;
  /** 阅读时长（分钟） */
  readingTime?: number;
  /** 阅读日期 */
  readingDate?: string;
  /** 最近阅读时间 */
  lastReadTime?: number;
  /** 划线数量 */
  highlightCount: number;
  /** 笔记数量 */
  noteCount: number;
  /** 总章节数 */
  chapterCount?: number;
  /** 简介 */
  intro?: string;
  /** 微信读书 PC 地址 */
  pcUrl?: string;
  /** 本地笔记文件绝对路径（本地目录重载场景） */
  localFilePath?: string;
}

export interface BookDetail extends Book {
  /** 章节列表 */
  chapters: Chapter[];
  /** 笔记列表 */
  notes: Note[];
  /** 书评 */
  review?: BookReview;
}

export interface Chapter {
  /** 章节ID */
  chapterUid: number;
  /** 章节标题 */
  title: string;
  /** 章节序号 */
  chapterIdx: number;
  /** 父章节ID */
  parentUid?: number;
  /** 层级 */
  level: number;
}

export interface Note {
  /** 笔记ID */
  noteId: string;
  /** 书籍ID */
  bookId: string;
  /** 章节ID */
  chapterUid: number;
  /** 章节标题 */
  chapterTitle?: string;
  /** 笔记类型 */
  type: NoteType;
  /** 划线文本 */
  highlightText?: string;
  /** 想法/笔记内容 */
  thoughtText?: string;
  /** 创建时间 */
  createTime: number;
  /** 修改时间 */
  modifyTime?: number;
  /** 原文范围 */
  range?: string;
  /** 样式 */
  style?: NoteStyle;
  /** 笔记来源作者（如丛书出品方、API 返回等；与书籍 author 不同） */
  author?: string;
}

export enum NoteType {
  /** 划线 */
  Highlight = 1,
  /** 想法 */
  Thought = 2,
  /** 章节笔记 */
  Chapter = 3,
  /** 书评 */
  Review = 4,
}

export interface NoteStyle {
  /** 划线颜色 */
  color?: string;
  /** 是否加粗 */
  bold?: boolean;
  /** 是否斜体 */
  italic?: boolean;
}

export interface BookReview {
  /** 书评ID */
  reviewId: string;
  /** 书籍ID */
  bookId: string;
  /** 评分 */
  rating?: number;
  /** 书评内容 */
  content: string;
  /** 创建时间 */
  createTime: number;
  /** 修改时间 */
  modifyTime?: number;
}

export interface ShelfBook {
  /** 书籍信息 */
  book: Book;
  /** 最后阅读时间 */
  lastReadTime: number;
  /** 阅读进度 */
  progress: number;
}

export interface ShelfResponse {
  /** 书架书籍列表 */
  books: ShelfBook[];
  /** 总数 */
  totalCount: number;
  /** 更新时间 */
  syncTime: number;
}

export interface DailyAggRecord {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 当日是否活跃阅读（0/1） */
  readDaysFlag: 0 | 1;
  /** 当日笔记总数 */
  notesCount: number;
  /** 当日触达书籍数 */
  booksTouched: number;
}
