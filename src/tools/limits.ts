/**
 * zlib_limits —— 查询当日剩余下载额度。
 *
 * 端点 `GET /eapi/user/profile` → `{user:{downloads_today, downloads_limit, …}}`。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runTool, textResult, type ToolContext } from './context.js';

const DESCRIPTION = [
  "Check the z-library account's daily download allowance: how many downloads were used today,",
  'the daily cap, and how many remain. Call this before a batch of downloads, or when a download',
  'fails with a quota error. Takes no arguments and does not consume any allowance.',
].join(' ');

export function registerLimitsTool(server: McpServer, context: ToolContext): void {
  server.registerTool('zlib_limits', { title: 'Check z-library download quota', description: DESCRIPTION }, async () =>
    runTool(context, 'zlib_limits', async () => {
      const credentials = await context.credentials.resolve();
      const limits = await context.client.getLimits(credentials);

      return textResult({
        downloads_today: limits.downloadsToday,
        downloads_limit: limits.downloadsLimit,
        downloads_remaining: limits.downloadsRemaining,
        is_premium: limits.isPremium,
      });
    }),
  );
}
