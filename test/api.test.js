import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { PeerlifyApi, describeFailure } from '../src/lib/api.js';

// A stand-in for the public API that records what the action sends.
let server;
let baseUrl;
let requests = [];
let respond = () => ({ status: 200, body: {} });

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
      const { status, body: reply } = respond(req);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(reply === undefined ? '' : JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/`;
});

after(() => server.close());

describe('PeerlifyApi', () => {
  it('mints a single-use ephemeral key that expires in a day', async () => {
    requests = [];
    respond = () => ({ status: 200, body: { id: 'key-oid', key: 'pk_secret', prefix: 'pk_secre' } });

    const key = await new PeerlifyApi(baseUrl, 'papi_token').mintEphemeralKey({
      description: 'GitHub Actions org/repo run 1#1 build',
      tags: ['ci'],
    });

    assert.deepEqual(key, { id: 'key-oid', key: 'pk_secret', prefix: 'pk_secre' });
    const [request] = requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/v1/keys');
    assert.equal(request.headers.authorization, 'Bearer papi_token');
    assert.match(request.headers['user-agent'], /^peerlify-github-action\//);
    assert.deepEqual(request.body, {
      description: 'GitHub Actions org/repo run 1#1 build',
      reusable: false,
      ephemeral: true,
      expiresInDays: 1,
      tags: ['ci'],
    });
  });

  it('explains a missing scope when minting is refused', async () => {
    respond = () => ({ status: 403, body: { error: 'Insufficient scope.' } });
    await assert.rejects(
      new PeerlifyApi(baseUrl, 'papi_token').mintEphemeralKey({ description: 'x', tags: [] }),
      /Minting an auth key failed: HTTP 403 — Insufficient scope\.\. Check that the API token has the keys:write scope\./,
    );
  });

  it('addresses devices and keys by ID', async () => {
    requests = [];
    respond = () => ({ status: 204, body: undefined });
    const api = new PeerlifyApi(baseUrl, 'papi_token');

    await api.authorizeDevice('123456789');
    await api.deleteDevice('123456789');
    await api.revokeKey('key-oid');

    assert.deepEqual(
      requests.map((r) => `${r.method} ${r.url}`),
      ['POST /api/v1/devices/123456789/authorize', 'DELETE /api/v1/devices/123456789', 'DELETE /api/v1/keys/key-oid'],
    );
  });
});

describe('describeFailure', () => {
  it('points at the token for 401s', () => {
    assert.match(describeFailure('Doing it', { status: 401, json: undefined, text: '' }, 'keys:write'), /token is valid/);
  });
});
