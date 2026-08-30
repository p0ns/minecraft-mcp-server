import test from 'ava';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('server starts and registers MCP tools', async (t) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'MCAUTH_BOT_SERVICE_KEY' &&
        entry[0] !== 'MCAUTH_TICKET_ENDPOINT' &&
        entry[1] !== undefined
    )
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import=tsx',
      'src/main.ts',
      '--host',
      '127.0.0.1',
      '--port',
      '1',
      '--username',
      'SmokeBot'
    ],
    env,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'startup-smoke-test', version: '1.0.0' });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));

    t.true(toolNames.has('get-position'));
    t.true(toolNames.has('smelt-item'));
  } finally {
    await client.close();
  }
});
