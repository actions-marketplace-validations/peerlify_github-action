// The small slice of the GitHub Actions runner protocol this action needs,
// written against the documented environment files and workflow commands so
// the action has no dependencies to vendor.
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { delimiter } from 'node:path';

export function getInput(name) {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  return (process.env[key] ?? '').trim();
}

function escapeData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function command(name, message) {
  process.stdout.write(`::${name}::${escapeData(message)}${EOL}`);
}

function appendToFile(envVar, key, value) {
  const file = process.env[envVar];
  if (!file) {
    throw new Error(`${envVar} is not set; this must run inside GitHub Actions.`);
  }
  const marker = `ghadelimiter_${randomUUID()}`;
  appendFileSync(file, `${key}<<${marker}${EOL}${value}${EOL}${marker}${EOL}`);
}

export function setOutput(name, value) {
  appendToFile('GITHUB_OUTPUT', name, value ?? '');
}

export function saveState(name, value) {
  appendToFile('GITHUB_STATE', name, value ?? '');
}

export function getState(name) {
  return process.env[`STATE_${name}`] ?? '';
}

export function addPath(dir) {
  if (process.env.GITHUB_PATH) {
    appendFileSync(process.env.GITHUB_PATH, `${dir}${EOL}`);
  }
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`;
}

export function setSecret(value) {
  if (value) {
    command('add-mask', value);
  }
}

export const info = (message) => process.stdout.write(`${message}${EOL}`);
export const warning = (message) => command('warning', message);
export const error = (message) => command('error', message);

export async function group(title, fn) {
  process.stdout.write(`::group::${escapeData(title)}${EOL}`);
  try {
    return await fn();
  } finally {
    process.stdout.write(`::endgroup::${EOL}`);
  }
}

export function setFailed(err) {
  error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
