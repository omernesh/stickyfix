/**
 * Native-messaging manifest writer, per-OS path resolver, Windows registry
 * registration, and uninstall enumerator for stickyfix.
 *
 * Node builtins only — no WXT, no Chrome imports.
 *
 * Security:
 * - T-09-02: buildManifest resolves an ABSOLUTE path (Pitfall 4)
 * - T-09-03: Windows registry writes use HKCU (Pitfall 5), execFileSync (never exec)
 * - T-09-05: enumerateArtifacts lists every init-created artifact (ONB-05)
 *
 * Analog: host/src/config.ts (mkdirSync/writeFileSync/existsSync/rmSync patterns)
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isInsideDir } from '../security.js';

// The native host name — must match the manifest JSON `name` field and the
// value passed to chrome.runtime.sendNativeMessage in background.ts.
const NATIVE_HOST_NAME = 'com.stickyfix.host';
const MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`;

// Chrome/Edge registry key prefixes (Windows HKCU — Pitfall 5: never HKLM)
const REG_CHROME_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
const REG_EDGE_KEY = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

// Config file location (read by native host at startup)
const CONFIG_DIR = (home: string) => join(home, '.config', 'stickyfix');
const CONFIG_PATH = (home: string) => join(CONFIG_DIR(home), 'config.json');

// ---------------------------------------------------------------------------
// nativeManifestPath — per-OS path resolver
// ---------------------------------------------------------------------------

/**
 * Return the absolute path where the native-messaging manifest JSON should
 * be written for the given platform and home directory.
 *
 * Paths verified via Chrome + Edge native-messaging docs (RESEARCH Pattern 4):
 *   darwin: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
 *   linux:  ~/.config/google-chrome/NativeMessagingHosts/
 *   win32:  ~/.local/share/stickyfix/  (manifest only; registry key written separately)
 */
export function nativeManifestPath(
  plat: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  switch (plat) {
    case 'darwin':
      return join(
        home,
        'Library',
        'Application Support',
        'Google',
        'Chrome',
        'NativeMessagingHosts',
        MANIFEST_FILENAME,
      );
    case 'linux':
      return join(home, '.config', 'google-chrome', 'NativeMessagingHosts', MANIFEST_FILENAME);
    case 'win32':
      return join(home, '.local', 'share', 'stickyfix', MANIFEST_FILENAME);
    default:
      throw new Error(`Unsupported platform: ${plat}`);
  }
}

// ---------------------------------------------------------------------------
// buildManifest — manifest object builder
// ---------------------------------------------------------------------------

/** Regex: exactly 32 lowercase a-p characters (Chrome extension ID alphabet) */
const EXT_ID_RE = /^[a-p]{32}$/;

/**
 * Build a Chrome native-messaging manifest object for the given extension ID
 * and host binary path.
 *
 * - hostBinPath is resolved to an ABSOLUTE path (Pitfall 4).
 * - extensionId must be exactly 32 lowercase a-p chars; throws otherwise.
 * - allowed_origins contains exactly one entry: `chrome-extension://<id>/`.
 */
export function buildManifest(extensionId: string, hostBinPath: string): object {
  if (!EXT_ID_RE.test(extensionId)) {
    throw new Error(
      `Invalid extension ID "${extensionId}": must be exactly 32 lowercase a-p characters.`
    );
  }

  const absPath = resolve(hostBinPath);

  return {
    name: NATIVE_HOST_NAME,
    description: 'stickyfix native messaging host',
    path: absPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

// ---------------------------------------------------------------------------
// writeManifest — write manifest JSON to disk
// ---------------------------------------------------------------------------

/**
 * Write the manifest object to `manifestPath`, creating parent directories
 * if needed. Mode 0o644 (non-credential — readable by Chrome process).
 *
 * Analog: ensureNotesDir (mkdirSync recursive) + writeTokenFile pattern.
 */
export function writeManifest(manifest: object, manifestPath: string): void {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), {
    encoding: 'utf8',
    mode: 0o644,
  });
}

// ---------------------------------------------------------------------------
// registerNativeHost — write manifest + optional registry keys
// ---------------------------------------------------------------------------

interface RegisterOptions {
  extensionId: string;
  hostBinPath: string;
  plat?: NodeJS.Platform;
  home?: string;
}

/**
 * Write the native-messaging manifest and, on Windows, register it in both
 * the Chrome and Edge HKCU registry keys.
 *
 * execFileSync is used (NEVER exec, NEVER shell) — T-09-03.
 */
export function registerNativeHost(opts: RegisterOptions): void {
  const plat = opts.plat ?? process.platform;
  const home = opts.home ?? homedir();

  const manifestPath = nativeManifestPath(plat, home);
  const manifest = buildManifest(opts.extensionId, opts.hostBinPath);
  writeManifest(manifest, manifestPath);

  if (plat === 'win32') {
    // Register for Chrome (HKCU — Pitfall 5, never HKLM)
    execFileSync('reg', ['ADD', REG_CHROME_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
    // Register for Edge (drop-in, D-05)
    execFileSync('reg', ['ADD', REG_EDGE_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
  }
}

// ---------------------------------------------------------------------------
// unregisterNativeHost — remove manifest + optional registry keys
// ---------------------------------------------------------------------------

interface UnregisterOptions {
  plat?: NodeJS.Platform;
  home?: string;
  /** Override the manifest path (used by tests to avoid touching real OS paths) */
  manifestPath?: string;
}

/**
 * Remove the native-messaging manifest and, on Windows, delete the Chrome
 * and Edge HKCU registry keys.
 *
 * Idempotent: does not throw if the manifest is already absent.
 * execFileSync is used (NEVER exec) with the /f flag to tolerate absent keys.
 */
export function unregisterNativeHost(opts: UnregisterOptions = {}): void {
  const plat = opts.plat ?? process.platform;
  const home = opts.home ?? homedir();
  const manifestPath = opts.manifestPath ?? nativeManifestPath(plat, home);

  rmSync(manifestPath, { force: true });

  if (plat === 'win32') {
    // /f flag suppresses "are you sure?" prompt; tolerates absent key (non-zero exit ignored)
    try {
      execFileSync('reg', ['DELETE', REG_CHROME_KEY, '/f']);
    } catch {
      // Key may not exist — ignore
    }
    try {
      execFileSync('reg', ['DELETE', REG_EDGE_KEY, '/f']);
    } catch {
      // Key may not exist — ignore
    }
  }
}

// ---------------------------------------------------------------------------
// enumerateArtifacts — complete list of paths/keys created by init (ONB-05)
// ---------------------------------------------------------------------------

interface ArtifactOptions {
  plat?: NodeJS.Platform;
  home?: string;
  root?: string;
}

interface ArtifactList {
  paths: string[];
  registryKeys: string[];
}

/**
 * Return the complete list of filesystem paths and registry keys that
 * `registerNativeHost` creates, so `uninstall` can remove everything
 * and leave no orphaned artifacts (ONB-05 / T-09-05).
 *
 * paths includes:
 *   - native-messaging manifest JSON
 *   - stickyfix config file (~/.config/stickyfix/config.json)
 *   - <root>/.stickyfix-port (written by HTTP host on startup)
 *
 * registryKeys (win32 only):
 *   - HKCU Chrome NativeMessagingHosts key
 *   - HKCU Edge NativeMessagingHosts key
 */
export function enumerateArtifacts(opts: ArtifactOptions = {}): ArtifactList {
  const plat = opts.plat ?? process.platform;
  const home = opts.home ?? homedir();
  const root = opts.root;

  const paths: string[] = [
    nativeManifestPath(plat, home),
    CONFIG_PATH(home),
  ];

  // .stickyfix-port is written by the HTTP host alongside .stickyfix-token
  if (root) {
    paths.push(join(root, '.stickyfix-port'));
  } else {
    // Include a generic indicator when root is unknown
    paths.push('.stickyfix-port');
  }

  const registryKeys: string[] = plat === 'win32' ? [REG_CHROME_KEY, REG_EDGE_KEY] : [];

  return { paths, registryKeys };
}

// Re-export isInsideDir for consumers that need path validation
export { isInsideDir };
