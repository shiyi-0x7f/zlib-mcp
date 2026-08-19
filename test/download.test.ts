import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ZlibError } from '../src/errors.js';
import { streamToDisk } from '../src/tools/download.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zlib-mcp-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 返回一个带指定 body / 头的下载响应。 */
function fileFetch(body: string | Uint8Array, headers: Record<string, string> = {}): typeof fetch {
  return () => Promise.resolve(new Response(body, { status: 200, headers }));
}

const baseOptions = {
  url: 'https://cdn.test/dl/token/book.epub',
  maxBytes: 1024,
  allowLarge: false,
  timeoutMs: 5000,
  requestedFilename: undefined,
};

describe('streamToDisk', () => {
  it('writes the body and reports the absolute path plus byte count', async () => {
    const result = await streamToDisk({
      ...baseOptions,
      downloadDir: dir,
      fetchImpl: fileFetch('hello world', { 'content-disposition': 'attachment; filename="book.epub"' }),
    });

    expect(result.filename).toBe('book.epub');
    expect(result.path).toBe(path.join(dir, 'book.epub'));
    expect(result.bytes).toBe(11);
    expect(readFileSync(result.path, 'utf8')).toBe('hello world');
  });

  it('falls back to the URL segment when there is no Content-Disposition', async () => {
    const result = await streamToDisk({ ...baseOptions, downloadDir: dir, fetchImpl: fileFetch('x') });
    expect(result.filename).toBe('book.epub');
  });

  it('neutralises a traversal filename from the upstream header (PRD 验收 7)', async () => {
    const result = await streamToDisk({
      ...baseOptions,
      downloadDir: dir,
      fetchImpl: fileFetch('x', { 'content-disposition': 'attachment; filename="../../../evil.sh"' }),
    });

    expect(result.filename).toBe('evil.sh');
    expect(path.dirname(result.path)).toBe(path.resolve(dir));
  });

  it('neutralises a traversal filename supplied by the caller', async () => {
    const result = await streamToDisk({
      ...baseOptions,
      downloadDir: dir,
      requestedFilename: '..\\..\\evil.epub',
      fetchImpl: fileFetch('x'),
    });

    expect(result.filename).toBe('evil.epub');
    expect(path.dirname(result.path)).toBe(path.resolve(dir));
  });

  it('never overwrites an existing file', async () => {
    writeFileSync(path.join(dir, 'book.epub'), 'original');

    const result = await streamToDisk({ ...baseOptions, downloadDir: dir, fetchImpl: fileFetch('new') });

    expect(result.filename).toBe('book (2).epub');
    expect(readFileSync(path.join(dir, 'book.epub'), 'utf8')).toBe('original');
  });

  it('refuses a file whose declared size exceeds the cap, before writing anything', async () => {
    const error = await streamToDisk({
      ...baseOptions,
      downloadDir: dir,
      fetchImpl: fileFetch('x'.repeat(10), { 'content-length': '99999999' }),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ZlibError);
    expect((error as ZlibError).kind).toBe('invalid_input');
    expect((error as ZlibError).message).toContain('allow_large');
  });

  it('aborts mid-stream and deletes the partial file when the cap is exceeded without Content-Length', async () => {
    const error = await streamToDisk({
      ...baseOptions,
      downloadDir: dir,
      maxBytes: 8,
      fetchImpl: fileFetch('x'.repeat(64)),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ZlibError);
    expect(() => readFileSync(path.join(dir, 'book.epub'))).toThrowError();
  });

  it('honours allow_large', async () => {
    const result = await streamToDisk({
      ...baseOptions,
      downloadDir: dir,
      maxBytes: 8,
      allowLarge: true,
      fetchImpl: fileFetch('x'.repeat(64), { 'content-length': '64' }),
    });

    expect(result.bytes).toBe(64);
  });

  it('creates the download directory when it does not exist yet', async () => {
    const nested = path.join(dir, 'nested', 'books');
    const result = await streamToDisk({ ...baseOptions, downloadDir: nested, fetchImpl: fileFetch('x') });

    expect(result.path).toBe(path.join(nested, 'book.epub'));
  });

  it('reports an expired link as an actionable upstream error', async () => {
    const dead = (() => Promise.resolve(new Response('gone', { status: 404 }))) as unknown as typeof fetch;
    const error = await streamToDisk({ ...baseOptions, downloadDir: dir, fetchImpl: dead }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ZlibError);
    expect((error as ZlibError).message).toContain('expired');
  });
});
