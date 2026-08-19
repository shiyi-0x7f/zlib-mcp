/**
 * 凭证解析（PRD §6）。
 *
 * 优先级：ZLIB_REMIX_ID/KEY → 磁盘缓存 → ZLIB_EMAIL/PASSWORD 换取（并回写缓存）。
 *
 * 两个刻意的设计：
 *  - **懒解析**：不在启动时登录。MCP 客户端常并发拉起多个 server，启动期登录失败会让整个
 *    server 注册失败，用户只看到「server 不可用」，无从排查。
 *  - **落盘缓存**（`~/.zlib-mcp/credentials.json`，权限 600）：避免每次重启都重新登录，
 *    频繁登录本身会抬高触发风控的概率。可用 ZLIB_CREDENTIAL_CACHE=0 关掉。
 *
 * 红线：password 不写盘、不进日志、不进错误消息；remix_key 出现在日志时脱敏。
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { Config } from './config.js';
import { credentialsMissing, maskKey } from './errors.js';
import { logger } from './logger.js';
import type { ZlibraryClient } from './upstream/client.js';

export interface RemixCredentials {
  readonly remixId: string;
  readonly remixKey: string;
}

interface CacheFile {
  readonly version: 1;
  /** 按 email 分桶：同一台机器上换账号不会互相覆盖。 */
  readonly accounts: Record<string, RemixCredentials>;
}

export const cacheDir = (): string => path.join(homedir(), '.zlib-mcp');
export const cachePath = (): string => path.join(cacheDir(), 'credentials.json');

function readCache(): CacheFile | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath(), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const file = parsed as Record<string, unknown>;
    const accounts = file['accounts'];
    if (file['version'] !== 1 || typeof accounts !== 'object' || accounts === null) return undefined;
    return { version: 1, accounts: accounts as Record<string, RemixCredentials> };
  } catch {
    // 缓存不存在 / 损坏都不是错误：重新登录即可。
    return undefined;
  }
}

function writeCache(email: string, credentials: RemixCredentials): void {
  try {
    const existing = readCache();
    const next: CacheFile = {
      version: 1,
      accounts: { ...existing?.accounts, [email]: credentials },
    };

    mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
    writeFileSync(cachePath(), `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    // mode 只在**创建**时生效；文件已存在时要显式收紧一次。Windows 上 chmod 基本无效，属已知限制。
    chmodSync(cachePath(), 0o600);
    logger.debug(`cached credentials for ${email} at ${cachePath()}`);
  } catch (e) {
    // 缓存写不进去不该让调用失败 —— 大不了下次重新登录。
    logger.warn(`could not write credential cache: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 进程内解析并缓存凭证。
 *
 * 一个进程只解析一次，且并发调用共享同一个 in-flight promise —— 否则客户端并行发起
 * 多个工具调用时会同时打多次登录，正好是风控最敏感的行为。
 */
export class CredentialResolver {
  #resolved: RemixCredentials | undefined;
  #inFlight: Promise<RemixCredentials> | undefined;

  constructor(
    private readonly config: Config,
    private readonly client: ZlibraryClient,
  ) {}

  /** 是否配了任一种凭证 —— 用于工具描述里提示「未配置」，不触发任何网络请求。 */
  hasAnyCredentialSource(): boolean {
    const { remixId, remixKey, email, password } = this.config;
    return (remixId !== undefined && remixKey !== undefined) || (email !== undefined && password !== undefined);
  }

  async resolve(): Promise<RemixCredentials> {
    if (this.#resolved) return this.#resolved;
    this.#inFlight ??= this.#doResolve().finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  /** 上游判定凭证失效后调用：丢掉内存副本，下次 resolve 重新登录。 */
  invalidate(): void {
    this.#resolved = undefined;
  }

  async #doResolve(): Promise<RemixCredentials> {
    const { remixId, remixKey, email, password, credentialCacheEnabled } = this.config;

    if (remixId !== undefined && remixKey !== undefined) {
      logger.debug(`using remix credentials from env (id=${remixId}, key=${maskKey(remixKey)})`);
      return this.#remember({ remixId, remixKey });
    }

    if (email === undefined || password === undefined) {
      throw credentialsMissing(missingVarNames(this.config));
    }

    if (credentialCacheEnabled) {
      const cached = readCache()?.accounts[email];
      if (cached) {
        logger.debug(`using cached credentials for ${email} (key=${maskKey(cached.remixKey)})`);
        return this.#remember(cached);
      }
    }

    logger.info(`exchanging email + password for remix credentials (${email})`);
    const login = await this.client.login(email, password);
    const credentials: RemixCredentials = { remixId: login.remixId, remixKey: login.remixKey };

    if (credentialCacheEnabled) writeCache(email, credentials);
    return this.#remember(credentials);
  }

  #remember(credentials: RemixCredentials): RemixCredentials {
    this.#resolved = credentials;
    return credentials;
  }
}

/** 列出缺失的变量名，让错误消息能直接照抄去配。 */
function missingVarNames(config: Config): string[] {
  const missing: string[] = [];
  if (config.remixId === undefined) missing.push('ZLIB_REMIX_ID');
  if (config.remixKey === undefined) missing.push('ZLIB_REMIX_KEY');
  if (config.email === undefined && config.password === undefined) {
    missing.push('(or ZLIB_EMAIL + ZLIB_PASSWORD)');
  } else {
    if (config.email === undefined) missing.push('ZLIB_EMAIL');
    if (config.password === undefined) missing.push('ZLIB_PASSWORD');
  }
  return missing;
}
