import test from 'ava';
import { parseConfig, readBotServiceKey, readTicketEndpoint } from '../src/config.js';

test('readBotServiceKey selects direct mode when the variable is absent', (t) => {
  t.is(readBotServiceKey({}), undefined);
});

test('readBotServiceKey returns the exact environment secret', (t) => {
  const serviceKey = 'mcbot_complete_service_key';

  t.is(readBotServiceKey({ MCAUTH_BOT_SERVICE_KEY: serviceKey }), serviceKey);
});

test('readBotServiceKey rejects empty or unsafe values without including them in the error', (t) => {
  for (const serviceKey of ['', '   ', 'not-a-service-key', 'mcbot_secret\nInjected: value', 'mcbot_s\u00ebcret']) {
    const error = t.throws(() => readBotServiceKey({ MCAUTH_BOT_SERVICE_KEY: serviceKey }));
    t.true(error.message.includes('MCAUTH_BOT_SERVICE_KEY'));
    if (serviceKey.length > 0) {
      t.false(error.message.includes(serviceKey));
    }
  }
});

test('readTicketEndpoint returns a configured HTTPS endpoint', (t) => {
  const endpoint = 'https://auth.example.com/v1/bot/tickets';

  t.is(readTicketEndpoint({ MCAUTH_TICKET_ENDPOINT: endpoint }), endpoint);
});

test('readTicketEndpoint rejects absent or unsafe endpoints', (t) => {
  for (const endpoint of [undefined, '', 'http://auth.example.com/tickets', 'https://user:pass@auth.example.com/tickets']) {
    const error = t.throws(() => readTicketEndpoint({ MCAUTH_TICKET_ENDPOINT: endpoint }));
    t.true(error.message.includes('MCAUTH_TICKET_ENDPOINT'));
    if (endpoint) t.false(error.message.includes(endpoint));
  }
});

test('parseConfig returns default values', (t) => {
  const originalArgv = process.argv;
  process.argv = ['node', 'script.js'];
  
  const config = parseConfig();
  
  t.is(config.host, 'localhost');
  t.is(config.port, 25565);
  t.is(config.username, 'LLMBot');
  
  process.argv = originalArgv;
});

test('parseConfig parses custom host', (t) => {
  const originalArgv = process.argv;
  process.argv = ['node', 'script.js', '--host', 'example.com'];
  
  const config = parseConfig();
  
  t.is(config.host, 'example.com');
  t.is(config.port, 25565);
  t.is(config.username, 'LLMBot');
  
  process.argv = originalArgv;
});

test('parseConfig parses custom port', (t) => {
  const originalArgv = process.argv;
  process.argv = ['node', 'script.js', '--port', '12345'];
  
  const config = parseConfig();
  
  t.is(config.host, 'localhost');
  t.is(config.port, 12345);
  t.is(config.username, 'LLMBot');
  
  process.argv = originalArgv;
});

test('parseConfig parses custom username', (t) => {
  const originalArgv = process.argv;
  process.argv = ['node', 'script.js', '--username', 'CustomBot'];
  
  const config = parseConfig();
  
  t.is(config.host, 'localhost');
  t.is(config.port, 25565);
  t.is(config.username, 'CustomBot');
  
  process.argv = originalArgv;
});

test('parseConfig parses all custom options', (t) => {
  const originalArgv = process.argv;
  process.argv = ['node', 'script.js', '--host', 'server.net', '--port', '9999', '--username', 'TestBot'];
  
  const config = parseConfig();
  
  t.is(config.host, 'server.net');
  t.is(config.port, 9999);
  t.is(config.username, 'TestBot');
  
  process.argv = originalArgv;
});

test('parseConfig handles numeric port as number type', (t) => {
  const originalArgv = process.argv;
  process.argv = ['node', 'script.js', '--port', '30000'];
  
  const config = parseConfig();
  
  t.is(typeof config.port, 'number');
  t.is(config.port, 30000);
  
  process.argv = originalArgv;
});
