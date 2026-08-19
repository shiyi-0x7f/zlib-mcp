import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { CredentialResolver } from '../src/credentials.js';
import { ZlibError } from '../src/errors.js';
import { ZlibraryClient } from '../src/upstream/client.js';
import { stubFetch } from './helpers.js';

const loginOk = JSON.stringify({
  success: 1,
  user: { id: 999, remix_userkey: 'freshkey', email: 'a@b.test', name: 'Reader' },
});

/** 缓存默认关掉：这些用例只验解析优先级，不该碰到真实 home 目录。 */
const resolverFor = (env: Record<string, string>, fetchImpl: typeof fetch): CredentialResolver => {
  const config = loadConfig({ ZLIB_CREDENTIAL_CACHE: '0', ...env });
  return new CredentialResolver(config, new ZlibraryClient({ host: 'x.test', timeoutMs: 1000, fetchImpl }));
};

describe('CredentialResolver', () => {
  it('prefers explicit remix credentials and never touches the network', async () => {
    const stub = stubFetch({ body: loginOk });
    const resolver = resolverFor(
      { ZLIB_REMIX_ID: '1', ZLIB_REMIX_KEY: 'k', ZLIB_EMAIL: 'a@b.test', ZLIB_PASSWORD: 'pw' },
      stub.fetch,
    );

    await expect(resolver.resolve()).resolves.toEqual({ remixId: '1', remixKey: 'k' });
    expect(stub.calls).toHaveLength(0);
  });

  it('exchanges email + password on first use (PRD 验收 5)', async () => {
    const stub = stubFetch({ body: loginOk });
    const resolver = resolverFor({ ZLIB_EMAIL: 'a@b.test', ZLIB_PASSWORD: 'pw' }, stub.fetch);

    await expect(resolver.resolve()).resolves.toEqual({ remixId: '999', remixKey: 'freshkey' });
    expect(stub.calls[0]?.url).toBe('https://x.test/eapi/user/login');
  });

  it('logs in once and reuses the result for the process lifetime', async () => {
    const stub = stubFetch({ body: loginOk });
    const resolver = resolverFor({ ZLIB_EMAIL: 'a@b.test', ZLIB_PASSWORD: 'pw' }, stub.fetch);

    await resolver.resolve();
    await resolver.resolve();
    expect(stub.calls).toHaveLength(1);
  });

  it('collapses concurrent first calls into a single login', async () => {
    const stub = stubFetch({ body: loginOk });
    const resolver = resolverFor({ ZLIB_EMAIL: 'a@b.test', ZLIB_PASSWORD: 'pw' }, stub.fetch);

    await Promise.all([resolver.resolve(), resolver.resolve(), resolver.resolve()]);
    expect(stub.calls).toHaveLength(1);
  });

  it('re-logs in after invalidate()', async () => {
    const stub = stubFetch({ body: loginOk });
    const resolver = resolverFor({ ZLIB_EMAIL: 'a@b.test', ZLIB_PASSWORD: 'pw' }, stub.fetch);

    await resolver.resolve();
    resolver.invalidate();
    await resolver.resolve();
    expect(stub.calls).toHaveLength(2);
  });

  it('reports every missing variable by name when nothing is configured', async () => {
    const resolver = resolverFor({}, stubFetch().fetch);

    const error = await resolver.resolve().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZlibError);
    expect((error as ZlibError).kind).toBe('credentials_missing');

    const message = (error as ZlibError).toUserMessage();
    expect(message).toContain('ZLIB_REMIX_ID');
    expect(message).toContain('ZLIB_REMIX_KEY');
    expect(message).toContain('ZLIB_EMAIL');
    expect(message).toContain('zlib_login');
  });

  it('treats a half-configured remix pair as missing rather than sending a broken cookie', async () => {
    const resolver = resolverFor({ ZLIB_REMIX_ID: '1' }, stubFetch().fetch);
    await expect(resolver.resolve()).rejects.toThrowError(/ZLIB_REMIX_KEY/);
  });

  it('hasAnyCredentialSource reflects what is configured, without any network call', () => {
    expect(resolverFor({}, stubFetch().fetch).hasAnyCredentialSource()).toBe(false);
    expect(resolverFor({ ZLIB_REMIX_ID: '1' }, stubFetch().fetch).hasAnyCredentialSource()).toBe(false);
    expect(resolverFor({ ZLIB_REMIX_ID: '1', ZLIB_REMIX_KEY: 'k' }, stubFetch().fetch).hasAnyCredentialSource()).toBe(
      true,
    );
    expect(
      resolverFor({ ZLIB_EMAIL: 'a@b.test', ZLIB_PASSWORD: 'pw' }, stubFetch().fetch).hasAnyCredentialSource(),
    ).toBe(true);
  });
});
