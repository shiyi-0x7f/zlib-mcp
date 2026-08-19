/** zlib_get_download_url —— 取直链，不落盘（PRD §5.3）。 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runTool, textResult, type ToolContext } from './context.js';

export const downloadUrlInputSchema = {
  book_id: z.union([z.string().min(1), z.number().int()]).describe('The "id" field from a zlib_search result.'),
  hash: z.string().min(1).describe('The "hash" field from the same zlib_search result. Must match the book_id.'),
};

function buildDescription(downloadEnabled: boolean): string {
  const base = [
    'Get a direct download URL for one book. Requires the "id" and "hash" from a zlib_search result.',
    'The link is short-lived and tied to the session that fetched it — use it right away, never cache or reuse it.',
    "Fetching a link consumes one unit of the account's daily download allowance (see zlib_limits).",
  ];
  if (!downloadEnabled) {
    base.push(
      'This server cannot save files to disk: set the ZLIB_DOWNLOAD_DIR environment variable in the MCP',
      'client config to a directory you want downloads written to, then restart the server to enable zlib_download.',
    );
  }
  return base.join(' ');
}

export function registerDownloadUrlTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'zlib_get_download_url',
    {
      title: 'Get z-library download URL',
      description: buildDescription(context.config.downloadDir !== undefined),
      inputSchema: downloadUrlInputSchema,
    },
    async (args) =>
      runTool(context, 'zlib_get_download_url', async () => {
        const credentials = await context.credentials.resolve();
        const url = await context.client.getDownloadUrl(credentials, String(args.book_id), args.hash);
        return textResult({ url });
      }),
  );
}
