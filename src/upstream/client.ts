/**
 * z-library 上游客户端。
 *
 * 本层只负责「发请求 + 归类失败」，不做任何面向 LLM 的裁剪 —— 那是 shaping 层的事。
 * 所有失败一律抛 ZlibError，由工具层转成 MCP isError 响应。
 */

import {
  credentialsInvalid,
  networkFailure,
  quotaExceeded,
  upstreamBlocked,
  upstreamError,
  ZlibError,
} from '../errors.js';
import type { LoginCredentials, RawSearchResponse, UserLimits } from './types.js';

/** 浏览器伪装 UA —— 缺了会被反爬直接拦掉。 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36';

export interface SearchQuery {
  readonly query: string;
  readonly extensions?: readonly string[] | undefined;
  readonly languages?: readonly string[] | undefined;
  readonly yearFrom?: number | undefined;
  readonly yearTo?: number | undefined;
  readonly limit?: number | undefined;
  readonly page?: number | undefined;
  readonly order?: string | undefined;
}

export interface ClientOptions {
  readonly host: string;
  readonly timeoutMs: number;
  /** 注入点：测试用 mock fetch，生产用全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
}

interface Credentials {
  readonly remixId: string;
  readonly remixKey: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** 只接受标量：上游偶尔把 id 给成数字，但对象 / 数组一律当缺失，避免 "[object Object]"。 */
function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

/** 上游把「额度用尽」塞在自由文本里，只能靠关键词识别。 */
const QUOTA_PATTERN = /daily limit|download limit|limit (?:is )?(?:reached|exceeded)|too many downloads/i;
const AUTH_PATTERN = /unauthor|not logged|invalid (?:user|key|token)|please log in/i;

export class ZlibraryClient {
  readonly #host: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ClientOptions) {
    this.#host = options.host;
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  get host(): string {
    return this.#host;
  }

  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  /**
   * 邮箱密码换 remix 凭证。不需要既有凭证，故不带 remix cookie。
   * 红线：password 不进返回值、日志、错误消息。
   */
  async login(email: string, password: string): Promise<LoginCredentials> {
    const body = new URLSearchParams();
    body.set('email', email);
    body.set('password', password);

    // 上游契约：失败时 HTTP 可能仍是 400，必须读 body 而非只看状态码 → allowNonOk。
    // classifyFailure:false —— 登录失败的 {success:0} 自己分类（一律是凭证问题），
    // 不走通用分类，否则 "Incorrect password" 这类文案会被误判成 upstream_error。
    const json = await this.#request('POST', '/eapi/user/login', {
      body,
      allowNonOk: true,
      classifyFailure: false,
    });
    const payload = asRecord(json);

    if (payload['success'] !== 1) {
      const detail = asString(payload['error']) ?? 'login rejected by z-library';
      throw credentialsInvalid(detail);
    }

    const user = asRecord(payload['user']);
    const remixId = asString(user['id'] ?? user['remix_userid']);
    const remixKey = asString(user['remix_userkey']);
    if (remixId === undefined || remixKey === undefined) {
      throw upstreamError('login succeeded but the response carried no remix credentials');
    }

    return { remixId, remixKey, email: asString(user['email']), name: asString(user['name']) };
  }

  async search(credentials: Credentials, query: SearchQuery): Promise<RawSearchResponse> {
    const body = new URLSearchParams();
    body.set('message', query.query);
    if (query.yearFrom !== undefined) body.set('yearFrom', String(query.yearFrom));
    if (query.yearTo !== undefined) body.set('yearTo', String(query.yearTo));
    for (const language of query.languages ?? []) body.append('languages[]', language);
    for (const extension of query.extensions ?? []) body.append('extensions[]', extension);
    if (query.limit !== undefined) body.set('limit', String(query.limit));
    if (query.page !== undefined) body.set('page', String(query.page));
    if (query.order !== undefined) body.set('order', query.order);

    const json = await this.#request('POST', '/eapi/book/search', { body, credentials });
    return asRecord(json);
  }

  /** 取下载直链。链接有时效且绑定当前会话，调用方不应缓存复用。 */
  async getDownloadUrl(credentials: Credentials, bookId: string, hash: string): Promise<string> {
    const path = `/eapi/book/${encodeURIComponent(bookId)}/${encodeURIComponent(hash)}/file`;
    const json = await this.#request('GET', path, { credentials });
    const payload = asRecord(json);

    const file = asRecord(payload['file']);
    const link = asString(file['downloadLink']);
    if (link === undefined) {
      // 额度用尽时上游不给 downloadLink，只在同层塞一段说明文本。
      const note = asString(payload['message']) ?? asString(file['description']) ?? '';
      if (QUOTA_PATTERN.test(note)) throw quotaExceeded(note);
      throw upstreamError(note === '' ? 'response carried no downloadLink' : note);
    }
    return link;
  }

  /** 已核实端点：GET /eapi/user/profile → {user:{downloads_today, downloads_limit, ...}}。 */
  async getLimits(credentials: Credentials): Promise<UserLimits> {
    const json = await this.#request('GET', '/eapi/user/profile', { credentials });
    const user = asRecord(asRecord(json)['user']);

    const downloadsToday = asInt(user['downloads_today']);
    const downloadsLimit = asInt(user['downloads_limit']);
    if (downloadsToday === undefined || downloadsLimit === undefined) {
      throw upstreamError('profile response carried no downloads_today / downloads_limit');
    }

    const premium = user['isPremium'] ?? user['is_premium'];
    return {
      downloadsToday,
      downloadsLimit,
      downloadsRemaining: Math.max(0, downloadsLimit - downloadsToday),
      isPremium: typeof premium === 'boolean' ? premium : undefined,
    };
  }

  #headers(credentials: Credentials | undefined): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': USER_AGENT,
    };
    if (credentials) {
      headers['cookie'] =
        `siteLanguageV2=en; remix_userid=${credentials.remixId}; remix_userkey=${credentials.remixKey}`;
    }
    return headers;
  }

  async #request(
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: URLSearchParams;
      credentials?: Credentials;
      allowNonOk?: boolean;
      classifyFailure?: boolean;
    },
  ): Promise<unknown> {
    const url = `https://${this.#host}${path}`;

    const init: RequestInit = {
      method,
      headers: this.#headers(options.credentials),
      // 手动处理重定向：反爬（DiamWall）的特征就是 307 自跳转，跟随会掩盖掉这个信号。
      redirect: 'manual',
      signal: AbortSignal.timeout(this.#timeoutMs),
    };
    if (method === 'POST' && options.body !== undefined) init.body = options.body;

    let response: Response;
    try {
      response = await this.#fetch(url, init);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw networkFailure(`request timed out after ${String(this.#timeoutMs)}ms`, this.#timeoutMs);
      }
      throw networkFailure(e instanceof Error ? e.message : String(e), this.#timeoutMs);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? '(no Location header)';
      throw upstreamBlocked(this.#host, `HTTP ${String(response.status)} redirect to ${location}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw credentialsInvalid(`upstream replied HTTP ${String(response.status)}`);
    }
    if (response.status === 429) {
      throw quotaExceeded('upstream replied HTTP 429 (too many requests)');
    }
    if (!response.ok && options.allowNonOk !== true) {
      throw upstreamError(`upstream replied HTTP ${String(response.status)}`);
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // 反爬挑战页返回 HTML；上游改版也可能吐非 JSON。前者更常见，按拦截处理并给出换域名指引。
      throw upstreamBlocked(
        this.#host,
        `expected JSON but got ${describeBody(text)} (HTTP ${String(response.status)})`,
      );
    }

    if (options.classifyFailure !== false) this.#assertNotAuthFailure(json);
    return json;
  }

  /** 上游常以 HTTP 200 + {success:0,error:"..."} 表达失败，需按内容再分类一次。 */
  #assertNotAuthFailure(json: unknown): void {
    const payload = asRecord(json);
    if (payload['success'] !== 0) return;

    const detail = asString(payload['error']) ?? asString(payload['message']) ?? 'request rejected';
    if (QUOTA_PATTERN.test(detail)) throw quotaExceeded(detail);
    if (AUTH_PATTERN.test(detail)) throw credentialsInvalid(detail);
    throw upstreamError(detail);
  }
}

function describeBody(text: string): string {
  const head = text.trimStart().slice(0, 60).replace(/\s+/g, ' ');
  if (/^<!doctype html|^<html/i.test(head)) return 'an HTML page (likely an anti-bot challenge)';
  return head === '' ? 'an empty body' : `"${head}…"`;
}

export { ZlibError };
