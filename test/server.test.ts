import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

/** 起一个内存里的 client/server 对，验真实的 tools/list 与 tools/call 行为。 */
async function connect(env: Record<string, string>): Promise<Client> {
  const server = createServer(loadConfig({ ZLIB_CREDENTIAL_CACHE: '0', ...env }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const toolNames = async (client: Client): Promise<string[]> =>
  (await client.listTools()).tools.map((t) => t.name).sort();

describe('MCP server registration', () => {
  it('exposes four tools when no download directory is configured (PRD 验收 1)', async () => {
    const client = await connect({ ZLIB_REMIX_ID: '1', ZLIB_REMIX_KEY: 'k' });

    expect(await toolNames(client)).toEqual(['zlib_get_download_url', 'zlib_limits', 'zlib_login', 'zlib_search']);
    await client.close();
  });

  it('adds zlib_download once ZLIB_DOWNLOAD_DIR is set (PRD 验收 4)', async () => {
    const client = await connect({ ZLIB_REMIX_ID: '1', ZLIB_REMIX_KEY: 'k', ZLIB_DOWNLOAD_DIR: '/tmp/books' });

    expect(await toolNames(client)).toContain('zlib_download');
    await client.close();
  });

  it('tells the user how to enable downloads in the get_download_url description', async () => {
    const client = await connect({ ZLIB_REMIX_ID: '1', ZLIB_REMIX_KEY: 'k' });
    const tool = (await client.listTools()).tools.find((t) => t.name === 'zlib_get_download_url');

    expect(tool?.description).toContain('ZLIB_DOWNLOAD_DIR');
    await client.close();
  });

  it('starts fine with no credentials and answers with setup instructions instead of crashing', async () => {
    const client = await connect({});

    expect(await toolNames(client)).toHaveLength(4);
    const result = await client.callTool({ name: 'zlib_search', arguments: { query: 'ddia' } });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('ZLIB_REMIX_ID');
    expect(text).toContain('zlib_login');
    await client.close();
  });

  it('rejects an out-of-range limit at the schema layer (PRD §7 入参非法)', async () => {
    const client = await connect({ ZLIB_REMIX_ID: '1', ZLIB_REMIX_KEY: 'k' });

    const result = await client
      .callTool({ name: 'zlib_search', arguments: { query: 'ddia', limit: 500 } })
      .catch((e: unknown) => e);

    const text = JSON.stringify(result);
    expect(text).toMatch(/limit/i);
    await client.close();
  });
});
