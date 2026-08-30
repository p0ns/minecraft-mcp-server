# Minecraft MCP Server

<a href="https://github.com/yuniko-software/minecraft-mcp-server/actions">
  <img alt="CI" src="https://github.com/yuniko-software/minecraft-mcp-server/actions/workflows/build.yml/badge.svg">
</a>
<a href="https://github.com/yuniko-software">
  <img alt="Contribution Welcome" src="https://img.shields.io/badge/Contribution-Welcome-blue">
</a>
<a href="https://github.com/yuniko-software/minecraft-mcp-server/releases/latest">
  <img alt="Latest Release" src="https://img.shields.io/github/v/release/yuniko-software/minecraft-mcp-server?label=Latest%20Release">
</a>

<img width="2063" height="757" alt="image" src="https://github.com/user-attachments/assets/3f0f0438-f079-4226-90bd-87b9e1311d19" />

___

> [!IMPORTANT]
> Mineflayer 4.38 maps Minecraft 26.1.2 to protocol 775 and its tested 26.1 data. Direct connections to older supported Java Edition versions still use automatic protocol detection.

https://github.com/user-attachments/assets/6f17f329-3991-4bc7-badd-7cde9aacb92f

A Minecraft bot powered by large language models and [Mineflayer API](https://github.com/PrismarineJS/mineflayer). This bot uses the [Model Context Protocol](https://github.com/modelcontextprotocol) (MCP) to enable Claude and other supported models to control a Minecraft character.

<a href="https://glama.ai/mcp/servers/@yuniko-software/minecraft-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@yuniko-software/minecraft-mcp-server/badge" alt="mcp-minecraft MCP server" />
</a>

## Prerequisites

- Git
- Node.js (>= 22.12.0)
- A running, supported Minecraft Java Edition game (Mineflayer's current tested range is 1.8 through 26.1)
- An MCP-compatible client. Claude Desktop will be used as an example, but other MCP clients are also supported

## Getting started

This bot supports direct Minecraft connections and generic ticket-authenticated connections. It is designed to run through an MCP client such as Claude Desktop.

### Connect with ticket authentication

Obtain a service key and HTTPS ticket endpoint from your Minecraft service provider, then store both in a protected file:

```bash
mkdir -p ~/.config/minecraft-mcp
cat > ~/.config/minecraft-mcp/ticket-auth.env <<'EOF'
MCAUTH_BOT_SERVICE_KEY=mcbot_replace_with_the_complete_key
MCAUTH_TICKET_ENDPOINT=https://auth.example.com/v1/bot/tickets
EOF
chmod 600 ~/.config/minecraft-mcp/ticket-auth.env
```

Never commit the key or put it in an MCP prompt, command argument, URL, Minecraft chat, DNS, or logs. The server sends it only as a Bearer token to the configured HTTPS endpoint; redirects are not followed.

On macOS or Linux, configure Claude Desktop without placing the key itself in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "sh",
      "args": [
        "-c",
        "set -a; . \"$HOME/.config/minecraft-mcp/ticket-auth.env\"; set +a; exec npx -y github:p0ns/minecraft-mcp-server"
      ]
    }
  }
}
```

When `MCAUTH_BOT_SERVICE_KEY` is present, `MCAUTH_TICKET_ENDPOINT` is required, ticket mode takes precedence, and `--host`, `--port`, and `--username` are ignored. The bot:

- requests a one-use ticket for server ID `primary`;
- connects to the returned hostname and port as the returned Minecraft name;
- uses offline authentication and Minecraft version `26.1.2` (protocol 775);
- obtains a fresh ticket after every disconnect;
- honors rate limits and retries temporary authentication-service failures without stopping MCP;
- stops retrying rejected credentials until the MCP server is restarted.

For other MCP clients and Windows, inject both variables through a protected secret manager or the parent process environment. Do not place the key in an unprotected MCP configuration file. Rotate the key immediately if it is exposed.

### Connect directly

Without `MCAUTH_BOT_SERVICE_KEY`, the original static host mode remains active. For a local world, open it to LAN (`ESC -> Open to LAN`) and configure Claude Desktop:

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "npx",
      "args": [
        "-y",
        "github:p0ns/minecraft-mcp-server",
        "--host",
        "localhost",
        "--port",
        "25565",
        "--username",
        "ClaudeBot"
      ]
    }
  }
}
```

Double-check the direct server host and port. Completely restart Claude Desktop after changing its configuration or rotating a service key.

## Running

Start Claude Desktop after configuring either connection mode. In direct LAN mode, ensure the Minecraft world is open to LAN; in ticket mode, the bot will request a fresh ticket and join the returned server automatically.

**It could take some time for Claude Desktop to boot the MCP server**. The marker that the server has booted successfully:

<img width="885" height="670" alt="image" src="https://github.com/user-attachments/assets/ccbb42f8-6544-462c-8ac1-8af13ddfcddd" />

You can give bot any commands through any active Claude Desktop chat. You can also upload images of buildings and ask bot to build them 😁

Don't forget to mention that bot should do something in Minecraft in your prompt. Because saying this is a trigger to run MCP server. It will ask for your permissions.

Using Claude Sonnet could give you some interesting results. The bot-agent would be really smart 🫡

Example usage: [shared Claude chat](https://claude.ai/share/535d5f69-f102-4cdb-9801-f74ea5709c0b)

## Available Commands

Once connected to a Minecraft server, Claude can use these commands:

### Movement
- `get-position` - Get the current position of the bot
- `move-to-position` - Move to specific coordinates
- `look-at` - Make the bot look at specific coordinates
- `jump` - Make the bot jump
- `move-in-direction` - Move in a specific direction for a duration

### Flight
- `fly-to` - Make the bot fly directly to specific coordinates

### Inventory
- `list-inventory` - List all items in the bot's inventory
- `find-item` - Find a specific item in inventory
- `equip-item` - Equip a specific item

### Block Interaction
- `place-block` - Place a block at specified coordinates
- `dig-block` - Dig a block at specified coordinates
- `get-block-info` - Get information about a block
- `find-blocks` - Find one or more nearby blocks of a specific type

### Furnace
- `smelt-item` - Smelt items using a furnace-like block

### Entity Interaction
- `find-entity` - Find the nearest entity of a specific type

### Communication
- `send-chat` - Send a chat message in-game
- `read-chat` - Get recent chat messages from players

### Game State
- `detect-gamemode` - Detect the gamemode on game

## Contributing

Feel free to submit pull requests or open issues for improvements. All refactoring commits, functional and test contributions, issues and discussion are greatly appreciated!

To get started with contributing, please see [CONTRIBUTING.md](CONTRIBUTING.md).

---

⭐ If you find this project useful, please consider giving it a star on GitHub! ⭐

Your support helps make this project more visible to other people who might benefit from it.
