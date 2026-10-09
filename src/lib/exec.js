import { spawn } from 'node:child_process';

/**
 * Runs a program and resolves with its exit code and captured output; never
 * rejects on a non-zero exit, so callers decide what a failure means.
 *
 * `quiet` keeps the output out of the job log (it is still captured). Use it
 * for polling, and for anything whose arguments must not be echoed.
 */
export function run(file, args = [], { env, quiet = false, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });

    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => child.kill(), timeoutMs);
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr });
    });
  });
}
