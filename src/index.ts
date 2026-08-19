#!/usr/bin/env node
/** bin 入口：把 server 挂到 stdio 传输上。 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { logger } from './logger.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  logger.info(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio`);
}

main().catch((e: unknown) => {
  logger.error(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
