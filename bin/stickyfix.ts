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

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { registerNativeHost, unregisterNativeHost, createLauncherFiles } from '../host/src/bootstrap/register.js';
import { STABLE_EXTENSION_ID, MANIFEST_PUBLIC_KEY } from '../host/src/extension-id.js';

// ---------------------------------------------------------------------------
// CLI parsing — positionals for subcommand dispatch
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    'extension-id': { type: 'string' },
    port: { type: 'string' },
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
  const rawPort = values['port'];

  if (!rawRoot || typeof rawRoot !== 'string') {
    console.error('stickyfix init: --root is required');
    console.error('Usage: npx stickyfix init --root <project-dir> [--extension-id <id>] [--port <port>]');
    process.exit(1);
  }

  // Default to the stable derived extension ID when --extension-id is not supplied.
  // The manifest key field in wxt.config.ts pins this ID deterministically.
  // Pass --extension-id only when overriding (e.g. after CWS publish with a new key).
  const extensionId: string =
    rawExtId && typeof rawExtId === 'string' ? rawExtId : STABLE_EXTENSION_ID;

  const port: number | undefined = rawPort ? parseInt(rawPort as string, 10) : undefined;

  const root = resolve(rawRoot);
  const name = basename(root);
  const notesDir = join(root, 'notes');

  // Write config file — read by native host at startup
  mkdirSync(CONFIG_DIR, { recursive: true });
  const config = { root, name, notesDir };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });

  // Absolute path to the native host bundle — must be absolute (Pitfall 4)
  // The native host bundle is produced by esbuild alongside this file.
  // In esbuild CJS output, __dirname is the directory of the bundle file.
  const hostBinPath = resolve(join(__dirname, 'stickyfix-native.cjs'));

  try {
    registerNativeHost({ extensionId, hostBinPath });
  } catch (err) {
    console.error('stickyfix init: failed to register native host:', String(err));
    process.exit(1);
  }

  // Resolve the HTTP host entry path (node dist/host/src/index.js)
  // __dirname here is dist/host/ (esbuild CJS output directory)
  const hostEntryPath = resolve(join(__dirname, 'src', 'index.js'));

  // Find the launcher icon — resolve relative to the dist/host dir (go up two
  // levels to the project / installed-package root). On Windows a .lnk
  // IconLocation needs a real .ico (a .png renders unreliably as a shortcut
  // icon), so prefer the multi-size stickyfix.ico there; elsewhere the .desktop
  // Icon= takes the 128px PNG.
  const projectRoot = resolve(join(__dirname, '..', '..'));
  const icoCandidates = [
    join(projectRoot, 'public', 'icon', 'stickyfix.ico'),
    join(projectRoot, '.output', 'chrome-mv3', 'icon', 'stickyfix.ico'),
  ];
  const pngCandidates = [
    join(projectRoot, '.output', 'chrome-mv3', 'icon', '128.png'),
    join(projectRoot, 'public', 'icon', '128.png'),
    join(projectRoot, 'assets', 'icon', '128.png'),
  ];
  const iconCandidates =
    process.platform === 'win32' ? [...icoCandidates, ...pngCandidates] : pngCandidates;
  const iconPath = iconCandidates.find((p) => existsSync(p));

  const launcherResult = createLauncherFiles({
    hostEntryPath,
    root,
    port,
    iconPath,
  });

  // Surface any non-fatal launcher warnings
  for (const warn of launcherResult.warnings) {
    console.warn('  [warn] ' + warn);
  }

  // ---------------------------------------------------------------------------
  // Success output
  // ---------------------------------------------------------------------------

  console.log('');
  console.log('stickyfix: native host registered successfully.');
  console.log('');
  console.log('  Extension ID: ' + extensionId);
  console.log('  Root:         ' + root);
  console.log('  Notes dir:    ' + notesDir);
  console.log('');

  if (extensionId === STABLE_EXTENSION_ID) {
    console.log('  Using stable extension ID (derived from the committed public key).');
    console.log('  The manifest key in wxt.config.ts pins this ID across machines.');
  } else {
    console.log('  Using custom extension ID (override via --extension-id).');
  }

  console.log('');
  console.log('--- Next steps (no terminal required after these) ---');
  console.log('');
  console.log('  1. Load the extension (unpacked):');
  console.log('       chrome://extensions  →  Developer mode ON  →  Load unpacked');
  console.log('       Folder: ' + resolve(join(projectRoot, '.output', 'chrome-mv3')));
  console.log('');
  console.log('  2. Start the backend — double-click the desktop launcher:');

  if (process.platform === 'win32') {
    const lnkPath = join(homedir(), 'Desktop', 'Stickyfix Host.lnk');
    const batchPath = launcherResult.written.find((p) => p.endsWith('.bat')) ?? '';
    if (existsSync(lnkPath)) {
      console.log('       Desktop shortcut: "Stickyfix Host" (icon on your Desktop)');
    } else if (batchPath) {
      console.log('       Batch file: ' + batchPath);
      console.log('       (Desktop shortcut creation is in progress or was skipped — use the batch file above)');
    }
  } else if (process.platform === 'darwin') {
    const commandPath = launcherResult.written[0] ?? '';
    console.log('       ' + commandPath);
    console.log('       (Double-click in Finder, or drag to the Dock for quick access)');
  } else {
    const shPath = launcherResult.written.find((p) => p.endsWith('.sh')) ?? '';
    console.log('       ' + shPath);
    console.log('       (Or use the .desktop shortcut in your Applications menu)');
  }

  console.log('');
  console.log('  3. Open the extension popup and click "Pair with host".');
  console.log('     The token is delivered automatically — no copy-paste needed.');
  console.log('');
  console.log('  Extension ID: ' + extensionId);
  console.log('');
  console.log('To keep the host up-to-date:');
  console.log('  npx --yes stickyfix@latest init --root ' + root);

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
  console.log('  launcher files removed');
  console.log('  config removed');

// ---------------------------------------------------------------------------
// unknown subcommand
// ---------------------------------------------------------------------------

} else {
  console.error('Usage: npx stickyfix <init|uninstall> [--root <dir>] [--extension-id <id>] [--port <port>]');
  console.error('');
  console.error('  init        Register the native host and write config');
  console.error('  uninstall   Remove the native host manifest, launchers, and config');
  process.exit(1);
}
