/**
 * 统一的 bookId 归一化工具
 */

export function normalizeBookId(raw: string): string {
  return raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').trim() || `local_${Date.now()}`;
}
