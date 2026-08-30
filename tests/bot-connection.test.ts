import test from 'ava';
import sinon from 'sinon';
import { EventEmitter } from 'node:events';
import type mineflayer from 'mineflayer';
import minecraftData from 'minecraft-data';
import { BotConnection } from '../src/bot-connection.js';
import { McAuthTicketError } from '../src/mc-auth-ticket-client.js';

function createMockBot(username: string): mineflayer.Bot {
  return Object.assign(new EventEmitter(), {
    username,
    pathfinder: { setMovements: sinon.stub() },
    chat: sinon.stub(),
    quit: sinon.stub()
  }) as unknown as mineflayer.Bot;
}

test('constructor initializes with correct state', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  t.is(connection.getState(), 'disconnected');
  t.deepEqual(connection.getConfig(), config);
  t.is(connection.getBot(), null);
  t.false(connection.isConnected());
});

test('constructor accepts custom reconnect delay', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const customDelay = 5000;
  const connection = new BotConnection(config, callbacks, customDelay);

  t.is(connection.getState(), 'disconnected');
});

test('getState returns current state', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  t.is(connection.getState(), 'disconnected');
});

test('getConfig returns configuration', (t) => {
  const config = { host: 'example.com', port: 30000, username: 'MyBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  const returnedConfig = connection.getConfig();
  t.is(returnedConfig.host, 'example.com');
  t.is(returnedConfig.port, 30000);
  t.is(returnedConfig.username, 'MyBot');
});

test('getBot returns null initially', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  t.is(connection.getBot(), null);
});

test('isConnected returns false when state is disconnected', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  t.false(connection.isConnected());
});

test('formatError handles Error objects', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  const error = new Error('Test error');
  const formatted = (connection as unknown as { formatError: (error: unknown) => string }).formatError(error);

  t.is(formatted, 'Test error');
});

test('formatError handles plain objects', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  const errorObj = { code: 'ECONNREFUSED', message: 'Connection refused' };
  const formatted = (connection as unknown as { formatError: (error: unknown) => string }).formatError(errorObj);

  t.true(formatted.includes('ECONNREFUSED'));
  t.true(formatted.includes('Connection refused'));
});

test('formatError handles strings', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  const formatted = (connection as unknown as { formatError: (error: unknown) => string }).formatError('Simple error');

  t.is(formatted, '"Simple error"');
});

test('formatError handles non-serializable objects', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const formatted = (connection as unknown as { formatError: (error: unknown) => string }).formatError(circular);

  t.is(typeof formatted, 'string');
});

test('checkConnectionAndReconnect returns connected when already connected', async (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);
  
  (connection as unknown as { state: string }).state = 'connected';

  const result = await connection.checkConnectionAndReconnect();

  t.true(result.connected);
  t.is(result.message, undefined);
});

test('checkConnectionAndReconnect returns message when connecting', async (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  (connection as unknown as { state: string }).state = 'connecting';

  const result = await connection.checkConnectionAndReconnect();

  t.false(result.connected);
  t.true(result.message!.includes('connecting'));
});

test('checkConnectionAndReconnect includes setup instructions on failure', async (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks, 100);

  (connection as unknown as { state: string }).state = 'disconnected';

  // Stub attemptReconnect to prevent actual connection attempt
  const attemptReconnectStub = sinon.stub(connection as unknown as { attemptReconnect: () => void }, 'attemptReconnect').callsFake(() => {
    (connection as unknown as { state: string }).state = 'connecting';
  });

  const result = await connection.checkConnectionAndReconnect();

  t.true(attemptReconnectStub.calledOnce);
  t.false(result.connected);
  t.true(result.message!.includes('Cannot connect'));
  t.true(result.message!.includes('localhost:25565'));
  t.true(result.message!.includes('github.com'));

  attemptReconnectStub.restore();
});

test('cleanup clears reconnect timer', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  (connection as unknown as { reconnectTimer: ReturnType<typeof setTimeout> }).reconnectTimer = setTimeout(() => {}, 10000);

  t.notThrows(() => {
    connection.cleanup();
  });
});

test('cleanup does not throw when no bot exists', (t) => {
  const config = { host: 'localhost', port: 25565, username: 'TestBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const connection = new BotConnection(config, callbacks);

  t.notThrows(() => {
    connection.cleanup();
  });
});

test('direct mode preserves static Mineflayer connection options', async (t) => {
  const config = { host: 'direct.example.com', port: 25570, username: 'DirectBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const bot = createMockBot('DirectBot');
  const createBot = sinon.stub().returns(bot);
  const connection = new BotConnection(config, callbacks, 2000, undefined, createBot);

  await connection.connect();

  t.true(createBot.calledOnce);
  t.like(createBot.firstCall.args[0], {
    host: 'direct.example.com',
    port: 25570,
    username: 'DirectBot'
  });
  t.is(createBot.firstCall.args[0].auth, undefined);
  t.is(createBot.firstCall.args[0].version, undefined);

  connection.cleanup();
});

test('ticket mode uses offline authentication and Minecraft 26.1.2', async (t) => {
  const config = { host: 'ignored.example.com', port: 25565, username: 'IgnoredBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const ticketProvider = sinon.stub().resolves({
    hostname: 'ticket-1.example.com',
    port: 30001,
    minecraftName: 'TicketBot'
  });
  const bot = createMockBot('TicketBot');
  const createBot = sinon.stub().returns(bot);
  const connection = new BotConnection(config, callbacks, 5000, ticketProvider, createBot);

  await connection.connect();

  t.true(ticketProvider.calledOnce);
  t.like(createBot.firstCall.args[0], {
    host: 'ticket-1.example.com',
    port: 30001,
    username: 'TicketBot',
    auth: 'offline',
    version: '26.1.2'
  });
  t.truthy(createBot.firstCall.args[0].plugins);

  connection.cleanup();
});

test.serial('ticket mode requests a fresh ticket after disconnect', async (t) => {
  const clock = sinon.useFakeTimers();
  t.teardown(() => clock.restore());

  const config = { host: 'ignored.example.com', port: 25565, username: 'IgnoredBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const ticketProvider = sinon.stub();
  ticketProvider.onCall(0).resolves({
    hostname: 'ticket-1.example.com',
    port: 30001,
    minecraftName: 'TicketBot'
  });
  ticketProvider.onCall(1).resolves({
    hostname: 'ticket-2.example.com',
    port: 30002,
    minecraftName: 'TicketBot'
  });

  const firstBot = createMockBot('TicketBot');
  const secondBot = createMockBot('TicketBot');
  const createBot = sinon.stub();
  createBot.onCall(0).returns(firstBot);
  createBot.onCall(1).returns(secondBot);

  const connection = new BotConnection(config, callbacks, 5000, ticketProvider, createBot);
  await connection.connect();

  firstBot.emit('end', 'connection lost');
  await clock.tickAsync(5000);

  t.is(ticketProvider.callCount, 2);
  t.is(createBot.callCount, 2);
  t.is(createBot.firstCall.args[0].host, 'ticket-1.example.com');
  t.is(createBot.secondCall.args[0].host, 'ticket-2.example.com');

  connection.cleanup();
});

test.serial('a consumed ticket is replaced when Mineflayer creation fails', async (t) => {
  const clock = sinon.useFakeTimers();
  t.teardown(() => clock.restore());

  const config = { host: 'ignored.example.com', port: 25565, username: 'IgnoredBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const ticketProvider = sinon.stub();
  ticketProvider.onCall(0).resolves({
    hostname: 'ticket-1.example.com',
    port: 30001,
    minecraftName: 'TicketBot'
  });
  ticketProvider.onCall(1).resolves({
    hostname: 'ticket-2.example.com',
    port: 30002,
    minecraftName: 'TicketBot'
  });
  const createBot = sinon.stub();
  createBot.onCall(0).throws(new Error('Mineflayer creation failed'));
  createBot.onCall(1).returns(createMockBot('TicketBot'));

  const connection = new BotConnection(config, callbacks, 5000, ticketProvider, createBot);
  await connection.connect();
  await clock.tickAsync(5000);

  t.is(ticketProvider.callCount, 2);
  t.is(createBot.callCount, 2);
  t.is(createBot.secondCall.args[0].host, 'ticket-2.example.com');

  connection.cleanup();
});

test.serial('spawn clears a reconnect scheduled by a pre-spawn error', async (t) => {
  const clock = sinon.useFakeTimers();
  t.teardown(() => clock.restore());

  const config = { host: 'ignored.example.com', port: 25565, username: 'IgnoredBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const ticketProvider = sinon.stub().resolves({
    hostname: 'ticket.example.com',
    port: 30001,
    minecraftName: 'TicketBot'
  });
  const bot = createMockBot('TicketBot');
  Object.assign(bot, { registry: minecraftData('26.1.2') });
  const createBot = sinon.stub().returns(bot);

  const connection = new BotConnection(config, callbacks, 5000, ticketProvider, createBot);
  await connection.connect();

  bot.emit('error', Object.assign(new Error('temporary connection error'), { code: 'ECONNRESET' }));
  bot.emit('spawn');
  await clock.tickAsync(5000);

  t.is(connection.getState(), 'connected');
  t.true(ticketProvider.calledOnce);
  t.true(createBot.calledOnce);
  t.true((bot.quit as sinon.SinonStub).notCalled);

  connection.cleanup();
});

test.serial('overlapping error and end events schedule only one fresh ticket', async (t) => {
  const clock = sinon.useFakeTimers();
  t.teardown(() => clock.restore());

  const config = { host: 'ignored.example.com', port: 25565, username: 'IgnoredBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const ticketProvider = sinon.stub().resolves({
    hostname: 'ticket.example.com',
    port: 30001,
    minecraftName: 'TicketBot'
  });
  const firstBot = createMockBot('TicketBot');
  const secondBot = createMockBot('TicketBot');
  const createBot = sinon.stub();
  createBot.onCall(0).returns(firstBot);
  createBot.onCall(1).returns(secondBot);

  const connection = new BotConnection(config, callbacks, 5000, ticketProvider, createBot);
  await connection.connect();

  firstBot.emit('error', Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }));
  firstBot.emit('end', 'connection lost');
  await clock.tickAsync(5000);

  t.is(ticketProvider.callCount, 2);
  t.is(createBot.callCount, 2);

  connection.cleanup();
});

test('fatal ticket authentication errors are latched without retries', async (t) => {
  const config = { host: 'ignored.example.com', port: 25565, username: 'IgnoredBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  const ticketProvider = sinon.stub().rejects(
    new McAuthTicketError('Bot authentication was rejected (HTTP 401).', false)
  );
  const createBot = sinon.stub();
  const connection = new BotConnection(config, callbacks, 10, ticketProvider, createBot);

  await connection.connect();
  const result = await connection.checkConnectionAndReconnect();
  connection.attemptReconnect();

  t.false(result.connected);
  t.true(result.message!.includes('HTTP 401'));
  t.true(ticketProvider.calledOnce);
  t.true(createBot.notCalled);

  connection.cleanup();
});

test('cleanup aborts an in-flight ticket request before bot creation', async (t) => {
  const config = { host: 'ignored.example.com', port: 25565, username: 'IgnoredBot' };
  const callbacks = { onLog: sinon.stub(), onChatMessage: sinon.stub() };
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const ticketProvider = sinon.stub().callsFake((signal: AbortSignal) => new Promise((_resolve, reject) => {
    requestStarted();
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), {
      once: true
    });
  }));
  const createBot = sinon.stub();
  const connection = new BotConnection(config, callbacks, 10, ticketProvider, createBot);

  const connectPromise = connection.connect();
  await started;
  connection.cleanup();
  await connectPromise;

  t.true(createBot.notCalled);
  t.is(connection.getState(), 'disconnected');
});
