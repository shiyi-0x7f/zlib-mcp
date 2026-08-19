import { describe, expect, it } from 'vitest';

import { KEPT_FIELDS, shapeBook, shapeSearchResponse } from '../src/shaping.js';

const rawBook = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '4242',
  hash: 'deadbeef',
  title: 'Designing Data-Intensive Applications',
  author: 'Martin Kleppmann',
  year: 2017,
  language: 'English',
  extension: 'epub',
  filesize: 4_500_000,
  filesizeString: '4.29 MB',
  publisher: "O'Reilly",
  ...overrides,
});

describe('shapeBook', () => {
  it('keeps exactly the whitelisted fields', () => {
    const shaped = shapeBook(rawBook());
    expect(Object.keys(shaped ?? {}).sort()).toEqual([...KEPT_FIELDS].sort());
  });

  it('drops context-eating fields the upstream adds', () => {
    const shaped = shapeBook(
      rawBook({
        cover: 'https://example.test/cover.jpg',
        description: 'x'.repeat(5000),
        rating: 4.7,
        identifier: '978-1449373320',
        titleAlternative: ['…'],
      }),
    );

    expect(shaped).not.toHaveProperty('cover');
    expect(shaped).not.toHaveProperty('description');
    expect(shaped).not.toHaveProperty('rating');
    expect(JSON.stringify(shaped).length).toBeLessThan(400);
  });

  it('discards a book with no id or hash — it cannot be downloaded', () => {
    expect(shapeBook(rawBook({ hash: undefined }))).toBeUndefined();
    expect(shapeBook(rawBook({ id: '' }))).toBeUndefined();
    expect(shapeBook(rawBook({ title: null }))).toBeUndefined();
    expect(shapeBook(null)).toBeUndefined();
  });

  it('omits optional fields instead of emitting nulls', () => {
    const shaped = shapeBook({ id: '1', hash: 'h', title: 't', author: null, year: '', publisher: '  ' });
    expect(shaped).toEqual({ id: '1', hash: 'h', title: 't' });
  });

  it('derives a human size when the upstream only gives bytes', () => {
    expect(shapeBook(rawBook({ filesizeString: undefined }))?.filesize_human).toBe('4.3 MB');
    expect(shapeBook(rawBook({ filesizeString: undefined, filesize: 900 }))?.filesize_human).toBe('900 B');
    expect(shapeBook(rawBook({ filesizeString: undefined, filesize: 0 }))?.filesize_human).toBeUndefined();
  });

  it('coerces a numeric id to a string so downstream tools get a stable type', () => {
    expect(shapeBook(rawBook({ id: 4242 }))?.id).toBe('4242');
  });
});

describe('shapeSearchResponse', () => {
  it('projects the book list and carries total + page', () => {
    const result = shapeSearchResponse(
      { books: [rawBook(), rawBook({ id: '4243' })], pagination: { total_items: 87 } },
      3,
    );

    expect(result.total).toBe(87);
    expect(result.page).toBe(3);
    expect(result.books).toHaveLength(2);
  });

  it('filters out unusable entries rather than returning them', () => {
    const result = shapeSearchResponse({ books: [rawBook(), { title: 'no id or hash' }] }, 1);
    expect(result.books).toHaveLength(1);
  });

  it('survives a missing or non-array books field', () => {
    expect(shapeSearchResponse({}, 1).books).toEqual([]);
    expect(shapeSearchResponse({ books: 'nope' }, 1).books).toEqual([]);
  });

  it('keeps a default page of 10 results under the 2000-token budget (PRD 验收 2)', () => {
    // 上游每本书塞了几千字的 description —— 不裁剪的话单页就上万 token。
    const books = Array.from({ length: 10 }, (_, i) => rawBook({ id: String(i), description: 'x'.repeat(3000) }));
    const json = JSON.stringify(shapeSearchResponse({ books, pagination: { total_items: 10 } }, 1));

    // 粗估 4 字符 ≈ 1 token。
    expect(json.length / 4).toBeLessThan(2000);
  });

  it('costs a bounded amount per book, so limit=50 stays predictable', () => {
    const books = Array.from({ length: 50 }, (_, i) => rawBook({ id: String(i), description: 'x'.repeat(3000) }));
    const json = JSON.stringify(shapeSearchResponse({ books, pagination: { total_items: 50 } }, 1));

    // ≈60 token/本：裁剪后的体积只跟条数走，不跟上游 description 长度走。
    expect(json.length / 4 / 50).toBeLessThan(60);
  });
});
