/**
 * 错误分类与「可操作消息」生成。
 *
 * 设计：所有失败在这里归一为 6 类（PRD §7），每类的消息都必须告诉用户**下一步做什么**，
 * 而不是只陈述发生了什么。工具层只负责把 ZlibError 转成 MCP 的 isError 响应。
 *
 * 红线：password 与完整 remix_key 不得出现在任何消息里。
 */

export type ZlibErrorKind =
  | 'credentials_missing' // 环境变量没配
  | 'credentials_invalid' // 上游拒绝当前凭证
  | 'quota_exceeded' // 当日下载额度用尽
  | 'upstream_blocked' // 反爬拦截 / 非 JSON 响应
  | 'network' // 超时 / fetch 抛错
  | 'invalid_input' // 入参非法
  | 'upstream_error'; // 其它上游失败（改版 / 未知）

export class ZlibError extends Error {
  constructor(
    readonly kind: ZlibErrorKind,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ZlibError';
  }

  /** 面向使用者的完整消息：现象 + 下一步。 */
  toUserMessage(): string {
    return this.hint ? `${this.message}\n\n${this.hint}` : this.message;
  }
}

/** remix_key 脱敏：只保留前 4 位。空值不暴露长度。 */
export function maskKey(key: string): string {
  if (key === '') return '(empty)';
  return `${key.slice(0, 4)}***`;
}

export const credentialsMissing = (missing: readonly string[]): ZlibError =>
  new ZlibError(
    'credentials_missing',
    `z-library credentials are not configured (missing: ${missing.join(', ')}).`,
    [
      'Configure them in your MCP client under the server\'s "env" section, either:',
      '  ZLIB_REMIX_ID / ZLIB_REMIX_KEY   (preferred)',
      '  ZLIB_EMAIL / ZLIB_PASSWORD       (fallback; exchanged for remix credentials on first use)',
      'If you only know your email + password, call the zlib_login tool once to obtain',
      'ZLIB_REMIX_ID / ZLIB_REMIX_KEY, then put those in the config.',
    ].join('\n'),
  );

export const credentialsInvalid = (detail: string): ZlibError =>
  new ZlibError(
    'credentials_invalid',
    `z-library rejected the current credentials: ${detail}`,
    'Your remix credentials likely expired. Run zlib_login with your email and password to get fresh ones, then update ZLIB_REMIX_ID / ZLIB_REMIX_KEY.',
  );

export const quotaExceeded = (detail: string): ZlibError =>
  new ZlibError(
    'quota_exceeded',
    `z-library download quota reached: ${detail}`,
    'Your daily download allowance is used up; it resets at midnight (UTC) on the z-library side. Call zlib_limits to see the current counter.',
  );

export const upstreamBlocked = (host: string, detail: string): ZlibError =>
  new ZlibError(
    'upstream_blocked',
    `Upstream host "${host}" appears to be blocking this request: ${detail}`,
    `Set ZLIB_HOST to a different z-library mirror (current: ${host}) and restart the MCP server. See the README for known-good mirrors.`,
  );

export const networkFailure = (detail: string, timeoutMs: number): ZlibError =>
  new ZlibError(
    'network',
    `Could not reach z-library: ${detail}`,
    `Current per-request timeout is ${String(timeoutMs)}ms — raise ZLIB_TIMEOUT_MS if your connection is slow, or check that the host is reachable.`,
  );

export const invalidInput = (field: string, detail: string): ZlibError =>
  new ZlibError('invalid_input', `Invalid value for "${field}": ${detail}`);

export const upstreamError = (detail: string): ZlibError =>
  new ZlibError(
    'upstream_error',
    `z-library returned an unexpected response: ${detail}`,
    'This usually means the upstream API changed. Please open an issue with the tool name and arguments you used.',
  );
