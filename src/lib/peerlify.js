import { setTimeout as sleep } from 'node:timers/promises';
import { info } from './actions.js';
import { run } from './exec.js';
import { isPermanentLoginFailure, parseStatusText } from './util.js';

const firstLine = (text) => String(text ?? '').trim().split(/\r?\n/)[0] ?? '';
const combined = (result) => `${result.stdout}\n${result.stderr}`.trim();

/** Waits until the freshly installed daemon answers on its control channel. */
export async function waitForDaemon(cli, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await run(cli, ['status'], { quiet: true });
    if (result.code === 0) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`The Peerlify daemon did not answer within ${timeoutMs / 1000}s.\n${combined(result)}`);
    }
    await sleep(2000);
  }
}

/**
 * The daemon's status snapshot, or null when it can't be read. Clients that
 * predate `status --json` are read from the text view, which carries the
 * address and network but not the device ID or mesh name.
 */
export async function readStatus(cli) {
  const json = await run(cli, ['status', '--json'], { quiet: true });
  if (json.code === 0) {
    try {
      return { ...JSON.parse(json.stdout.trim() || '{}'), supportsJson: true };
    } catch {
      // fall through to the text view
    }
  }
  const text = await run(cli, ['status'], { quiet: true });
  return text.code === 0 ? { ...parseStatusText(text.stdout), supportsJson: false } : null;
}

/**
 * `peerlify login --auth-key=...`, retried while the failure is one a retry
 * can fix — right after install the daemon may not have registered with the
 * control plane yet. A refused key fails at once.
 */
export async function login(cli, { authKey, hostname, retryForMs }) {
  const args = ['login', `--auth-key=${authKey}`];
  if (hostname) {
    args.push(`--hostname=${hostname}`);
  }

  const deadline = Date.now() + retryForMs;
  for (let attempt = 1; ; attempt++) {
    const result = await run(cli, args, { quiet: true });
    const output = combined(result);
    if (result.code === 0) {
      if (output) info(output);
      return;
    }
    if (/unexpected argument '--hostname/i.test(output)) {
      throw new Error(
        'This Peerlify client does not support --hostname. Remove the `hostname` input, ' +
          'or set `version` to a client release that has `peerlify login --hostname`.',
      );
    }
    if (isPermanentLoginFailure(output) || Date.now() >= deadline) {
      throw new Error(`peerlify login failed: ${output || `exit code ${result.code}`}`);
    }
    info(`Login attempt ${attempt} did not succeed (${firstLine(output)}); retrying.`);
    await sleep(5000);
  }
}

/** Pings `target` until it answers once, or the timeout passes. */
export async function pingUntilAnswered(cli, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await run(cli, ['ping', target, '-c', '1', '--timeout', '5s'], { quiet: true });
    if (result.code === 0) {
      info(result.stdout.trim());
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${target} did not answer within ${timeoutMs / 1000}s: ${firstLine(combined(result))}`);
    }
    await sleep(2000);
  }
}

export async function logout(cli) {
  return run(cli, ['logout'], { timeoutMs: 60_000 });
}
