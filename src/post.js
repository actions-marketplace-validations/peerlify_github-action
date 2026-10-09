// Runs after the job's other steps, whether they passed, failed or were
// cancelled. Cleanup problems are reported as warnings: they must never turn
// a passing job red.

import * as core from './lib/actions.js';
import { PeerlifyApi, describeFailure } from './lib/api.js';
import { logout } from './lib/peerlify.js';
import { DEFAULT_API_URL } from './lib/util.js';

async function post() {
  const cli = core.getState('cli');
  if (cli && core.getState('login-attempted') === 'true') {
    await core.group('Log out of Peerlify', async () => {
      // A device enrolled with an ephemeral key is removed from the network
      // when it logs out.
      const result = await logout(cli);
      if (result.code !== 0) {
        core.warning(`peerlify logout exited with ${result.code}; the runner may stay listed in the network until it times out.`);
      }
    });
  }

  const apiToken = core.getInput('api-token');
  if (!apiToken) {
    return;
  }
  const api = new PeerlifyApi(core.getInput('api-url') || DEFAULT_API_URL, apiToken);

  const clientId = core.getState('client-id');
  if (clientId) {
    // Normally already gone after the logout (404); this covers a logout that
    // could not reach the control plane.
    const result = await api.deleteDevice(clientId);
    if (!result.ok && result.status !== 404) {
      core.warning(describeFailure('Removing the runner from the network', result, 'devices:write'));
    }
  }

  const keyId = core.getState('minted-key-id');
  if (keyId) {
    const result = await api.revokeKey(keyId);
    if (!result.ok && result.status !== 404) {
      core.warning(describeFailure('Revoking the auth key minted for this run', result, 'keys:write'));
    }
  }
}

post().catch((err) => core.warning(`Peerlify cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
