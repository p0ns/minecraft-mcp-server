import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import {
  MCAUTH_MINECRAFT_VERSION,
  McAuthTicketError,
  type McAuthTicket
} from './mc-auth-ticket-client.js';

const { pathfinder, Movements } = pathfinderPkg;

type ConnectionState = 'connected' | 'connecting' | 'disconnected';
type TicketProvider = (signal: AbortSignal) => Promise<McAuthTicket>;
type CreateBot = (options: mineflayer.BotOptions) => mineflayer.Bot;

interface BotConfig {
  host: string;
  port: number;
  username: string;
}

interface ConnectionTarget extends BotConfig {
  auth?: 'offline';
  version?: string;
}

interface ConnectionCallbacks {
  onLog: (level: string, message: string) => void;
  onChatMessage: (username: string, message: string) => void;
}

export class BotConnection {
  private bot: mineflayer.Bot | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptController: AbortController | null = null;
  private activeAttempt: Promise<void> | null = null;
  private activeTarget: ConnectionTarget | null = null;
  private fatalConnectionError: string | null = null;
  private stopped = false;

  constructor(
    private readonly config: BotConfig,
    private readonly callbacks: ConnectionCallbacks,
    private readonly reconnectDelayMs = 2000,
    private readonly ticketProvider?: TicketProvider,
    private readonly createBot: CreateBot = mineflayer.createBot
  ) {}

  getBot(): mineflayer.Bot | null {
    return this.bot;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getConfig(): BotConfig {
    return this.config;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  async connect(): Promise<void> {
    if (
      this.stopped ||
      this.fatalConnectionError ||
      this.bot ||
      this.activeAttempt ||
      this.reconnectTimer
    ) {
      return;
    }

    this.state = 'connecting';
    const controller = new AbortController();
    this.attemptController = controller;

    const attempt = this.openConnection(controller);
    this.activeAttempt = attempt;

    try {
      await attempt;
    } finally {
      if (this.activeAttempt === attempt) {
        this.activeAttempt = null;
      }
      if (this.attemptController === controller) {
        this.attemptController = null;
      }
    }
  }

  private async openConnection(controller: AbortController): Promise<void> {
    try {
      const target = await this.resolveTarget(controller.signal);
      if (controller.signal.aborted || this.stopped) return;

      const botOptions: mineflayer.BotOptions = {
        host: target.host,
        port: target.port,
        username: target.username,
        plugins: { pathfinder },
        ...(target.auth ? { auth: target.auth } : {}),
        ...(target.version ? { version: target.version } : {})
      };

      const bot = this.createBot(botOptions);
      if (controller.signal.aborted || this.stopped) {
        bot.quit('Server shutting down');
        return;
      }

      this.bot = bot;
      this.activeTarget = target;
      this.registerEventHandlers(bot);
    } catch (error) {
      if (controller.signal.aborted || this.stopped || isAbortError(error)) return;

      this.state = 'disconnected';
      const message = this.formatError(error);

      if (error instanceof McAuthTicketError && !error.retryable) {
        this.fatalConnectionError = message;
        this.callbacks.onLog('error', message);
        return;
      }

      this.callbacks.onLog('error', `Bot connection attempt failed: ${message}`);
      this.scheduleReconnect(this.reconnectDelayMs);
    }
  }

  private resolveTarget(signal: AbortSignal): Promise<ConnectionTarget> {
    if (!this.ticketProvider) {
      return Promise.resolve(this.config);
    }

    return this.ticketProvider(signal).then((ticket) => ({
      host: ticket.hostname,
      port: ticket.port,
      username: ticket.minecraftName,
      auth: 'offline',
      version: MCAUTH_MINECRAFT_VERSION
    }));
  }

  private registerEventHandlers(bot: mineflayer.Bot): void {
    bot.once('spawn', () => {
      if (this.bot !== bot || this.stopped) return;

      try {
        this.clearReconnectTimer();
        const defaultMove = new Movements(bot);
        bot.pathfinder.setMovements(defaultMove);

        this.state = 'connected';
        this.fatalConnectionError = null;
        this.callbacks.onLog('info', 'Bot spawned in world');
        bot.chat('LLM-powered bot ready to receive instructions!');

        const target = this.activeTarget!;
        this.callbacks.onLog(
          'info',
          `Bot connected successfully. Username: ${target.username}, Server: ${target.host}:${target.port}`
        );
      } catch (error) {
        this.callbacks.onLog('error', `Bot initialization failed: ${this.formatError(error)}`);
        this.state = 'disconnected';
        this.scheduleReconnect(this.reconnectDelayMs);
        bot.quit('Bot initialization failed');
      }
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      this.callbacks.onChatMessage(username, message);
    });

    bot.on('kicked', (reason) => {
      if (this.bot !== bot) return;

      this.callbacks.onLog('error', `Bot was kicked from server: ${this.formatError(reason)}`);
      this.state = 'disconnected';
      this.scheduleReconnect(this.reconnectDelayMs);
      bot.quit();
    });

    bot.on('error', (error) => {
      if (this.bot !== bot) return;

      const errorCode = (error as { code?: string }).code || 'Unknown error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onLog('error', `Bot error [${errorCode}]: ${errorMessage}`);

      if (this.state !== 'connected') {
        this.state = 'disconnected';
        this.scheduleReconnect(this.reconnectDelayMs);
      }
    });

    bot.on('login', () => {
      if (this.bot === bot) {
        this.callbacks.onLog('info', 'Bot logged in successfully');
      }
    });

    bot.on('end', (reason) => {
      if (this.bot !== bot) return;

      this.callbacks.onLog('info', `Bot disconnected: ${this.formatError(reason)}`);
      bot.removeAllListeners();
      this.bot = null;
      this.activeTarget = null;
      this.state = 'disconnected';

      this.callbacks.onLog('info', 'Bot instance cleaned up after disconnect');
      this.scheduleReconnect(this.reconnectDelayMs);
    });
  }

  attemptReconnect(): void {
    if (this.activeAttempt) return;
    this.scheduleReconnect(this.reconnectDelayMs);
  }

  private scheduleReconnect(delayMs: number): void {
    if (
      this.stopped ||
      this.fatalConnectionError ||
      this.reconnectTimer
    ) {
      return;
    }

    this.state = 'connecting';
    this.callbacks.onLog('info', `Attempting to reconnect to Minecraft server in ${delayMs}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.disposeCurrentBot();
      this.state = 'disconnected';
      this.callbacks.onLog('info', 'Creating new bot instance...');
      void this.connect();
    }, delayMs);
  }

  async checkConnectionAndReconnect(): Promise<{ connected: boolean; message?: string }> {
    if (this.state === 'connected') {
      return { connected: true };
    }

    if (this.fatalConnectionError) {
      return { connected: false, message: this.fatalConnectionError };
    }

    if (this.state === 'connecting') {
      const target = this.ticketProvider ? 'the ticket-authenticated server' : `${this.config.host}:${this.config.port}`;
      return { connected: false, message: `Bot is connecting to ${target}. Please try again shortly.` };
    }

    if (this.state === 'disconnected') {
      this.attemptReconnect();
    }

    if (this.ticketProvider) {
      return {
        connected: false,
        message: 'Bot is connecting to the ticket-authenticated server. A fresh ticket will be requested automatically.'
      };
    }

    return {
      connected: false,
      message:
        `Cannot connect to Minecraft server at ${this.config.host}:${this.config.port}\n\n` +
        `Please ensure:\n` +
        `1. Minecraft server is running on ${this.config.host}:${this.config.port}\n` +
        `2. Server is accessible from this machine\n` +
        `3. Server version is compatible (latest supported: ${mineflayer.latestSupportedVersion})\n\n` +
        `For setup instructions, visit: https://github.com/yuniko-software/minecraft-mcp-server`
    };
  }

  cleanup(): void {
    if (this.stopped) return;
    this.stopped = true;

    this.clearReconnectTimer();

    this.attemptController?.abort();
    this.attemptController = null;
    this.disposeCurrentBot();
    this.state = 'disconnected';
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private disposeCurrentBot(): void {
    const bot = this.bot;
    if (!bot) return;

    this.bot = null;
    this.activeTarget = null;
    bot.removeAllListeners();

    try {
      bot.quit('Server shutting down');
    } catch (error) {
      this.callbacks.onLog('warn', `Error during bot cleanup: ${this.formatError(error)}`);
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
