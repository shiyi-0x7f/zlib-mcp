import { describe, expect, it } from 'vitest';

import { DEFAULT_HOST, DEFAULT_MAX_DOWNLOAD_BYTES, DEFAULT_TIMEOUT_MS, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('falls back to documented defaults on an empty environment', () => {
    const config = loadConfig({});

    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.maxDownloadBytes).toBe(DEFAULT_MAX_DOWNLOAD_BYTES);
    expect(config.downloadDir).toBeUndefined();
    expect(config.credentialCacheEnabled).toBe(true);
  });

  it('never throws on a missing credential — that is a call-time error, not a startup crash', () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it('treats blank strings as unset', () => {
    const config = loadConfig({ ZLIB_REMIX_ID: '   ', ZLIB_DOWNLOAD_DIR: '' });
    expect(config.remixId).toBeUndefined();
    expect(config.downloadDir).toBeUndefined();
  });

  it('normalises a host given with a scheme or trailing slash', () => {
    expect(loadConfig({ ZLIB_HOST: 'https://mirror.test/' }).host).toBe('mirror.test');
    expect(loadConfig({ ZLIB_HOST: 'http://mirror.test' }).host).toBe('mirror.test');
    expect(loadConfig({ ZLIB_HOST: '  mirror.test  ' }).host).toBe('mirror.test');
  });

  it('ignores a nonsense timeout instead of producing an unusable client', () => {
    expect(loadConfig({ ZLIB_TIMEOUT_MS: 'soon' }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(loadConfig({ ZLIB_TIMEOUT_MS: '-5' }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(loadConfig({ ZLIB_TIMEOUT_MS: '0' }).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(loadConfig({ ZLIB_TIMEOUT_MS: '60000' }).timeoutMs).toBe(60_000);
  });

  it('parses the credential-cache switch in both directions', () => {
    expect(loadConfig({ ZLIB_CREDENTIAL_CACHE: '0' }).credentialCacheEnabled).toBe(false);
    expect(loadConfig({ ZLIB_CREDENTIAL_CACHE: 'false' }).credentialCacheEnabled).toBe(false);
    expect(loadConfig({ ZLIB_CREDENTIAL_CACHE: 'off' }).credentialCacheEnabled).toBe(false);
    expect(loadConfig({ ZLIB_CREDENTIAL_CACHE: 'true' }).credentialCacheEnabled).toBe(true);
    expect(loadConfig({ ZLIB_CREDENTIAL_CACHE: 'maybe' }).credentialCacheEnabled).toBe(true);
  });
});
