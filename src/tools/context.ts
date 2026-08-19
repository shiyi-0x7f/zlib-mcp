/**
 * 工具层共享件：依赖容器 + MCP 结果构造 + 统一的错误兜底。
 *
 * 所有工具 handler 都包在 runTool 里 —— 保证任何失败都变成一条可操作的 isError 文本，
 * 而不是把裸异常抛回协议层（那在客户端里通常只显示成一句 "internal error"）。
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { Config } from '../config.js';
import type { CredentialResolver } from '../credentials.js';
import { ZlibError } from '../errors.js';
import { logger } from '../logger.js';
import type { ZlibraryClient } from '../upstream/client.js';

export interface ToolContext {
  readonly config: Config;
  readonly client: ZlibraryClient;
  readonly credentials: CredentialResolver;
}

export const textResult = (payload: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
});

export const errorResult = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * 统一兜底。ZlibError 已经带好了「现象 + 下一步」；其它异常归一为一条不泄露内部细节的消息。
 * 凭证失效时顺手作废内存副本，让下次调用重新走登录。
 */
export async function runTool(
  context: ToolContext,
  toolName: string,
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (e) {
    if (e instanceof ZlibError) {
      if (e.kind === 'credentials_invalid') context.credentials.invalidate();
      logger.warn(`${toolName} failed [${e.kind}]: ${e.message}`);
      return errorResult(e.toUserMessage());
    }
    const detail = e instanceof Error ? e.message : String(e);
    logger.error(`${toolName} failed unexpectedly: ${detail}`);
    return errorResult(`zlib-mcp hit an unexpected error while running ${toolName}: ${detail}`);
  }
}
