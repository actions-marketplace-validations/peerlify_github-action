// Pure helpers: no I/O, so every rule here is unit-tested in test/util.test.js.

export const DEFAULT_API_URL = 'https://web.peerlify.com/api/v1';
export const DEFAULT_PKGS_URL = 'https://pkgs.peerlify.net';

const DURATION = /^(\d+)\s*(ms|s|m|h)?$/i;

/** "90s", "3m", "1h", "500ms" or a bare number of seconds -> milliseconds. */
export function parseDuration(text) {
  const match = DURATION.exec(String(text ?? '').trim());
  if (!match) {
    throw new Error(`Invalid duration '${text}'. Use a number with an optional unit, e.g. 90s or 3m.`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  return value * factor;
}

/** Comma- or newline-separated list -> trimmed, non-empty entries. */
export function splitList(text) {
  return String(text ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Tag names as the network stores them: the console and API keep the bare
 * name ("ci"), so a "tag:" prefix is dropped. Case-insensitive duplicates go.
 */
export function normalizeTags(text) {
  const seen = new Set();
  const tags = [];
  for (const raw of splitList(text)) {
    const name = raw.replace(/^tag:/i, '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    tags.push(name);
  }
  return tags;
}

/** The same rule `peerlify login --hostname` enforces: one DNS label. */
export function isValidHostname(name) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name);
}

/** `stable`, or an exact release such as 2.6.0 / 2.6.0.123. */
export function parseVersion(text) {
  const value = String(text ?? '').trim() || 'stable';
  if (value.toLowerCase() === 'stable') return 'stable';
  if (/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) return value;
  throw new Error(`Invalid version '${text}'. Use 'stable' or an exact version such as 2.6.0.`);
}

/** Node's process.arch -> the architecture name Peerlify's Windows packages use. */
export function windowsArch(nodeArch) {
  switch (nodeArch) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'arm64';
    case 'ia32':
      return 'x86';
    default:
      throw new Error(`Unsupported Windows architecture '${nodeArch}'.`);
  }
}

/** Where the Windows MSI for a version lives, and its file name. */
export function windowsPackage(pkgsUrl, channelOrVersion, version, arch) {
  const base = `${trimSlash(pkgsUrl)}/client/${channelOrVersion}/windows/${arch}`;
  const file = `Peerlify_${version}_${arch}.msi`;
  return { url: `${base}/${file}`, checksumUrl: `${base}/${file}.sha256`, file };
}

export function trimSlash(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

/** The hex digest from a `.sha256` file: the first token, lower-cased. */
export function parseChecksum(text) {
  const token = String(text ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error('The package checksum file is not a SHA-256 digest.');
  }
  return token.toLowerCase();
}

/**
 * Login failures that retrying cannot fix: the key itself was refused. Any
 * other failure (most often the daemon not having registered yet right after
 * install) is worth another attempt.
 */
export function isPermanentLoginFailure(output) {
  return /auth key (not recognized|has been revoked|has expired|has no remaining uses|has no owner|was created before)|--auth-key is empty|unexpected argument|invalid --hostname|device limit|pending admin approval|suspended/i
    .test(String(output ?? ''));
}

/**
 * Reads `peerlify status` text output, for clients that predate
 * `status --json`. Only the fields the action needs.
 */
export function parseStatusText(text) {
  const field = (label) => {
    const match = new RegExp(`^\\s*${label}:\\s*(.+?)\\s*$`, 'mi').exec(String(text ?? ''));
    return match ? match[1] : '';
  };
  return {
    networkId: field('Network'),
    assignedIp: field('Address'),
    isDataPlaneActive: /^active\b/i.test(field('Data plane')),
    clientId: '',
    selfFqdn: '',
  };
}

/** Whether a status snapshot shows the runner connected with an address. */
export function isConnected(status) {
  return Boolean(status && status.assignedIp && status.isDataPlaneActive);
}
