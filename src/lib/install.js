import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPath, info } from './actions.js';
import { run } from './exec.js';
import { download, fetchText } from './http.js';
import { parseChecksum, trimSlash, windowsArch, windowsPackage } from './util.js';

/**
 * Installs the Peerlify client and returns the command to run the CLI with.
 * The daemon is started by the installer on both platforms.
 */
export async function installClient({ platform, version, pkgsUrl }) {
  const workDir = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'peerlify-'));
  if (platform === 'linux') {
    return installLinux({ version, pkgsUrl, workDir });
  }
  if (platform === 'win32') {
    return installWindows({ version, pkgsUrl, workDir });
  }
  throw new Error(
    `Peerlify runners are supported on Linux and Windows; this runner is '${platform}'. ` +
      "On macOS the client's background service has to be approved by an administrator, which a hosted runner cannot do.",
  );
}

async function installLinux({ version, pkgsUrl, workDir }) {
  // The official installer: picks apt/dnf/zypper (or the tarball) for the
  // distro and elevates with sudo, which GitHub-hosted runners allow without
  // a password.
  const script = join(workDir, 'install.sh');
  await download(`${trimSlash(pkgsUrl)}/install.sh`, script);
  const result = await run('sh', [script], { env: { VERSION: version, PKGS_URL: trimSlash(pkgsUrl) } });
  if (result.code !== 0) {
    throw new Error(`The Peerlify installer failed with exit code ${result.code}.`);
  }

  // Keep the client this run asked for: the package's daily update timer
  // could otherwise upgrade and restart the daemon mid-job.
  const timer = await run('sudo', ['-n', 'systemctl', 'disable', '--now', 'peerlify-update.timer'], { quiet: true });
  if (timer.code !== 0) {
    info('Could not disable the Peerlify update timer; continuing.');
  }

  return 'peerlify';
}

async function installWindows({ version, pkgsUrl, workDir }) {
  const arch = windowsArch(process.arch);
  const exactVersion =
    version === 'stable'
      ? (await fetchText(`${trimSlash(pkgsUrl)}/client/stable/windows/${arch}/LATEST`)).trim()
      : version;
  if (!exactVersion) {
    throw new Error('Could not resolve the latest stable Peerlify version.');
  }

  const pkg = windowsPackage(pkgsUrl, version === 'stable' ? 'stable' : exactVersion, exactVersion, arch);
  info(`Downloading ${pkg.url}`);
  const msiPath = join(workDir, pkg.file);
  const actual = await download(pkg.url, msiPath);
  const expected = parseChecksum(await fetchText(pkg.checksumUrl));
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${pkg.file}: expected ${expected}, got ${actual}.`);
  }

  const logPath = join(workDir, 'msiexec.log');
  const result = await run('msiexec', ['/i', msiPath, '/qn', '/norestart', '/l*v', logPath]);
  // 3010: success, a reboot is required to finish — the service runs regardless.
  if (result.code !== 0 && result.code !== 3010) {
    const log = await readMsiLogTail(logPath, 30);
    throw new Error(`msiexec failed with exit code ${result.code}.${log ? `\nLast lines of the install log:\n${log}` : ''}`);
  }

  // Same reason as the Linux timer: no self-update during the job.
  for (const task of ['Peerlify\\PeerlifyAutoUpdate', 'Peerlify\\PeerlifyUpdateOnBoot']) {
    await run('schtasks', ['/Change', '/TN', task, '/DISABLE'], { quiet: true });
  }

  const candidates = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean)
    .map((dir) => join(dir, 'Peerlify'));
  const installDir = candidates.find((dir) => existsSync(join(dir, 'peerlify.exe')));
  if (!installDir) {
    throw new Error(`Installed Peerlify, but peerlify.exe was not found in ${candidates.join(' or ')}.`);
  }
  // The MSI adds this to the system PATH, which the running job doesn't see.
  addPath(installDir);
  if (version === 'stable') {
    info(`Installed Peerlify ${exactVersion}.`);
  }
  return join(installDir, 'peerlify.exe');
}

/** msiexec writes its log as UTF-16 (with a BOM) or in the ANSI code page. */
async function readMsiLogTail(path, lines) {
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return '';
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le') : bytes.toString('latin1');
  return text.split(/\r?\n/).slice(-lines).join('\n');
}
