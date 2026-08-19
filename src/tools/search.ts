/** zlib_search —— 关键词搜索，结果经 shaping 层裁剪后返回（PRD §5.2）。 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { shapeSearchResponse } from '../shaping.js';
import { runTool, textResult, type ToolContext } from './context.js';

const MAX_LIMIT = 50;

export const searchInputSchema = {
  query: z.string().min(1).describe('Search keywords: book title, author name, or ISBN.'),
  extensions: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by file format, e.g. ["epub","pdf"]. Omit to accept any format.'),
  languages: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by language, e.g. ["english","chinese"]. Omit to accept any language.'),
  year_from: z.number().int().optional().describe('Earliest publication year (inclusive).'),
  year_to: z.number().int().optional().describe('Latest publication year (inclusive).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Results per page, 1-${String(MAX_LIMIT)}, default 10.`),
  page: z.number().int().min(1).optional().describe('Page number, starting at 1. Default 1.'),
  order: z.string().optional().describe('Upstream sort field, passed through as-is (e.g. "popular", "year").'),
};

const DESCRIPTION = [
  'Search z-library for books. Returns a trimmed list — each entry carries the "id" and "hash"',
  'that zlib_get_download_url and zlib_download require, plus title/author/year/language/extension/size.',
  'Present the candidates to the user and let them pick before downloading anything.',
].join(' ');

export function registerSearchTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'zlib_search',
    { title: 'Search z-library', description: DESCRIPTION, inputSchema: searchInputSchema },
    async (args) =>
      runTool(context, 'zlib_search', async () => {
        const page = args.page ?? 1;
        const credentials = await context.credentials.resolve();

        const raw = await context.client.search(credentials, {
          query: args.query,
          extensions: args.extensions,
          languages: args.languages,
          yearFrom: args.year_from,
          yearTo: args.year_to,
          limit: args.limit ?? 10,
          page,
          order: args.order,
        });

        return textResult(shapeSearchResponse(raw, page));
      }),
  );
}
