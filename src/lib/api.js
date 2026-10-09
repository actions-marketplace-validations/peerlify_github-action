import { USER_AGENT } from './http.js';
import { trimSlash } from './util.js';

/**
 * The Peerlify public API calls the action makes with an API token: mint and
 * revoke a per-run auth key, approve the runner, remove it from the network.
 * The token is bound to one network, so no network ID is passed.
 */
export class PeerlifyApi {
  constructor(baseUrl, token) {
    this.baseUrl = trimSlash(baseUrl);
    this.token = token;
  }

  async request(method, path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { ok: response.ok, status: response.status, json, text };
  }

  /** A single-use, ephemeral key that expires in a day. */
  async mintEphemeralKey({ description, tags }) {
    const result = await this.request('POST', '/keys', {
      description,
      reusable: false,
      ephemeral: true,
      expiresInDays: 1,
      tags,
    });
    if (!result.ok || !result.json?.key) {
      throw new Error(describeFailure('Minting an auth key', result, 'keys:write'));
    }
    return { id: result.json.id, key: result.json.key, prefix: result.json.prefix ?? '' };
  }

  revokeKey(id) {
    return this.request('DELETE', `/keys/${encodeURIComponent(id)}`);
  }

  authorizeDevice(clientId) {
    return this.request('POST', `/devices/${encodeURIComponent(clientId)}/authorize`);
  }

  deleteDevice(clientId) {
    return this.request('DELETE', `/devices/${encodeURIComponent(clientId)}`);
  }
}

export function describeFailure(action, result, scope) {
  const detail = result.json?.error ?? result.text?.slice(0, 300) ?? '';
  const hint =
    result.status === 401
      ? ' Check that the API token is valid and not expired.'
      : result.status === 403
        ? ` Check that the API token has the ${scope} scope.`
        : '';
  return `${action} failed: HTTP ${result.status}${detail ? ` — ${detail}` : ''}.${hint}`;
}
