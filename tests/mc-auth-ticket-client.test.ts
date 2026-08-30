import test from 'ava';
import sinon from 'sinon';
import minecraftData from 'minecraft-data';
import {
  MCAUTH_MINECRAFT_VERSION,
  McAuthTicketClient,
  McAuthTicketError
} from '../src/mc-auth-ticket-client.js';

const SERVICE_KEY = 'mcbot_test_secret_that_must_not_leak';
const TICKET_ENDPOINT = 'https://auth.example.com/v1/bot/tickets';
const VALID_TICKET = {
  hostname: 'ticket-123.example.com',
  port: 25565,
  minecraftName: 'TestBot_1'
};

function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json');

  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

test('rejects malformed service keys before making a request', (t) => {
  const fetchStub = sinon.stub();

  const error = t.throws(
    () => new McAuthTicketClient('not-a-service-key', TICKET_ENDPOINT, { fetch: fetchStub }),
    { instanceOf: McAuthTicketError }
  );

  t.false(error.retryable);
  t.true(fetchStub.notCalled);
});

test('rejects unsafe ticket endpoints before making a request', (t) => {
  const fetchStub = sinon.stub();

  const error = t.throws(
    () => new McAuthTicketClient(SERVICE_KEY, 'http://auth.example.com/tickets', { fetch: fetchStub }),
    { instanceOf: McAuthTicketError }
  );

  t.false(error.retryable);
  t.true(fetchStub.notCalled);
});

test('requests a ticket using only the configured HTTPS authentication endpoint', async (t) => {
  const fetchStub = sinon.stub().resolves(jsonResponse(201, VALID_TICKET));
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, { fetch: fetchStub });

  const ticket = await client.acquireTicket(new AbortController().signal);

  t.deepEqual(ticket, VALID_TICKET);
  t.true(fetchStub.calledOnce);

  const [url, init] = fetchStub.firstCall.args as [string, RequestInit];
  const headers = new Headers(init.headers);

  t.is(url, 'https://auth.example.com/v1/bot/tickets');
  t.is(init.method, 'POST');
  t.is(init.redirect, 'manual');
  t.is(init.body, JSON.stringify({ serverId: 'primary' }));
  t.is(headers.get('authorization'), `Bearer ${SERVICE_KEY}`);
  t.is(headers.get('content-type'), 'application/json');
  t.false(url.includes(SERVICE_KEY));
  t.false(String(init.body).includes(SERVICE_KEY));
});

test('Minecraft 26.1.2 resolves to protocol 775', (t) => {
  const data = minecraftData(MCAUTH_MINECRAFT_VERSION);

  t.is(data.version.version, 775);
  t.is(data.version.minecraftVersion, '26.1');
});

test('retries rate limits and server failures with bounded backoff', async (t) => {
  const fetchStub = sinon.stub();
  fetchStub.onCall(0).resolves(jsonResponse(429, {}, { 'retry-after': '7' }));
  fetchStub.onCall(1).resolves(jsonResponse(503, {}, { 'retry-after': '12' }));
  fetchStub.onCall(2).resolves(jsonResponse(201, VALID_TICKET));

  const delays: number[] = [];
  const retries: Array<{ reason: string; status?: number; delayMs: number }> = [];
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: fetchStub,
    sleep: async (delayMs) => { delays.push(delayMs); },
    onRetry: (info) => retries.push(info)
  });

  const ticket = await client.acquireTicket(new AbortController().signal);

  t.deepEqual(ticket, VALID_TICKET);
  t.deepEqual(delays, [7000, 12000]);
  t.deepEqual(retries, [
    { reason: 'rate-limit', status: 429, delayMs: 7000 },
    { reason: 'server', status: 503, delayMs: 12000 }
  ]);
  t.is(fetchStub.callCount, 3);
});

test('caps exponential retry delays at 60 seconds', async (t) => {
  const fetchStub = sinon.stub();
  for (let index = 0; index < 6; index += 1) {
    fetchStub.onCall(index).resolves(jsonResponse(503, {}));
  }
  fetchStub.onCall(6).resolves(jsonResponse(201, VALID_TICKET));

  const delays: number[] = [];
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: fetchStub,
    sleep: async (delayMs) => { delays.push(delayMs); }
  });

  await client.acquireTicket(new AbortController().signal);

  t.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000]);
});

test('retries network failures without exposing the service key', async (t) => {
  const fetchStub = sinon.stub();
  fetchStub.onCall(0).rejects(new Error(`network error ${SERVICE_KEY}`));
  fetchStub.onCall(1).resolves(jsonResponse(201, VALID_TICKET));

  const delays: number[] = [];
  const retryMessages: string[] = [];
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: fetchStub,
    sleep: async (delayMs) => { delays.push(delayMs); },
    onRetry: (info) => retryMessages.push(JSON.stringify(info))
  });

  await client.acquireTicket(new AbortController().signal);

  t.deepEqual(delays, [5000]);
  t.true(retryMessages.every((message) => !message.includes(SERVICE_KEY)));
});

for (const status of [200, 302, 400, 403]) {
  test(`rejects non-retryable HTTP ${status} without retrying`, async (t) => {
    const fetchStub = sinon.stub().resolves(jsonResponse(status, {}));
    const sleepStub = sinon.stub();
    const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
      fetch: fetchStub,
      sleep: sleepStub
    });

    const error = await t.throwsAsync(
      client.acquireTicket(new AbortController().signal),
      { instanceOf: McAuthTicketError }
    );

    t.false(error.retryable);
    t.true(error.message.includes(String(status)));
    t.true(fetchStub.calledOnce);
    t.true(sleepStub.notCalled);
  });
}

test('rejects invalid credentials without retrying or leaking the key', async (t) => {
  const fetchStub = sinon.stub().resolves(jsonResponse(401, { message: SERVICE_KEY }));
  const sleepStub = sinon.stub();
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: fetchStub,
    sleep: sleepStub
  });

  const error = await t.throwsAsync(
    client.acquireTicket(new AbortController().signal),
    { instanceOf: McAuthTicketError }
  );

  t.false(error.retryable);
  t.true(error.message.includes('HTTP 401'));
  t.false(error.message.includes(SERVICE_KEY));
  t.true(fetchStub.calledOnce);
  t.true(sleepStub.notCalled);
});

for (const [name, body] of [
  ['missing hostname', { port: 25565, minecraftName: 'TestBot' }],
  ['unsafe hostname', { hostname: 'https://evil.test/path', port: 25565, minecraftName: 'TestBot' }],
  ['invalid hostname syntax', { hostname: 'user@bad:host', port: 25565, minecraftName: 'TestBot' }],
  ['invalid port', { hostname: 'ticket.example.com', port: 70000, minecraftName: 'TestBot' }],
  ['invalid Minecraft name', { hostname: 'ticket.example.com', port: 25565, minecraftName: 'not valid!' }]
] as const) {
  test(`rejects a ticket with ${name}`, async (t) => {
    const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
      fetch: sinon.stub().resolves(jsonResponse(201, body))
    });

    const error = await t.throwsAsync(
      client.acquireTicket(new AbortController().signal),
      { instanceOf: McAuthTicketError }
    );

    t.false(error.retryable);
    t.is(error.message, 'Bot ticket service returned an invalid ticket.');
  });
}

test('rejects malformed ticket JSON without retrying', async (t) => {
  const fetchStub = sinon.stub().resolves(new Response('not json', { status: 201 }));
  const sleepStub = sinon.stub();
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: fetchStub,
    sleep: sleepStub
  });

  const error = await t.throwsAsync(
    client.acquireTicket(new AbortController().signal),
    { instanceOf: McAuthTicketError }
  );

  t.false(error.retryable);
  t.true(sleepStub.notCalled);
});

test('retries when a successful response body exceeds the request timeout', async (t) => {
  const fetchStub = sinon.stub();
  fetchStub.onCall(0).callsFake((_url: string, init: RequestInit) => {
    const stream = new ReadableStream({
      start(controller) {
        init.signal!.addEventListener('abort', () => {
          controller.error(Object.assign(new Error('timed out'), { name: 'AbortError' }));
        }, { once: true });
      }
    });
    return Promise.resolve(new Response(stream, { status: 201 }));
  });
  fetchStub.onCall(1).resolves(jsonResponse(201, VALID_TICKET));

  const delays: number[] = [];
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: fetchStub,
    requestTimeoutMs: 20,
    sleep: async (delayMs) => { delays.push(delayMs); }
  });

  const ticket = await client.acquireTicket(new AbortController().signal);

  t.deepEqual(ticket, VALID_TICKET);
  t.deepEqual(delays, [5000]);
  t.is(fetchStub.callCount, 2);
});

test('aborts while reading a successful response body', async (t) => {
  const controller = new AbortController();
  const sleepStub = sinon.stub();
  const fetchStub = sinon.stub().callsFake((_url: string, init: RequestInit) => {
    const stream = new ReadableStream({
      start(streamController) {
        init.signal!.addEventListener('abort', () => {
          streamController.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      }
    });
    return Promise.resolve(new Response(stream, { status: 201 }));
  });
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: fetchStub,
    sleep: sleepStub
  });

  const ticketPromise = client.acquireTicket(controller.signal);
  await Promise.resolve();
  controller.abort();

  const error = await t.throwsAsync(ticketPromise);
  t.is(error.name, 'AbortError');
  t.true(sleepStub.notCalled);
});

test('aborts while waiting to retry', async (t) => {
  const controller = new AbortController();
  let notifySleepStarted!: () => void;
  const sleepStarted = new Promise<void>((resolve) => { notifySleepStarted = resolve; });
  const client = new McAuthTicketClient(SERVICE_KEY, TICKET_ENDPOINT, {
    fetch: sinon.stub().resolves(jsonResponse(503, {})),
    sleep: (_delayMs, signal) => new Promise((resolve, reject) => {
      notifySleepStarted();
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), {
        once: true
      });
    })
  });

  const ticketPromise = client.acquireTicket(controller.signal);
  await sleepStarted;
  controller.abort();

  const error = await t.throwsAsync(ticketPromise);
  t.is(error.name, 'AbortError');
});
