#!/usr/bin/env node
/**
 * stickyfix bootstrapper CLI — npx stickyfix init / uninstall
 *
 * ONB-01: One-command, cross-platform setup for the native host.
 *
 * Compiled to dist/host/bin/stickyfix.js by tsconfig.host.json, then
 * bundled to dist/host/stickyfix-init.cjs by esbuild (npm run build:host-bin).
 *
 * Node builtins only — no WXT, no Chrome imports.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

import { registerNativeHost, unregisterNativeHost } from '../host/src/bootstrap/register.js';

// ---------------------------------------------------------------------------
// CLI parsing — positionals for subcommand dispatch
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    'extension-id': { type: 'string' },
  },
  strict: false,
});

const [subcommand] = positionals;

// ---------------------------------------------------------------------------
// Config path
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), '.config', 'stickyfix');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

// ---------------------------------------------------------------------------
// init subcommand
// ---------------------------------------------------------------------------

if (subcommand === 'init') {
  const rawRoot = values['root'];
  const rawExtId = values['extension-id'];

  if (!rawRoot || typeof rawRoot !== 'string') {
    console.error('stickyfix init: --root is required');
    console.error('Usage: npx stickyfix init --root <project-dir> --extension-id <id>');
    process.exit(1);
  }

  if (!rawExtId || typeof rawExtId !== 'string') {
    console.error('stickyfix init: --extension-id is required');
    console.error('Copy the extension ID from chrome://extensions (Developer mode).');
    console.error('Usage: npx stickyfix init --root <project-dir> --extension-id <id>');
    process.exit(1);
  }

  const extensionId: string = rawExtId;
  const root = resolve(rawRoot);
  const name = basename(root);
  const notesDir = join(root, 'notes');

  // Write config file — read by native host at startup
  mkdirSync(CONFIG_DIR, { recursive: true });
  const config = { root, name, notesDir };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });

  // Absolute path to the native host bundle — must be absolute (Pitfall 4)
  // The native host bundle is produced by esbuild alongside this file.
  const hostBinPath = resolve(join(__dirname, 'stickyfix-native.cjs'));

  try {
    registerNativeHost({ extensionId, hostBinPath });
  } catch (err) {
    console.error('stickyfix init: failed to register native host:', String(err));
    process.exit(1);
  }

  console.log('stickyfix: native host registered successfully.');
  console.log('  root:     ' + root);
  console.log('  name:     ' + name);
  console.log('  notesDir: ' + notesDir);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Load the extension from .output/chrome-mv3 in chrome://extensions');
  console.log('  2. Start the HTTP host: npm run host -- --root ' + root);
  console.log('  3. Open the extension popup and click "Pair with host"');
  console.log('');
  console.log('To keep the host up-to-date:');
  console.log('  npx --yes stickyfix@latest init --root ' + root + ' --extension-id ' + extensionId);

// ---------------------------------------------------------------------------
// uninstall subcommand
// ---------------------------------------------------------------------------

} else if (subcommand === 'uninstall') {
  try {
    unregisterNativeHost({});
  } catch (err) {
    console.error('stickyfix uninstall: error removing native-host manifest:', String(err));
    // Continue to remove config file even if manifest removal failed
  }

  rmSync(CONFIG_PATH, { force: true });

  console.log('stickyfix: native host unregistered.');
  console.log('  manifest removed');
  console.log('  config removed');

// ---------------------------------------------------------------------------
// unknown subcommand
// ---------------------------------------------------------------------------

} else {
  console.error('Usage: npx stickyfix <init|uninstall> [--root <dir>] [--extension-id <id>]');
  console.error('');
  console.error('  init        Register the native host and write config');
  console.error('  uninstall   Remove the native host manifest and config');
  process.exit(1);
}
