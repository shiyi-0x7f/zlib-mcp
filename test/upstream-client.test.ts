import { describe, expect, it } from 'vitest';

import { ZlibError } from '../src/errors.js';
import { ZlibraryClient } from '../src/upstream/client.js';
import { redirectResponse, stubFetch, throwingFetch } from './helpers.js';

const CREDENTIALS = { remixId: '123', remixKey: 'abcdef0123456789' };

const clientWith = (fetchImpl: typeof fetch): ZlibraryClient =>
  new ZlibraryClient({ host: 'example.test', timeoutMs: 5000, fetchImpl });

async function captureError(fn: () => Promise<unknown>): Promise<ZlibError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ZlibError);
    return e as ZlibError;
  }
  throw new Error('expected the call to throw');
}

describe('ZlibraryClient.search', () => {
  it('sends browser headers, remix cookie and form-encoded filters', async () => {
    const stub = stubFetch({ body: JSON.stringify({ books: [], pagination: { total_items: 0 } }) });
    await clientWith(stub.fetch).search(CREDENTIALS, {
      query: 'ddia',
      extensions: ['epub', 'pdf'],
      languages: ['english'],
      yearFrom: 2010,
      yearTo: 2020,
      limit: 5,
      page: 2,
    });

    const call = stub.calls[0];
    expect(call?.url).toBe('https://example.test/eapi/book/search');

    const headers = call?.init?.headers as Record<string, string>;
    expect(headers['cookie']).toBe('siteLanguageV2=en; remix_userid=123; remix_userkey=abcdef0123456789');
    expect(headers['user-agent']).toContain('Mozilla/5.0');

    const body = (call?.init?.body as URLSearchParams).toString();
    expect(body).toContain('message=ddia');
    expect(body).toContain('extensions%5B%5D=epub');
    expect(body).toContain('extensions%5B%5D=pdf');
    expect(body).toContain('languages%5B%5D=english');
    expect(body).toContain('yearFrom=2010');
    expect(body).toContain('page=2');
  });

  it('percent-encodes a Chinese query as UTF-8 and declares the charset', async () => {
    const stub = stubFetch({ body: JSON.stringify({ books: [] }) });
    await clientWith(stub.fetch).search(CREDENTIALS, { query: '数据密集型应用系统设计' });

    const call = stub.calls[0];
    const body = (call?.init?.body as URLSearchParams).toString();

    // UTF-8：`数据` = E6 95 B0 / E6 8D AE。若哪天改成手拼字符串或换了编码，这里会立刻红。
    expect(body).toBe(
      'message=%E6%95%B0%E6%8D%AE%E5%AF%86%E9%9B%86%E5%9E%8B%E5%BA%94%E7%94%A8%E7%B3%BB%E7%BB%9F%E8%AE%BE%E8%AE%A1',
    );

    // 光编码对不够：上游要靠 charset 才知道按哪种编码还原这串字节。
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
  });

  it('UTF-8 encodes non-ASCII language and extension filters too', async () => {
    const stub = stubFetch({ body: JSON.stringify({ books: [] }) });
    await clientWith(stub.fetch).search(CREDENTIALS, { query: 'x', languages: ['中文'] });

    const body = (stub.calls[0]?.init?.body as URLSearchParams).toString();
    expect(body).toContain('languages%5B%5D=%E4%B8%AD%E6%96%87');
  });
});

describe('ZlibraryClient error classification (PRD §7)', () => {
  it('classifies a 307 self-redirect as upstream_blocked and names the host', async () => {
    const stub = stubFetch(redirectResponse(307, 'https://example.test/'));
    const error = await captureError(() => clientWith(stub.fetch).search(CREDENTIALS, { query: 'x' }));

    expect(error.kind).toBe('upstream_blocked');
    expect(error.toUserMessage()).toContain('ZLIB_HOST');
    expect(error.toUserMessage()).toContain('example.test');
  });

  it('classifies an HTML anti-bot page as upstream_blocked', async () => {
    const stub = stubFetch({ body: '<!DOCTYPE html><html><body>checking your browser</body></html>' });
    const error = await captureError(() => clientWith(stub.fetch).search(CREDENTIALS, { query: 'x' }));

    expect(error.kind).toBe('upstream_blocked');
    expect(error.message).toContain('anti-bot challenge');
  });

  it('classifies HTTP 401 as credentials_invalid and points at zlib_login', async () => {
    const stub = stubFetch({ status: 401, body: '{}' });
    const error = await captureError(() => clientWith(stub.fetch).search(CREDENTIALS, { query: 'x' }));

    expect(error.kind).toBe('credentials_invalid');
    expect(error.toUserMessage()).toContain('zlib_login');
  });

  it('classifies a 200 + {success:0,"not logged in"} body as credentials_invalid', async () => {
    const stub = stubFetch({ body: JSON.stringify({ success: 0, error: 'You are not logged in' }) });
    const error = await captureError(() => clientWith(stub.fetch).search(CREDENTIALS, { query: 'x' }));

    expect(error.kind).toBe('credentials_invalid');
  });

  it('classifies a daily-limit body as quota_exceeded', async () => {
    const stub = stubFetch({ body: JSON.stringify({ success: 0, error: 'Daily limit reached' }) });
    const error = await captureError(() => clientWith(stub.fetch).search(CREDENTIALS, { query: 'x' }));

    expect(error.kind).toBe('quota_exceeded');
    expect(error.toUserMessage()).toContain('zlib_limits');
  });

  it('classifies HTTP 429 as quota_exceeded', async () => {
    const stub = stubFetch({ status: 429, body: '{}' });
    const error = await captureError(() => clientWith(stub.fetch).getLimits(CREDENTIALS));

    expect(error.kind).toBe('quota_exceeded');
  });

  it('classifies a timeout as network and names ZLIB_TIMEOUT_MS', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    const error = await captureError(() => clientWith(throwingFetch(timeout)).search(CREDENTIALS, { query: 'x' }));

    expect(error.kind).toBe('network');
    expect(error.toUserMessage()).toContain('ZLIB_TIMEOUT_MS');
    expect(error.toUserMessage()).toContain('5000');
  });

  it('classifies a connection failure as network', async () => {
    const error = await captureError(() =>
      clientWith(throwingFetch(new TypeError('fetch failed'))).search(CREDENTIALS, { query: 'x' }),
    );

    expect(error.kind).toBe('network');
  });

  it('classifies an unrecognised upstream shape as upstream_error', async () => {
    const stub = stubFetch({ body: JSON.stringify({ file: {} }) });
    const error = await captureError(() => clientWith(stub.fetch).getDownloadUrl(CREDENTIALS, '1', 'h'));

    expect(error.kind).toBe('upstream_error');
  });
});

describe('ZlibraryClient.getDownloadUrl', () => {
  it('returns the upstream link untouched, with no rewriting of any kind', async () => {
    const link = 'https://example.test/dl/123/z-library-file.epub';
    const stub = stubFetch({ body: JSON.stringify({ file: { downloadLink: link } }) });

    await expect(clientWith(stub.fetch).getDownloadUrl(CREDENTIALS, '123', 'deadbeef')).resolves.toBe(link);
    expect(stub.calls[0]?.url).toBe('https://example.test/eapi/book/123/deadbeef/file');
  });

  it('reports a missing link with a quota note as quota_exceeded', async () => {
    const stub = stubFetch({ body: JSON.stringify({ file: {}, message: 'Daily limit reached' }) });
    const error = await captureError(() => clientWith(stub.fetch).getDownloadUrl(CREDENTIALS, '1', 'h'));

    expect(error.kind).toBe('quota_exceeded');
  });
});

describe('ZlibraryClient.login', () => {
  it('reads the body even when the upstream answers HTTP 400', async () => {
    const stub = stubFetch({ status: 400, body: JSON.stringify({ success: 0, error: 'Incorrect password' }) });
    const error = await captureError(() => clientWith(stub.fetch).login('a@b.test', 'hunter2'));

    expect(error.kind).toBe('credentials_invalid');
    expect(error.message).toContain('Incorrect password');
  });

  it('never echoes the password in the error message', async () => {
    const stub = stubFetch({ status: 400, body: JSON.stringify({ success: 0, error: 'Incorrect password' }) });
    const error = await captureError(() => clientWith(stub.fetch).login('a@b.test', 'sup3rs3cret'));

    expect(error.toUserMessage()).not.toContain('sup3rs3cret');
  });

  it('extracts remix credentials on success and sends no remix cookie', async () => {
    const stub = stubFetch({
      body: JSON.stringify({
        success: 1,
        user: { id: 777, remix_userkey: 'key777', email: 'a@b.test', name: 'Reader' },
      }),
    });

    await expect(clientWith(stub.fetch).login('a@b.test', 'pw')).resolves.toEqual({
      remixId: '777',
      remixKey: 'key777',
      email: 'a@b.test',
      name: 'Reader',
    });
    expect((stub.calls[0]?.init?.headers as Record<string, string>)['cookie']).toBeUndefined();
  });
});

describe('ZlibraryClient.getLimits', () => {
  it('derives the remaining allowance from the profile endpoint', async () => {
    const stub = stubFetch({ body: JSON.stringify({ user: { downloads_today: 4, downloads_limit: 10 } }) });

    await expect(clientWith(stub.fetch).getLimits(CREDENTIALS)).resolves.toEqual({
      downloadsToday: 4,
      downloadsLimit: 10,
      downloadsRemaining: 6,
      isPremium: undefined,
    });
    expect(stub.calls[0]?.url).toBe('https://example.test/eapi/user/profile');
  });

  it('never reports a negative remaining count', async () => {
    const stub = stubFetch({ body: JSON.stringify({ user: { downloads_today: 15, downloads_limit: 10 } }) });
    const limits = await clientWith(stub.fetch).getLimits(CREDENTIALS);

    expect(limits.downloadsRemaining).toBe(0);
  });
});
