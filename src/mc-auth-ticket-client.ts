import { isIP } from 'node:net';

export const MCAUTH_MINECRAFT_VERSION = '26.1.2';

const SERVER_ID = 'primary';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Sleep = (delayMs: number, signal: AbortSignal) => Promise<void>;

interface TicketHttpResponse {
  status: number;
  retryAfter: string | null;
  body?: unknown;
}

export interface McAuthTicket {
  hostname: string;
  port: number;
  minecraftName: string;
}

export interface TicketRetryInfo {
  reason: 'network' | 'rate-limit' | 'server';
  delayMs: number;
  status?: number;
}

interface McAuthTicketClientOptions {
  fetch?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
  requestTimeoutMs?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  onRetry?: (info: TicketRetryInfo) => void;
}

export class McAuthTicketError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'McAuthTicketError';
  }
}

export class McAuthTicketClient {
  private readonly fetch: FetchLike;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly onRetry?: (info: TicketRetryInfo) => void;

  constructor(
    private readonly serviceKey: string,
    private readonly ticketEndpoint: string,
    options: McAuthTicketClientOptions = {}
  ) {
    if (!isValidBotServiceKey(serviceKey)) {
      throw new McAuthTicketError('MCAUTH_BOT_SERVICE_KEY must contain a valid service key.', false);
    }
    if (!isValidTicketEndpoint(ticketEndpoint)) {
      throw new McAuthTicketError('MCAUTH_TICKET_ENDPOINT must contain a valid HTTPS URL.', false);
    }

    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.onRetry = options.onRetry;
  }

  async acquireTicket(signal: AbortSignal): Promise<McAuthTicket> {
    let retryCount = 0;

    while (!signal.aborted) {
      let response: TicketHttpResponse;

      try {
        response = await this.requestTicket(signal);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          throw createAbortError();
        }
        if (error instanceof McAuthTicketError && !error.retryable) {
          throw error;
        }

        const delayMs = this.getBackoffDelay(retryCount++);
        this.onRetry?.({ reason: 'network', delayMs });
        await this.sleep(delayMs, signal);
        continue;
      }

      if (response.status === 201) {
        return this.parseTicket(response.body);
      }

      if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
        const fallbackDelayMs = this.getBackoffDelay(retryCount++);
        const delayMs = this.getRetryAfterDelay(response.retryAfter, fallbackDelayMs);
        const reason = response.status === 429 ? 'rate-limit' : 'server';

        this.onRetry?.({ reason, status: response.status, delayMs });
        await this.sleep(delayMs, signal);
        continue;
      }

      if (response.status === 401) {
        throw new McAuthTicketError(
          'Bot authentication was rejected (HTTP 401). Check MCAUTH_BOT_SERVICE_KEY and restart the MCP server.',
          false
        );
      }

      throw new McAuthTicketError(
        `Bot ticket request failed with non-retryable HTTP status ${response.status}.`,
        false
      );
    }

    throw createAbortError();
  }

  private async requestTicket(signal: AbortSignal): Promise<TicketHttpResponse> {
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    const timeoutId = setTimeout(abortRequest, this.requestTimeoutMs);

    signal.addEventListener('abort', abortRequest, { once: true });

    try {
      const response = await this.fetch(this.ticketEndpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.serviceKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ serverId: SERVER_ID }),
        redirect: 'manual',
        signal: requestController.signal
      });
      const retryAfter = response.headers.get('retry-after');

      if (response.status !== 201) {
        await response.body?.cancel().catch(() => undefined);
        return { status: response.status, retryAfter };
      }

      let responseText: string;
      try {
        responseText = await response.text();
      } catch {
        throw new McAuthTicketError('Bot ticket response could not be read.', true);
      }

      let body: unknown;
      try {
        body = JSON.parse(responseText);
      } catch {
        throw new McAuthTicketError('Bot ticket service returned invalid JSON.', false);
      }

      return { status: response.status, retryAfter, body };
    } catch (error) {
      if (signal.aborted) {
        throw createAbortError();
      }
      if (error instanceof McAuthTicketError) {
        throw error;
      }
      throw new McAuthTicketError('Bot ticket service is temporarily unavailable.', true);
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', abortRequest);
      requestController.abort();
    }
  }

  private parseTicket(body: unknown): McAuthTicket {
    if (!isRecord(body)) {
      throw new McAuthTicketError('Bot ticket service returned an invalid ticket.', false);
    }

    const { hostname, port, minecraftName } = body;

    if (!isValidHostname(hostname) || !isValidPort(port) || !isValidMinecraftName(minecraftName)) {
      throw new McAuthTicketError('Bot ticket service returned an invalid ticket.', false);
    }

    return { hostname, port, minecraftName };
  }

  private getBackoffDelay(retryCount: number): number {
    return Math.min(this.retryDelayMs * (2 ** Math.min(retryCount, 4)), this.maxRetryDelayMs);
  }

  private getRetryAfterDelay(value: string | null, fallbackDelayMs: number): number {
    if (!value) return fallbackDelayMs;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1_000, this.maxRetryDelayMs);
    }

    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      const delayMs = timestamp - this.now();
      if (delayMs > 0) {
        return Math.min(delayMs, this.maxRetryDelayMs);
      }
    }

    return fallbackDelayMs;
  }
}

export function isValidBotServiceKey(value: string): boolean {
  return value.startsWith('mcbot_') &&
    value.length > 'mcbot_'.length &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 33 && code <= 126;
    });
}

export function isValidTicketEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:' &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      endpoint.hash === '';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253 || value !== value.trim()) {
    return false;
  }
  if (isIP(value) !== 0) return true;
  if (!/^[A-Za-z0-9.-]+$/.test(value) || value.startsWith('.') || value.endsWith('.')) return false;

  return value.split('.').every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function isValidMinecraftName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(value);
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error('Bot ticket request was cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
