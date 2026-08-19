/**
 * 环境变量 → Config。
 *
 * 解析永不抛：凭证缺失是**调用时**的可操作错误，不是启动时的崩溃（PRD §6）。
 * MCP 客户端在启动阶段并发拉起多个 server，启动即崩只表现为「server 不可用」，用户无从排查。
 */

export const DEFAULT_HOST = 'pkuedu.xyz';
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500MB，见 PRD 待定项 B

export interface Config {
  readonly host: string;
  readonly timeoutMs: number;
  /** 未配置则 zlib_download 不注册 —— 默认不授予任意路径写文件的能力。 */
  readonly downloadDir: string | undefined;
  readonly maxDownloadBytes: number;
  readonly remixId: string | undefined;
  readonly remixKey: string | undefined;
  readonly email: string | undefined;
  readonly password: string | undefined;
  /** 是否把换取到的凭证缓存到 ~/.zlib-mcp/credentials.json（PRD 待定项 C，默认开）。 */
  readonly credentialCacheEnabled: boolean;
}

type Env = Record<string, string | undefined>;

const trimmed = (env: Env, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value === '' ? undefined : value;
};

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = trimmed(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBoolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = trimmed(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  return fallback;
}

/** 去掉误配的 scheme / 尾斜杠：`https://foo.bar/` → `foo.bar`。 */
function normalizeHost(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .trim();
}

export function loadConfig(env: Env = process.env): Config {
  const rawHost = trimmed(env, 'ZLIB_HOST');
  const host = rawHost === undefined ? DEFAULT_HOST : normalizeHost(rawHost) || DEFAULT_HOST;

  return {
    host,
    timeoutMs: positiveInt(env, 'ZLIB_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    downloadDir: trimmed(env, 'ZLIB_DOWNLOAD_DIR'),
    maxDownloadBytes: positiveInt(env, 'ZLIB_MAX_DOWNLOAD_BYTES', DEFAULT_MAX_DOWNLOAD_BYTES),
    remixId: trimmed(env, 'ZLIB_REMIX_ID'),
    remixKey: trimmed(env, 'ZLIB_REMIX_KEY'),
    email: trimmed(env, 'ZLIB_EMAIL'),
    password: trimmed(env, 'ZLIB_PASSWORD'),
    credentialCacheEnabled: parseBoolean(env, 'ZLIB_CREDENTIAL_CACHE', true),
  };
}
