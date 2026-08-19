/**
 * 搜索结果裁剪层（PRD §5.2）。
 *
 * 上游单本书带几十个字段（封面 URL、描述全文、评分、多语言标题…），原样吐给 LLM
 * 一次搜索轻松上万 token。这里做**白名单**投影：只保留 KEPT_FIELDS，多出来的一律丢弃。
 *
 * 设计约束：上游改版时宁可少字段，也不可意外灌爆上下文 —— 所以是白名单而非黑名单。
 * 上游字段名的变更集中在本文件的 pickBook 一处，改版只改这里。
 */

import type { RawSearchResponse } from './upstream/types.js';

/** 裁剪后对外暴露的字段集，与 PRD §5.2 一一对应。 */
export const KEPT_FIELDS = [
  'id',
  'hash',
  'title',
  'author',
  'year',
  'language',
  'extension',
  'filesize_human',
  'publisher',
] as const;

export interface ShapedBook {
  readonly id: string;
  readonly hash: string;
  readonly title: string;
  readonly author?: string;
  readonly year?: number;
  readonly language?: string;
  readonly extension?: string;
  readonly filesize_human?: string;
  readonly publisher?: string;
}

export interface ShapedSearchResult {
  readonly total: number | undefined;
  readonly page: number;
  readonly books: readonly ShapedBook[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** 只接受标量：上游偶尔把 id 给成数字，但对象 / 数组一律当缺失，避免 "[object Object]"。 */
function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function int(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

/** 上游给了 filesizeString 就用它；否则从字节数自己算，避免把裸字节丢给 LLM。 */
function humanSize(raw: Record<string, unknown>): string | undefined {
  const provided = text(raw['filesizeString']);
  if (provided !== undefined) return provided;

  const bytes = int(raw['filesize']);
  if (bytes === undefined || bytes <= 0) return undefined;

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit] ?? 'B'}`;
}

/**
 * 单本书投影。id 与 hash 缺一不可（后续下载的必需参数），缺失则整条丢弃 —— 返回一条
 * 用不了的记录只会让 Agent 白跑一趟。
 */
export function shapeBook(input: unknown): ShapedBook | undefined {
  const raw = asRecord(input);
  const id = text(raw['id']);
  const hash = text(raw['hash']);
  const title = text(raw['title']);
  if (id === undefined || hash === undefined || title === undefined) return undefined;

  const book: Record<string, unknown> = { id, hash, title };
  const author = text(raw['author']);
  const year = int(raw['year']);
  const language = text(raw['language']);
  const extension = text(raw['extension']);
  const filesize = humanSize(raw);
  const publisher = text(raw['publisher']);

  if (author !== undefined) book['author'] = author;
  if (year !== undefined) book['year'] = year;
  if (language !== undefined) book['language'] = language;
  if (extension !== undefined) book['extension'] = extension;
  if (filesize !== undefined) book['filesize_human'] = filesize;
  if (publisher !== undefined) book['publisher'] = publisher;

  return book as unknown as ShapedBook;
}

export function shapeSearchResponse(response: RawSearchResponse, page: number): ShapedSearchResult {
  const rawBooks = Array.isArray(response.books) ? response.books : [];
  const books = rawBooks.map(shapeBook).filter((book): book is ShapedBook => book !== undefined);

  const pagination = asRecord(response.pagination);
  const total = int(pagination['total_items']) ?? int(response.total);

  return { total, page, books };
}
