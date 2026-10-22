const test = require('node:test');
const assert = require('node:assert');
const { makeRedactor } = require('../redact');

const redact = makeRedactor(['s3cretpass', 'mq', undefined, 'mqttpass']);

test('URL userinfo is removed', () => {
  assert.strictEqual(redact('GET http://user:s3cret@10.0.0.5:8080/devices/stream failed'),
    'GET http://***:***@10.0.0.5:8080/devices/stream failed');
  assert.strictEqual(redact('mqtt://token@broker:1883'), 'mqtt://***:***@broker:1883');
  // apostrophes and commas are valid in userinfo (gate r2 P1)
  assert.strictEqual(redact("mqtt://alice:pa'ss@broker:1883"), 'mqtt://***:***@broker:1883');
  assert.strictEqual(redact('mqtt://bob:a,b@broker:1883 down'), 'mqtt://***:***@broker:1883 down');
});

test("an '@' after the authority (query or fragment) is not userinfo (gate r2 P2)", () => {
  for (const line of ['http://gateway:8080?email=ops@example.invalid', 'http://gateway:8080#ops@example.invalid',
    'http://gateway:8080/x?email=ops@example.invalid']) {
    assert.strictEqual(redact(line), line);
  }
});

test('credential-free JSON with a URL and a later email is untouched (gate pr1089 P2)', () => {
  const line = '{"url":"http://gateway:8080","email":"ops@example.invalid"}';
  assert.strictEqual(redact(line), line);
});

test('plain lines without URLs or secrets are untouched', () => {
  for (const line of ['stream connected', 'topic opus/house/1 value 21.5', 'a//b c@d', 'see http://host/path?x=a@b']) {
    assert.strictEqual(redact(line), line);
  }
});

test('known secret values are masked; values shorter than 3 are ignored', () => {
  assert.strictEqual(redact('auth failed for s3cretpass and mqttpass'), 'auth failed for *** and ***');
  assert.strictEqual(redact('mq stays'), 'mq stays');
});
