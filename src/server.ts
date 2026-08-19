/** 组装 MCP server：把 config → client → resolver → 各工具串起来。 */

import { readFileSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadConfig, type Config } from './config.js';
import { CredentialResolver } from './credentials.js';
import { logger } from './logger.js';
import type { ToolContext } from './tools/context.js';
import { registerDownloadTool } from './tools/download.js';
import { registerDownloadUrlTool } from './tools/download-url.js';
import { registerLimitsTool } from './tools/limits.js';
import { registerLoginTool } from './tools/login.js';
import { registerSearchTool } from './tools/search.js';
import { ZlibraryClient } from './upstream/client.js';

export const SERVER_NAME = 'zlib-mcp';

/**
 * 版本号从 package.json 读，**不硬编码**。
 *
 * 这里曾经写死过一个字符串，`npm version` 只改 package.json，结果 0.1.1 的包
 * 在 initialize 响应里自报 0.1.0 —— 客户端显示的、用户报 bug 时引用的都是错的版本。
 *
 * 运行时读而不是 `import ... with { type: 'json' }`：后者在部分 Node 版本上会打
 * ExperimentalWarning，而本进程的 stderr 是使用者排查问题时唯一的信息来源，不该被噪音污染。
 * 路径按编译产物算：`dist/server.js` → `../package.json` 即包根。
 */
export const SERVER_VERSION = ((): string => {
  try {
    const raw: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const version = (raw as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
})();

export function createServer(config: Config = loadConfig()): McpServer {
  const client = new ZlibraryClient({ host: config.host, timeoutMs: config.timeoutMs });
  const context: ToolContext = { config, client, credentials: new CredentialResolver(config, client) };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerSearchTool(server, context);
  registerDownloadUrlTool(server, context);
  registerDownloadTool(server, context); // 未配 ZLIB_DOWNLOAD_DIR 时内部直接 return，不注册
  registerLimitsTool(server, context);
  registerLoginTool(server, context);

  logger.info(
    `host=${config.host} timeout=${String(config.timeoutMs)}ms download_dir=${config.downloadDir ?? '(disabled)'}`,
  );
  if (!context.credentials.hasAnyCredentialSource()) {
    // 只警告不退出：崩溃在多数客户端里只表现为「server 不可用」，用户无从排查。
    logger.warn('no credentials configured — tools will return setup instructions when called');
  }

  return server;
}
