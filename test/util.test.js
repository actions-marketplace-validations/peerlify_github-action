import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isConnected,
  isPermanentLoginFailure,
  isValidHostname,
  normalizeTags,
  parseChecksum,
  parseDuration,
  parseStatusText,
  parseVersion,
  splitList,
  windowsArch,
  windowsPackage,
} from '../src/lib/util.js';

describe('parseDuration', () => {
  it('reads seconds, minutes, hours and milliseconds', () => {
    assert.equal(parseDuration('90s'), 90_000);
    assert.equal(parseDuration('3m'), 180_000);
    assert.equal(parseDuration('1h'), 3_600_000);
    assert.equal(parseDuration('500ms'), 500);
  });

  it('treats a bare number as seconds', () => {
    assert.equal(parseDuration('45'), 45_000);
  });

  it('refuses anything else', () => {
    assert.throws(() => parseDuration('soon'), /Invalid duration/);
    assert.throws(() => parseDuration('-5s'), /Invalid duration/);
    assert.throws(() => parseDuration(''), /Invalid duration/);
  });
});

describe('splitList', () => {
  it('splits on commas and newlines and drops blanks', () => {
    assert.deepEqual(splitList(' db, cache ,\n100.64.0.7,,'), ['db', 'cache', '100.64.0.7']);
    assert.deepEqual(splitList(''), []);
  });
});

describe('normalizeTags', () => {
  it('drops the tag: prefix the network does not store', () => {
    assert.deepEqual(normalizeTags('tag:ci, prod'), ['ci', 'prod']);
  });

  it('drops case-insensitive duplicates, keeping the first spelling', () => {
    assert.deepEqual(normalizeTags('CI, tag:ci, ci'), ['CI']);
  });

  it('ignores empty entries and a bare prefix', () => {
    assert.deepEqual(normalizeTags(' , tag: ,'), []);
  });
});

describe('isValidHostname', () => {
  it('accepts a DNS label up to 63 characters', () => {
    assert.ok(isValidHostname('github-runner-7'));
    assert.ok(isValidHostname('a'));
    assert.ok(isValidHostname('a'.repeat(63)));
  });

  it('refuses what cannot be a DNS label', () => {
    for (const bad of ['', '-runner', 'runner-', 'build runner', 'runner.example.com', 'runner_1', 'a'.repeat(64)]) {
      assert.equal(isValidHostname(bad), false, bad);
    }
  });
});

describe('parseVersion', () => {
  it('defaults to stable', () => {
    assert.equal(parseVersion(''), 'stable');
    assert.equal(parseVersion('STABLE'), 'stable');
  });

  it('accepts exact versions', () => {
    assert.equal(parseVersion('2.6.0'), '2.6.0');
    assert.equal(parseVersion('2.6.0.123'), '2.6.0.123');
  });

  it('refuses channels and ranges it cannot install', () => {
    assert.throws(() => parseVersion('latest'), /Invalid version/);
    assert.throws(() => parseVersion('2.6'), /Invalid version/);
    assert.throws(() => parseVersion('^2.6.0'), /Invalid version/);
  });
});

describe('windows packages', () => {
  it('maps Node architectures to package architectures', () => {
    assert.equal(windowsArch('x64'), 'x64');
    assert.equal(windowsArch('arm64'), 'arm64');
    assert.equal(windowsArch('ia32'), 'x86');
    assert.throws(() => windowsArch('mips'), /Unsupported/);
  });

  it('builds the stable and pinned package URLs', () => {
    assert.deepEqual(windowsPackage('https://pkgs.example/', 'stable', '2.6.0', 'x64'), {
      url: 'https://pkgs.example/client/stable/windows/x64/Peerlify_2.6.0_x64.msi',
      checksumUrl: 'https://pkgs.example/client/stable/windows/x64/Peerlify_2.6.0_x64.msi.sha256',
      file: 'Peerlify_2.6.0_x64.msi',
    });
    assert.equal(
      windowsPackage('https://pkgs.example', '2.5.1', '2.5.1', 'arm64').url,
      'https://pkgs.example/client/2.5.1/windows/arm64/Peerlify_2.5.1_arm64.msi',
    );
  });
});

describe('parseChecksum', () => {
  const digest = 'A'.repeat(64);

  it('reads a bare digest or one followed by a file name', () => {
    assert.equal(parseChecksum(`${digest}\n`), 'a'.repeat(64));
    assert.equal(parseChecksum(`${digest}  Peerlify_2.6.0_x64.msi`), 'a'.repeat(64));
  });

  it('refuses anything that is not a SHA-256 digest', () => {
    assert.throws(() => parseChecksum('<html>not found</html>'), /not a SHA-256/);
    assert.throws(() => parseChecksum(''), /not a SHA-256/);
  });
});

describe('isPermanentLoginFailure', () => {
  it('stops retrying when the key itself is refused', () => {
    for (const message of [
      'Auth key not recognized.',
      'Auth key has been revoked.',
      'Auth key has expired.',
      'Auth key has no remaining uses.',
      "Unexpected argument '--hostname=ci' for 'login'.",
      'This network has reached its plan\'s device limit. Remove a device or upgrade the plan, then sign in again.',
    ]) {
      assert.ok(isPermanentLoginFailure(message), message);
    }
  });

  it('keeps retrying while the daemon is still starting', () => {
    assert.equal(isPermanentLoginFailure('login failed: Daemon must register with the control plane before login.'), false);
    assert.equal(isPermanentLoginFailure('Could not reach the Peerlify daemon.'), false);
  });
});

describe('parseStatusText', () => {
  it('reads the address, network and data plane from the text view', () => {
    const text = [
      'Daemon:       running',
      'Signed in:    no (peerlify login)',
      'Network:      n3tw0rk1d',
      'Address:      100.64.0.9',
      'Data plane:   active',
    ].join('\n');
    assert.deepEqual(parseStatusText(text), {
      networkId: 'n3tw0rk1d',
      assignedIp: '100.64.0.9',
      isDataPlaneActive: true,
      clientId: '',
      selfFqdn: '',
    });
  });

  it('has no address before one is assigned', () => {
    const status = parseStatusText('Daemon:       running\nData plane:   inactive\n');
    assert.equal(status.assignedIp, '');
    assert.equal(status.isDataPlaneActive, false);
  });
});

describe('isConnected', () => {
  it('needs both an address and an active data plane', () => {
    assert.equal(isConnected({ assignedIp: '100.64.0.9', isDataPlaneActive: true }), true);
    assert.equal(isConnected({ assignedIp: '', isDataPlaneActive: true }), false);
    assert.equal(isConnected({ assignedIp: '100.64.0.9', isDataPlaneActive: false }), false);
    assert.equal(isConnected(null), false);
  });
});
