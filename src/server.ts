/** 组装 MCP server：把 config → client → resolver → 各工具串起来。 */

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
export const SERVER_VERSION = '0.1.0';

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
