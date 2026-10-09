import { setTimeout as sleep } from 'node:timers/promises';
import * as core from './lib/actions.js';
import { PeerlifyApi, describeFailure } from './lib/api.js';
import { run } from './lib/exec.js';
import { installClient } from './lib/install.js';
import { login, pingUntilAnswered, readStatus, waitForDaemon } from './lib/peerlify.js';
import {
  DEFAULT_API_URL,
  DEFAULT_PKGS_URL,
  isConnected,
  isValidHostname,
  normalizeTags,
  parseDuration,
  parseVersion,
  splitList,
  trimSlash,
} from './lib/util.js';

const DAEMON_START_TIMEOUT_MS = 120_000;
const LOGIN_RETRY_MS = 90_000;
// On a network that requires device approval the runner has no address until
// it is approved; give a network that doesn't this long before asking.
const APPROVE_AFTER_MS = 15_000;

async function main() {
  const authKeyInput = core.getInput('authkey');
  const apiToken = core.getInput('api-token');
  core.setSecret(authKeyInput);
  core.setSecret(apiToken);
  if (!authKeyInput && !apiToken) {
    throw new Error(
      'Set either `authkey` or `api-token`. If you passed a secret, check that it exists ' +
        'and is available to this workflow (secrets are not passed to workflows from forks).',
    );
  }
  if (authKeyInput && apiToken) {
    throw new Error('Set only one of `authkey` or `api-token`.');
  }

  const tags = normalizeTags(core.getInput('tags'));
  if (tags.length > 0 && authKeyInput) {
    core.warning('`tags` is ignored with `authkey`: an auth key carries the tags it was created with.');
  }
  const hostname = core.getInput('hostname');
  if (hostname && !isValidHostname(hostname)) {
    throw new Error(
      `Invalid hostname '${hostname}'. Use 1-63 letters, digits and hyphens, not starting or ending with a hyphen.`,
    );
  }
  const version = parseVersion(core.getInput('version'));
  const timeoutMs = parseDuration(core.getInput('timeout') || '3m');
  const pingTargets = splitList(core.getInput('ping'));
  const pkgsUrl = trimSlash(core.getInput('pkgs-url') || DEFAULT_PKGS_URL);
  const api = apiToken ? new PeerlifyApi(core.getInput('api-url') || DEFAULT_API_URL, apiToken) : null;

  const cli = await core.group('Install the Peerlify client', () =>
    installClient({ platform: process.platform, version, pkgsUrl }),
  );
  core.saveState('cli', cli);
  await core.group('Wait for the Peerlify daemon', () => waitForDaemon(cli, DAEMON_START_TIMEOUT_MS));

  let authKey = authKeyInput;
  if (api) {
    const minted = await core.group('Mint a single-use auth key', async () => {
      const key = await api.mintEphemeralKey({ description: keyDescription(), tags });
      core.setSecret(key.key);
      core.info(
        `Minted ephemeral key ${key.prefix}… for this run (expires in 1 day${tags.length ? `; tags: ${tags.join(', ')}` : ''}).`,
      );
      return key;
    });
    core.saveState('minted-key-id', minted.id);
    authKey = minted.key;
  }

  core.saveState('login-attempted', 'true');
  await core.group('Log in to Peerlify', () => login(cli, { authKey, hostname, retryForMs: LOGIN_RETRY_MS }));

  const status = await core.group('Wait for an address', () => waitForAddress(cli, { timeoutMs, api }));

  core.setOutput('ip', status.assignedIp ?? '');
  core.setOutput('fqdn', status.selfFqdn ?? '');
  core.setOutput('client-id', status.clientId ?? '');
  core.setOutput('network-id', status.networkId ?? '');
  core.info(
    `Connected to Peerlify network ${status.networkId || '(unknown)'} as ${status.selfFqdn || hostname || 'this runner'}, address ${status.assignedIp}.`,
  );

  for (const target of pingTargets) {
    await core.group(`Ping ${target}`, () => pingUntilAnswered(cli, target, timeoutMs));
  }
}

function keyDescription() {
  const env = process.env;
  const runRef = `${env.GITHUB_RUN_ID ?? 'local'}#${env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  return `GitHub Actions ${env.GITHUB_REPOSITORY ?? ''} run ${runRef} ${env.GITHUB_JOB ?? ''}`.replace(/\s+/g, ' ').trim();
}

async function waitForAddress(cli, { timeoutMs, api }) {
  const started = Date.now();
  let savedClientId = '';
  let approvalTried = false;

  for (;;) {
    const status = await readStatus(cli);

    // Save it as soon as it is known, so cleanup can find the device even if
    // this step fails from here on.
    if (status?.clientId && status.clientId !== savedClientId) {
      savedClientId = status.clientId;
      core.saveState('client-id', savedClientId);
    }

    if (isConnected(status)) {
      return status;
    }

    if (api && !approvalTried && Date.now() - started >= APPROVE_AFTER_MS) {
      approvalTried = true;
      await approve(api, status);
    }

    if (Date.now() - started >= timeoutMs) {
      const text = await run(cli, ['status'], { quiet: true });
      throw new Error(
        `The runner did not get a Peerlify address within ${timeoutMs / 1000}s. If the network requires ` +
          'device approval, approve the runner in the console, or use an `api-token` with devices:write.\n' +
          `${text.stdout.trim()}`,
      );
    }
    await sleep(2000);
  }
}

async function approve(api, status) {
  if (!status?.clientId) {
    if (status && !status.supportsJson) {
      core.warning(
        'This Peerlify client does not report its device ID (`peerlify status --json`), so the action cannot approve it through the API.',
      );
    }
    return;
  }
  core.info('No address yet; approving the runner in case the network requires device approval.');
  const result = await api.authorizeDevice(status.clientId);
  if (!result.ok) {
    core.warning(describeFailure('Approving the runner', result, 'devices:write'));
  }
}

main().catch(core.setFailed);
