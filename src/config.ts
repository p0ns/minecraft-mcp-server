import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { isValidBotServiceKey, isValidTicketEndpoint } from './mc-auth-ticket-client.js';

export interface ServerConfig {
  host: string;
  port: number;
  username: string;
}

const BOT_SERVICE_KEY_ENV = 'MCAUTH_BOT_SERVICE_KEY';
const TICKET_ENDPOINT_ENV = 'MCAUTH_TICKET_ENDPOINT';

export function readBotServiceKey(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(env, BOT_SERVICE_KEY_ENV)) {
    return undefined;
  }

  const serviceKey = env[BOT_SERVICE_KEY_ENV];
  if (!serviceKey || !isValidBotServiceKey(serviceKey)) {
    throw new Error(`${BOT_SERVICE_KEY_ENV} must contain a valid service key`);
  }

  return serviceKey;
}

export function readTicketEndpoint(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const endpoint = env[TICKET_ENDPOINT_ENV];
  if (!endpoint || !isValidTicketEndpoint(endpoint)) {
    throw new Error(`${TICKET_ENDPOINT_ENV} must contain a valid HTTPS URL`);
  }

  return endpoint;
}

export function parseConfig(): ServerConfig {
  return yargs(hideBin(process.argv))
    .option('host', {
      type: 'string',
      description: 'Minecraft server host',
      default: 'localhost'
    })
    .option('port', {
      type: 'number',
      description: 'Minecraft server port',
      default: 25565
    })
    .option('username', {
      type: 'string',
      description: 'Bot username',
      default: 'LLMBot'
    })
    .help()
    .alias('help', 'h')
    .parseSync();
}
