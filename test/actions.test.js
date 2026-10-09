import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getInput, getState, setOutput } from '../src/lib/actions.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));

describe('runner protocol', () => {
  it('reads inputs the way the runner passes them, hyphens included', () => {
    process.env['INPUT_API-TOKEN'] = '  papi_x  ';
    assert.equal(getInput('api-token'), 'papi_x');
    delete process.env['INPUT_API-TOKEN'];
    assert.equal(getInput('api-token'), '');
  });

  it('writes outputs as delimited blocks so values may hold newlines', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gha-')), 'output');
    writeFileSync(file, '');
    process.env.GITHUB_OUTPUT = file;
    setOutput('ip', '100.64.0.9');
    const text = readFileSync(file, 'utf8');
    assert.match(text, /^ip<<(ghadelimiter_[0-9a-f-]+)\r?\n100\.64\.0\.9\r?\n\1\r?\n$/);
  });

  it('reads state saved by the main step', () => {
    process.env.STATE_cli = 'peerlify';
    assert.equal(getState('cli'), 'peerlify');
  });
});

describe('main step input validation', () => {
  // Runs the real entry point. Every case fails before anything is installed.
  function runMain(inputs) {
    const env = { ...process.env, GITHUB_OUTPUT: '', GITHUB_STATE: '' };
    for (const key of Object.keys(env)) {
      if (key.startsWith('INPUT_')) delete env[key];
    }
    for (const [name, value] of Object.entries(inputs)) {
      env[`INPUT_${name.toUpperCase()}`] = value;
    }
    return spawnSync(process.execPath, [MAIN], { env, encoding: 'utf8' });
  }

  it('needs a credential', () => {
    const result = runMain({});
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::Set either `authkey` or `api-token`/);
  });

  it('refuses both credentials at once', () => {
    const result = runMain({ authkey: 'pk_a', 'api-token': 'papi_b' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::Set only one of/);
  });

  it('masks the credentials before anything else is logged', () => {
    const result = runMain({ authkey: 'pk_a', 'api-token': 'papi_b' });
    const lines = result.stdout.split(/\r?\n/);
    assert.equal(lines[0], '::add-mask::pk_a');
    assert.equal(lines[1], '::add-mask::papi_b');
  });

  it('refuses a hostname that is not a DNS label', () => {
    const result = runMain({ authkey: 'pk_a', hostname: 'build runner' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::Invalid hostname 'build runner'/);
  });

  it('refuses a version it cannot install', () => {
    const result = runMain({ authkey: 'pk_a', version: 'latest' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::Invalid version 'latest'/);
  });
});
