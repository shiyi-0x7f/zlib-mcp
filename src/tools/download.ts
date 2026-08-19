/**
 * zlib_download —— 取直链后流式落盘（PRD §5.4）。
 *
 * 只有配了 ZLIB_DOWNLOAD_DIR 才注册：一个 MCP server 默默获得往任意路径写文件的能力
 * 是不可接受的默认值，使用者必须主动授权一个目录。
 */

import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { invalidInput, networkFailure, upstreamError } from '../errors.js';
import { logger } from '../logger.js';
import { filenameFromContentDisposition, resolveWithinDir, sanitizeFilename, uniquePath } from '../safe-path.js';
import { runTool, textResult, type ToolContext } from './context.js';

export const downloadInputSchema = {
  book_id: z.union([z.string().min(1), z.number().int()]).describe('The "id" field from a zlib_search result.'),
  hash: z.string().min(1).describe('The "hash" field from the same zlib_search result.'),
  filename: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Override the saved file name. Path components are stripped — the file always lands in the configured download directory.',
    ),
  allow_large: z
    .boolean()
    .optional()
    .describe('Set true to permit files above the configured size cap. Ask the user before setting this.'),
};

const humanMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(0)}MB`;

function buildDescription(downloadDir: string, maxBytes: number): string {
  return [
    `Download a book from z-library into ${downloadDir} and return the absolute path.`,
    'Requires the "id" and "hash" from a zlib_search result.',
    `Files larger than ${humanMb(maxBytes)} are refused unless allow_large is true.`,
    'Existing files are never overwritten — a " (2)" suffix is added instead.',
    "Each download consumes one unit of the account's daily allowance (see zlib_limits).",
  ].join(' ');
}

export function registerDownloadTool(server: McpServer, context: ToolContext): void {
  const downloadDir = context.config.downloadDir;
  if (downloadDir === undefined) return; // 未授权目录 → 工具不出现在列表里

  server.registerTool(
    'zlib_download',
    {
      title: 'Download a book from z-library',
      description: buildDescription(path.resolve(downloadDir), context.config.maxDownloadBytes),
      inputSchema: downloadInputSchema,
    },
    async (args) =>
      runTool(context, 'zlib_download', async () => {
        const credentials = await context.credentials.resolve();
        const url = await context.client.getDownloadUrl(credentials, String(args.book_id), args.hash);

        const result = await streamToDisk({
          url,
          downloadDir,
          maxBytes: context.config.maxDownloadBytes,
          allowLarge: args.allow_large ?? false,
          timeoutMs: context.config.timeoutMs,
          requestedFilename: args.filename,
        });

        return textResult(result);
      }),
  );
}

interface StreamOptions {
  readonly url: string;
  readonly downloadDir: string;
  readonly maxBytes: number;
  readonly allowLarge: boolean;
  readonly timeoutMs: number;
  readonly requestedFilename: string | undefined;
  /** 注入点：测试用 mock fetch，生产用全局 fetch。 */
  readonly fetchImpl?: typeof fetch | undefined;
}

interface DownloadOutcome {
  readonly path: string;
  readonly filename: string;
  readonly bytes: number;
}

async function streamToDisk(options: StreamOptions): Promise<DownloadOutcome> {
  const response = await fetchFile(options.url, options.timeoutMs, options.fetchImpl ?? globalThis.fetch);

  // 优先级：用户指定 > Content-Disposition > URL 末段。三者都不可信，统统过 sanitizeFilename。
  const rawName =
    options.requestedFilename ??
    filenameFromContentDisposition(response.headers.get('content-disposition')) ??
    lastUrlSegment(options.url);
  const filename = sanitizeFilename(rawName);

  const target = resolveWithinDir(options.downloadDir, filename);
  if (target === undefined) {
    throw invalidInput('filename', `"${rawName}" resolves outside the download directory and was refused`);
  }

  // Content-Length 只是提示（可能缺失或撒谎），所以下面写入时还要再逐块计数一次。
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (!options.allowLarge && Number.isFinite(declared) && declared > options.maxBytes) {
    throw invalidInput(
      'allow_large',
      `the file is ${humanMb(declared)}, above the ${humanMb(options.maxBytes)} cap. Confirm with the user, then retry with allow_large: true.`,
    );
  }

  if (response.body === null) throw upstreamError('the download response carried no body');

  await mkdir(path.resolve(options.downloadDir), { recursive: true });
  const finalPath = uniquePath(target);

  let bytes = 0;
  const cap = options.allowLarge ? Number.POSITIVE_INFINITY : options.maxBytes;
  const sink = createWriteStream(finalPath);

  try {
    await pipeline(
      (async function* chunks(): AsyncGenerator<Uint8Array> {
        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
          bytes += chunk.byteLength;
          if (bytes > cap) {
            throw invalidInput(
              'allow_large',
              `the file exceeded the ${humanMb(options.maxBytes)} cap while downloading. Confirm with the user, then retry with allow_large: true.`,
            );
          }
          yield chunk;
        }
      })(),
      sink,
    );
  } catch (e) {
    // 半截文件比没有文件更糟 —— 会被当成下载成功。
    await removePartial(sink, finalPath);
    throw e;
  }

  logger.info(`saved ${String(bytes)} bytes to ${finalPath}`);
  return { path: finalPath, filename: path.basename(finalPath), bytes };
}

/**
 * 删掉半截文件。
 *
 * 必须先等 write stream 真正关闭：Windows 上句柄未释放时 unlink 会 EBUSY / EPERM 失败，
 * 结果就是一个 0 字节的残件留在下载目录里，被使用者当成「下载成功」。
 */
async function removePartial(sink: WriteStream, filePath: string): Promise<void> {
  if (!sink.closed) {
    sink.destroy();
    await once(sink, 'close').catch(() => undefined);
  }
  await unlink(filePath).catch(() => undefined);
}

/**
 * ZLIB_TIMEOUT_MS 是**建连**超时，不是整个下载的超时 —— 一个 300MB 的文件在 20s 里下不完，
 * 拿 AbortSignal.timeout 罩住整个 fetch 会把正常的大文件下载全部掐死。
 * 所以这里用手动 AbortController，响应头一到就撤掉计时器，body 的传输不再受限。
 */
async function fetchFile(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    // 直链常跨主机 302，这里必须跟随重定向（与 API 请求相反）。
    response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw networkFailure(`the download link did not respond within ${String(timeoutMs)}ms`, timeoutMs);
    }
    throw networkFailure(e instanceof Error ? e.message : String(e), timeoutMs);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw upstreamError(`the download link replied HTTP ${String(response.status)} — it may have already expired`);
  }
  return response;
}

function lastUrlSegment(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment === undefined ? 'download' : decodeURIComponent(segment);
  } catch {
    return 'download';
  }
}

export { streamToDisk };
