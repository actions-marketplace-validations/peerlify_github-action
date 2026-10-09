import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// The package CDN refuses requests without a User-Agent.
export const USER_AGENT = 'peerlify-github-action/1 (+https://github.com/Peerlify/github-action)';

export async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/** Downloads `url` to `path` and returns the file's SHA-256 (lower-case hex). */
export async function download(url, path) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  const hash = createHash('sha256');
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(path));
  return hash.digest('hex');
}
