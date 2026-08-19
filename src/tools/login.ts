/**
 * zlib_login —— 邮箱密码换 remix 凭证（PRD §5.5）。
 *
 * 这是**配置辅助**工具，不是每次调用都该走的登录入口：拿到凭证后应写进客户端配置的环境变量。
 * 红线：password 绝不进返回值、日志、错误消息。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { logger } from '../logger.js';
import { runTool, textResult, type ToolContext } from './context.js';

export const loginInputSchema = {
  email: z.string().min(1).describe('z-library account email.'),
  password: z.string().min(1).describe('z-library account password. Never echoed back, logged, or written to disk.'),
};

const DESCRIPTION = [
  'Exchange a z-library email + password for the long-lived remix credentials (remix_id / remix_key).',
  'This is a one-time setup helper, not a per-call login: put the returned values into your MCP client',
  'config as ZLIB_REMIX_ID and ZLIB_REMIX_KEY, then restart the server. The password is never stored,',
  'logged, or returned. Do not call this before every search.',
].join(' ');

export function registerLoginTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'zlib_login',
    { title: 'Exchange z-library credentials', description: DESCRIPTION, inputSchema: loginInputSchema },
    async (args) =>
      runTool(context, 'zlib_login', async () => {
        logger.info(`zlib_login requested for ${args.email}`);
        const user = await context.client.login(args.email, args.password);

        return textResult({
          remix_id: user.remixId,
          remix_key: user.remixKey,
          email: user.email ?? args.email,
          name: user.name,
          next_step:
            'Add ZLIB_REMIX_ID and ZLIB_REMIX_KEY to the "env" section of this server in your MCP client config, then restart the client.',
        });
      }),
  );
}
