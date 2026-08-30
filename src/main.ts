#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setupStdioFiltering } from './stdio-filter.js';
import { log } from './logger.js';
import { parseConfig, readBotServiceKey, readTicketEndpoint } from './config.js';
import { BotConnection } from './bot-connection.js';
import { McAuthTicketClient } from './mc-auth-ticket-client.js';
import { ToolFactory } from './tool-factory.js';
import { MessageStore } from './message-store.js';
import { registerPositionTools } from './tools/position-tools.js';
import { registerInventoryTools } from './tools/inventory-tools.js';
import { registerBlockTools } from './tools/block-tools.js';
import { registerEntityTools } from './tools/entity-tools.js';
import { registerChatTools } from './tools/chat-tools.js';
import { registerFlightTools } from './tools/flight-tools.js';
import { registerGameStateTools } from './tools/gamestate-tools.js';
import { registerCraftingTools } from './tools/crafting-tools.js';
import { registerFurnaceTools } from './tools/furnace-tools.js';

setupStdioFiltering();

process.on('unhandledRejection', (reason) => {
  log('error', `Unhandled rejection: ${reason}`);
});

process.on('uncaughtException', (error) => {
  log('error', `Uncaught exception: ${error}`);
});

async function main() {
  const config = parseConfig();
  const serviceKey = readBotServiceKey();
  const ticketEndpoint = serviceKey ? readTicketEndpoint() : null;
  const messageStore = new MessageStore();

  const ticketClient = serviceKey && ticketEndpoint
    ? new McAuthTicketClient(serviceKey, ticketEndpoint, {
      onRetry: ({ reason, status, delayMs }) => {
        const statusText = status ? ` (HTTP ${status})` : '';
        log('warn', `Bot ticket request failed: ${reason}${statusText}; retrying in ${delayMs}ms`);
      }
    })
    : null;

  const connection = new BotConnection(
    config,
    {
      onLog: log,
      onChatMessage: (username, message) => messageStore.addMessage(username, message)
    },
    ticketClient ? 5000 : 2000,
    ticketClient ? (signal) => ticketClient.acquireTicket(signal) : undefined
  );

  const server = new McpServer({
    name: "minecraft-mcp-server",
    version: "2.0.4"
  });

  const factory = new ToolFactory(server, connection);
  const getBot = () => connection.getBot()!;

  registerPositionTools(factory, getBot);
  registerInventoryTools(factory, getBot);
  registerBlockTools(factory, getBot);
  registerEntityTools(factory, getBot);
  registerChatTools(factory, getBot, messageStore);
  registerFlightTools(factory, getBot);
  registerGameStateTools(factory, getBot);
  registerCraftingTools(factory, getBot);
  registerFurnaceTools(factory, getBot);

  process.stdin.on('end', () => {
    connection.cleanup();
    log('info', 'MCP Client has disconnected. Shutting down...');
    process.exit(0);
  });

  void connection.connect();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  log('error', `Fatal error in main(): ${error}`);
  process.exit(1);
});
