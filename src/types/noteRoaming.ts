import { NoteType } from '../models';

export type RoamingAction = 'view' | 'review' | 'skip' | 'openSource' | 'favorite' | 'unfavorite';

export type RoamingNoteTypeFilter = 'highlight' | 'thought' | 'chapter' | 'review';

export interface RoamingFilter {
  noteTypes?: RoamingNoteTypeFilter[];
  favoriteOnly?: boolean;
  minDaysUnreviewed?: number;
}

export interface RoamingNoteMeta {
  noteKey: string;
  noteId?: string;
  favorite: boolean;
  favoriteAt?: number;
  lastReviewedAt?: number;
  reviewCount: number;
  skipCount: number;
  openSourceCount: number;
  seenCount: number;
  lastSeenAt?: number;
  updatedAt: number;
}

export interface RoamingMetaStore {
  version: 1;
  records: Record<string, RoamingNoteMeta>;
  updatedAt: number;
}

export interface RoamingCandidate {
  noteKey: string;
  noteId?: string;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  /** 笔记级作者（如出品方），与书籍作者不同 */
  author?: string;
  category?: string;
  chapterUid: number;
  chapterTitle?: string;
  noteType: NoteType;
  rawText: string;
  text: string;
  createTime: number;
  meta: RoamingNoteMeta;
}

export interface RoamingSamplingOptions {
  recentNoteKeys?: string[];
  recentChapterKeys?: string[];
  recentBookIds?: string[];
  cooldownMs?: number;
  nowMs?: number;
  rng?: () => number;
}

export interface RoamingPickResult {
  candidate?: RoamingCandidate;
  totalCandidates: number;
  eligibleCandidates: number;
  reason?: 'empty_pool' | 'cooldown_filtered';
}
