import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { filenameFromContentDisposition, resolveWithinDir, sanitizeFilename, uniquePath } from '../src/safe-path.js';

describe('sanitizeFilename (PRD 验收 7)', () => {
  it('collapses traversal sequences to a bare basename', () => {
    expect(sanitizeFilename('../../evil')).toBe('evil');
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..')).toBe('download');
    expect(sanitizeFilename('.')).toBe('download');
  });

  it('strips Windows drive paths and backslashes', () => {
    expect(sanitizeFilename('C:\\Windows\\System32\\evil.dll')).toBe('evil.dll');
    expect(sanitizeFilename('..\\..\\evil.exe')).toBe('evil.exe');
  });

  it('replaces Windows-illegal characters', () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.epub')).toBe('a_b_c_d_e_f_g_h.epub');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('book\u0000\u001f.epub')).toBe('book__.epub');
  });

  it('defuses Windows reserved device names, with or without an extension', () => {
    expect(sanitizeFilename('CON')).toBe('CON_');
    expect(sanitizeFilename('con.txt')).toBe('con_.txt');
    expect(sanitizeFilename('NUL.epub')).toBe('NUL_.epub');
    expect(sanitizeFilename('COM1')).toBe('COM1_');
    expect(sanitizeFilename('LPT9.pdf')).toBe('LPT9_.pdf');
  });

  it('leaves a legitimate name alone, including non-ASCII', () => {
    expect(sanitizeFilename('Designing Data-Intensive Applications.epub')).toBe(
      'Designing Data-Intensive Applications.epub',
    );
    expect(sanitizeFilename('数据密集型应用系统设计.epub')).toBe('数据密集型应用系统设计.epub');
  });

  it('drops trailing dots and spaces that Windows would silently discard', () => {
    expect(sanitizeFilename('book.epub. ')).toBe('book.epub');
    expect(sanitizeFilename('book   ')).toBe('book');
  });

  it('truncates over-long names but keeps the extension', () => {
    const result = sanitizeFilename(`${'x'.repeat(400)}.epub`);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('.epub')).toBe(true);
  });

  it('never returns an empty name', () => {
    expect(sanitizeFilename('')).toBe('download');
    expect(sanitizeFilename('///')).toBe('download');
    expect(sanitizeFilename('<<<')).toBe('___');
  });
});

describe('resolveWithinDir', () => {
  const root = path.resolve('/tmp/zlib-downloads');

  it('resolves a plain name inside the directory', () => {
    expect(resolveWithinDir(root, 'book.epub')).toBe(path.join(root, 'book.epub'));
  });

  it('refuses traversal that escapes the directory', () => {
    expect(resolveWithinDir(root, '../escaped.epub')).toBeUndefined();
    expect(resolveWithinDir(root, '../../../../etc/passwd')).toBeUndefined();
  });

  it('refuses an absolute path', () => {
    expect(resolveWithinDir(root, path.resolve('/etc/passwd'))).toBeUndefined();
  });

  it('refuses the directory itself', () => {
    expect(resolveWithinDir(root, '.')).toBeUndefined();
  });

  it('is not fooled by a sibling directory sharing the prefix', () => {
    // 字符串前缀比对会把 `/tmp/zlib-downloads-evil` 误判为在目录内；这里用 path.relative 挡住。
    expect(resolveWithinDir(root, '../zlib-downloads-evil/x.epub')).toBeUndefined();
  });
});

describe('uniquePath', () => {
  it('returns the target untouched when nothing is there', () => {
    expect(uniquePath('/d/book.epub', () => false)).toBe('/d/book.epub');
  });

  it('adds a " (2)" suffix before the extension rather than overwriting', () => {
    const taken = new Set([path.normalize('/d/book.epub')]);
    expect(uniquePath(path.normalize('/d/book.epub'), (p) => taken.has(p))).toBe(path.normalize('/d/book (2).epub'));
  });

  it('keeps counting up while names are taken', () => {
    const taken = new Set(['/d/book.epub', '/d/book (2).epub', '/d/book (3).epub'].map((p) => path.normalize(p)));
    expect(uniquePath(path.normalize('/d/book.epub'), (p) => taken.has(p))).toBe(path.normalize('/d/book (4).epub'));
  });
});

describe('filenameFromContentDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="book.epub"')).toBe('book.epub');
  });

  it('reads an unquoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename=book.epub')).toBe('book.epub');
  });

  it('prefers the RFC 5987 extended form', () => {
    const header = 'attachment; filename="fallback.epub"; filename*=UTF-8\'\'%E4%B9%A6.epub';
    expect(filenameFromContentDisposition(header)).toBe('书.epub');
  });

  it('returns undefined when the header is absent or has no filename', () => {
    expect(filenameFromContentDisposition(null)).toBeUndefined();
    expect(filenameFromContentDisposition('attachment')).toBeUndefined();
  });
});
