// npm run dev:stripe (PAY-01, local development only)
//
// Runs the backend in watch mode (`npm run start:dev`) and the Stripe CLI
// webhook forwarder (`stripe listen`) side by side in one terminal, so local
// test payments reach POST /api/payments/webhook and confirm bookings.
//
// Only Node built-ins are used. Nothing is installed by this script.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const isWindows = process.platform === 'win32';
const backendDir = fileURLToPath(new URL('..', import.meta.url));

// The same port the backend listens on (main.ts): PORT from the environment,
// then PORT from backend/.env, then the project default 4000.
function readPort() {
  if (process.env.PORT) return process.env.PORT;
  const envFile = new URL('../.env', import.meta.url);
  if (existsSync(envFile)) {
    const fromFile = parseEnv(readFileSync(envFile, 'utf8')).PORT;
    if (fromFile) return fromFile;
  }
  return '4000';
}

// Commands run through a shell so `npm` (npm.cmd) and `stripe` resolve the
// same way they do when typed in a terminal, on Windows, macOS and Linux.
function runOnce(command) {
  return spawnSync(command, { cwd: backendDir, shell: true, encoding: 'utf8' });
}

function fail(lines) {
  for (const line of lines) console.error(`[dev:stripe] ${line}`);
  process.exit(1);
}

// a. The Stripe CLI must already be installed.
const version = runOnce('stripe --version');
if (version.error || version.status !== 0) {
  fail([
    'The Stripe CLI was not found on your PATH.',
    'Install it with: winget install Stripe.StripeCLI',
    '  (or with Scoop: scoop install stripe)',
    'Then run once: stripe login',
    'Not testing payments? Use: npm run start:dev',
  ]);
}

// b. Read the webhook signing secret of this machine's listener. It is the
// same secret `stripe listen` signs with, so the backend always matches it.
const printed = runOnce('stripe listen --print-secret');
const webhookSecret = (printed.stdout ?? '').trim();
if (printed.status !== 0 || !webhookSecret.startsWith('whsec_')) {
  fail([
    'Could not get the webhook secret from the Stripe CLI.',
    'Run once: stripe login',
  ]);
}
// Never print a full secret: show only its last 4 characters.
function maskSecrets(text) {
  return text.replace(/whsec_\w+/g, (secret) => `whsec_…${secret.slice(-4)}`);
}

console.log(
  `[dev:stripe] webhook secret loaded (${maskSecrets(webhookSecret)})`,
);

// c. Start both processes and prefix every output line with its name.
// `stripe listen` prints the secret when it is ready, so lines are masked.
const port = readPort();
const children = [];
let stopping = false;

function prefixLines(stream, prefix, target) {
  createInterface({ input: stream }).on('line', (line) => {
    target.write(`${prefix} ${maskSecrets(line)}\n`);
  });
}

function start(prefix, command, env) {
  const child = spawn(command, {
    cwd: backendDir,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // On macOS/Linux each child gets its own process group, so stopping it
    // also stops everything it started (npm -> nest -> node).
    detached: !isWindows,
  });
  prefixLines(child.stdout, prefix, process.stdout);
  prefixLines(child.stderr, prefix, process.stderr);
  child.on('error', (error) => {
    console.error(`${prefix} could not start: ${error.message}`);
    stopAll(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${prefix} exited (code ${code ?? 'none'}), stopping both`);
      stopAll(code || 1);
    }
  });
  children.push(child);
}

// d. Stop a child and every process it started (no orphans).
function stopTree(child) {
  if (child.pid === undefined) return;
  if (isWindows) {
    if (child.exitCode !== null) return;
    spawnSync(`taskkill /pid ${child.pid} /T /F`, {
      shell: true,
      stdio: 'ignore',
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // The process group has already exited.
    }
  }
}

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) stopTree(child);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => stopAll(0));
}

// The Stripe CLI requires the events to forward. These are the ones the
// webhook handles (stripe-api.gateway.ts); every other event is ignored there.
const webhookEvents = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'refund.updated',
  'refund.failed',
].join(',');

start(
  '[stripe]',
  `stripe listen --events ${webhookEvents} --forward-to localhost:${port}/api/payments/webhook`,
  process.env,
);
start('[api]', 'npm run start:dev', {
  ...process.env,
  STRIPE_WEBHOOK_SECRET: webhookSecret,
});
