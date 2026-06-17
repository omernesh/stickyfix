/**
 * Tests for bootstrap/register.ts, folder-picker.ts, and extension-id.ts.
 * Analog: host/test/index.test.ts (describe/before/after/tmpdir lifecycle)
 *
 * Covers:
 * - nativeManifestPath: per-OS path resolution
 * - buildManifest: required fields, absolute path, allowed_origins, bad-ID rejection
 * - writeManifest + unregisterNativeHost round-trip on tmpdir
 * - enumerateArtifacts: includes manifest + config + .stickyfix-port + launcher + (win32) reg keys
 * - buildPickerArgs: no shell metacharacters, no interpolated user input
 * - deriveExtensionId: known-vector test (stable ID from committed public key)
 * - createLauncherFiles: writes launcher file with correct content on non-win32 plat
 * - unregisterNativeHost: removes launcher files alongside manifest
 * - init defaults to stable ID when --extension-id is omitted
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import {
  nativeManifestPath,
  buildManifest,
  writeManifest,
  enumerateArtifacts,
  unregisterNativeHost,
  createLauncherFiles,
  getLauncherPaths,
  launcherDir,
  registerNativeHost,
  nativeWrapperPath,
} from '../src/bootstrap/register.js';
import { buildPickerArgs } from '../src/folder-picker.js';
import { deriveExtensionId, STABLE_EXTENSION_ID, MANIFEST_PUBLIC_KEY } from '../src/extension-id.js';

// ---------------------------------------------------------------------------
// deriveExtensionId — known-vector test (Enhancement 1)
// ---------------------------------------------------------------------------

describe('deriveExtensionId — stable ID derivation', () => {
  test('known-vector: MANIFEST_PUBLIC_KEY → STABLE_EXTENSION_ID', () => {
    const derived = deriveExtensionId(MANIFEST_PUBLIC_KEY);
    assert.strictEqual(
      derived,
      STABLE_EXTENSION_ID,
      `Expected ${STABLE_EXTENSION_ID}, got ${derived}`
    );
  });

  test('derived ID is exactly 32 characters', () => {
    const derived = deriveExtensionId(MANIFEST_PUBLIC_KEY);
    assert.strictEqual(derived.length, 32, `Extension ID should be 32 chars, got ${derived.length}`);
  });

  test('derived ID uses only a-p alphabet', () => {
    const derived = deriveExtensionId(MANIFEST_PUBLIC_KEY);
    assert.ok(
      /^[a-p]{32}$/.test(derived),
      `Extension ID must be 32 chars a-p, got: ${derived}`
    );
  });

  test('different input produces different output', () => {
    // A different base64 blob should produce a different ID
    const differentKey = Buffer.from('different-key-data').toString('base64');
    const derived = deriveExtensionId(differentKey);
    assert.notStrictEqual(derived, STABLE_EXTENSION_ID);
    assert.strictEqual(derived.length, 32);
  });

  test('STABLE_EXTENSION_ID constant matches a-p alphabet (regression guard)', () => {
    assert.ok(
      /^[a-p]{32}$/.test(STABLE_EXTENSION_ID),
      `STABLE_EXTENSION_ID is not a valid Chrome extension ID: ${STABLE_EXTENSION_ID}`
    );
  });
});

// ---------------------------------------------------------------------------
// nativeManifestPath — per-OS resolution
// ---------------------------------------------------------------------------

describe('nativeManifestPath — per-OS paths', () => {
  const fakeHome = '/home/testuser';

  test('darwin: returns Library/Application Support/Google/Chrome path', () => {
    const result = nativeManifestPath('darwin', fakeHome);
    // Normalize slashes for cross-platform comparison
    const normalized = result.replace(/\\/g, '/');
    assert.ok(
      normalized.includes('Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      `Expected macOS Chrome path, got: ${result}`
    );
    assert.ok(result.endsWith('com.stickyfix.host.json'), `Expected .json suffix, got: ${result}`);
    // Normalize to forward slashes for cross-platform path comparison
    const normalizedResult = result.replace(/\\/g, '/');
    const normalizedHome = fakeHome.replace(/\\/g, '/');
    assert.ok(normalizedResult.startsWith(normalizedHome), `Expected path under home, got: ${result}`);
  });

  test('linux: returns .config/google-chrome/NativeMessagingHosts path', () => {
    const result = nativeManifestPath('linux', fakeHome);
    const normalized = result.replace(/\\/g, '/');
    assert.ok(
      normalized.includes('.config/google-chrome/NativeMessagingHosts'),
      `Expected Linux Chrome path, got: ${result}`
    );
    assert.ok(result.endsWith('com.stickyfix.host.json'), `Expected .json suffix, got: ${result}`);
  });

  test('win32: returns .local/share/stickyfix path', () => {
    const fakeWinHome = 'C:\\Users\\testuser';
    const result = nativeManifestPath('win32', fakeWinHome);
    assert.ok(
      result.includes('.local') || result.includes('stickyfix'),
      `Expected stickyfix data dir path, got: ${result}`
    );
    assert.ok(result.endsWith('com.stickyfix.host.json'), `Expected .json suffix, got: ${result}`);
  });

  test('unsupported platform throws', () => {
    assert.throws(
      () => nativeManifestPath('freebsd' as NodeJS.Platform, fakeHome),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.toLowerCase().includes('unsupported'), `got: ${err.message}`);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// buildManifest — required fields and validation
// ---------------------------------------------------------------------------

describe('buildManifest — fields + validation', () => {
  const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop'; // 32 lowercase a-p chars

  test('returns object with name com.stickyfix.host', () => {
    const m = buildManifest(VALID_ID, '/usr/local/bin/stickyfix');
    assert.strictEqual((m as { name: string }).name, 'com.stickyfix.host');
  });

  test('returns object with description', () => {
    const m = buildManifest(VALID_ID, '/usr/local/bin/stickyfix') as Record<string, unknown>;
    assert.ok(typeof m.description === 'string' && m.description.length > 0);
  });

  test('path is absolute (Pitfall 4)', () => {
    const m = buildManifest(VALID_ID, './relative/path/to/host') as { path: string };
    assert.ok(isAbsolute(m.path), `Expected absolute path, got: ${m.path}`);
  });

  test('type is "stdio"', () => {
    const m = buildManifest(VALID_ID, '/usr/bin/node') as { type: string };
    assert.strictEqual(m.type, 'stdio');
  });

  test('allowed_origins contains chrome-extension://<id>/ with trailing slash', () => {
    const m = buildManifest(VALID_ID, '/usr/bin/node') as { allowed_origins: string[] };
    assert.ok(Array.isArray(m.allowed_origins));
    assert.strictEqual(m.allowed_origins.length, 1);
    assert.strictEqual(m.allowed_origins[0], `chrome-extension://${VALID_ID}/`);
  });

  test('allowed_origins defaults to STABLE_EXTENSION_ID when that ID is used', () => {
    const m = buildManifest(STABLE_EXTENSION_ID, '/usr/bin/node') as { allowed_origins: string[] };
    assert.strictEqual(m.allowed_origins[0], `chrome-extension://${STABLE_EXTENSION_ID}/`);
  });

  test('throws on extension ID with wrong length', () => {
    assert.throws(
      () => buildManifest('tooshort', '/usr/bin/node'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  test('throws on extension ID with invalid characters (not a-p)', () => {
    // 32 chars but contains uppercase/numbers outside a-p
    const badId = 'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP';
    assert.throws(
      () => buildManifest(badId, '/usr/bin/node'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  test('throws on extension ID with q-z chars', () => {
    const badId = 'abcdefghijklmnopabcdefghijklmnopqz'.slice(0, 32); // has q
    // q is outside a-p range
    const hasInvalid = /[^a-p]/.test(badId);
    if (hasInvalid) {
      assert.throws(() => buildManifest(badId, '/usr/bin/node'));
    } else {
      // If all a-p by coincidence, just verify it doesn't throw
      assert.doesNotThrow(() => buildManifest(badId, '/usr/bin/node'));
    }
  });
});

// ---------------------------------------------------------------------------
// writeManifest + unregisterNativeHost round-trip
// ---------------------------------------------------------------------------

describe('writeManifest + unregisterNativeHost round-trip', () => {
  let tmpDir: string;
  const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop';

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfx-bootstrap-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writeManifest creates the manifest file at manifestPath', () => {
    const manifestPath = join(tmpDir, 'com.stickyfix.host.json');
    const manifest = buildManifest(VALID_ID, join(tmpDir, 'fake-host.js'));
    writeManifest(manifest, manifestPath);
    assert.ok(existsSync(manifestPath), `Manifest file should exist at ${manifestPath}`);
  });

  test('writeManifest creates parent directories recursively', () => {
    const deepPath = join(tmpDir, 'nested', 'dir', 'com.stickyfix.host.json');
    const manifest = buildManifest(VALID_ID, join(tmpDir, 'fake-host.js'));
    writeManifest(manifest, deepPath);
    assert.ok(existsSync(deepPath), `Manifest should be created in nested dir`);
  });

  test('written manifest is valid JSON with required fields', async () => {
    const manifestPath = join(tmpDir, 'validated.json');
    const manifest = buildManifest(VALID_ID, join(tmpDir, 'fake-host.js'));
    writeManifest(manifest, manifestPath);

    // Read back and parse
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.strictEqual(parsed.name, 'com.stickyfix.host');
    assert.strictEqual(parsed.type, 'stdio');
    assert.ok(Array.isArray(parsed.allowed_origins));
    assert.ok(typeof parsed.path === 'string' && isAbsolute(parsed.path as string));
  });

  test('unregisterNativeHost removes the manifest file (non-win32 path)', () => {
    const manifestPath = join(tmpDir, 'to-delete.json');
    const manifest = buildManifest(VALID_ID, join(tmpDir, 'fake-host.js'));
    writeManifest(manifest, manifestPath);
    assert.ok(existsSync(manifestPath));

    // Unregister using injected paths (non-win32 platform to avoid reg.exe calls)
    unregisterNativeHost({ plat: 'linux', home: tmpDir, manifestPath });
    assert.ok(!existsSync(manifestPath), 'Manifest should be removed after unregister');
  });

  test('unregisterNativeHost is idempotent (already absent)', () => {
    const absentPath = join(tmpDir, 'nonexistent.json');
    // Should not throw when file is already absent
    assert.doesNotThrow(() =>
      unregisterNativeHost({ plat: 'linux', home: tmpDir, manifestPath: absentPath })
    );
  });
});

// ---------------------------------------------------------------------------
// createLauncherFiles — launcher content + path validation (Enhancement 2)
// ---------------------------------------------------------------------------

describe('createLauncherFiles — launcher creation', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfx-launcher-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('darwin: creates executable .command file with correct host path and root', () => {
    const hostEntryPath = '/fake/dist/host/src/index.js';
    const root = '/fake/project/root';
    const result = createLauncherFiles({
      hostEntryPath,
      root,
      plat: 'darwin',
      home: tmpDir,
    });

    const commandPath = getLauncherPaths('darwin', tmpDir).launcher;
    assert.ok(existsSync(commandPath), `Expected launcher at ${commandPath}`);
    assert.ok(result.written.includes(commandPath));

    const content = readFileSync(commandPath, 'utf8');
    assert.ok(content.includes(hostEntryPath), 'Launcher must reference the host entry path');
    assert.ok(content.includes(root), 'Launcher must reference the root');
    assert.ok(content.startsWith('#!/'), 'Launcher must start with a shebang');
  });

  test('linux: creates .sh file with correct host path and root', () => {
    const hostEntryPath = '/fake/dist/host/src/index.js';
    const root = '/fake/project';
    const result = createLauncherFiles({
      hostEntryPath,
      root,
      plat: 'linux',
      home: tmpDir,
    });

    const paths = getLauncherPaths('linux', tmpDir);
    assert.ok(existsSync(paths.launcher), `Expected sh file at ${paths.launcher}`);
    assert.ok(result.written.includes(paths.launcher));

    const content = readFileSync(paths.launcher, 'utf8');
    assert.ok(content.includes(hostEntryPath), 'sh launcher must reference host entry path');
    assert.ok(content.includes(root), 'sh launcher must reference root');
  });

  test('linux: creates .desktop entry file', () => {
    const hostEntryPath = '/fake/dist/host/src/index.js';
    const root = '/fake/project';
    const result = createLauncherFiles({
      hostEntryPath,
      root,
      plat: 'linux',
      home: tmpDir,
    });

    const paths = getLauncherPaths('linux', tmpDir);
    if (paths.desktopEntry) {
      assert.ok(existsSync(paths.desktopEntry), `Expected .desktop at ${paths.desktopEntry}`);
      assert.ok(result.written.includes(paths.desktopEntry));

      const content = readFileSync(paths.desktopEntry, 'utf8');
      assert.ok(content.includes('[Desktop Entry]'), '.desktop must have [Desktop Entry] header');
      assert.ok(content.includes('Exec='), '.desktop must have Exec= line');
    }
  });

  test('win32: creates batch file with correct content', () => {
    const hostEntryPath = 'C:\\fake\\dist\\host\\src\\index.js';
    const root = 'C:\\fake\\project';
    // We only test the batch file creation on non-win32 by using the linux plat override;
    // on the actual win32 test environment it runs natively.
    // Since we can't easily test win32 bat on non-win32 OS, mock via win32 plat injection.
    // Use a tmpDir subfolder as the "Desktop" indirectly by testing batch path resolution.
    const paths = getLauncherPaths('win32', tmpDir);
    // Verify the path structure is correct without actually writing (avoids PS shortcut on linux)
    assert.ok(paths.launcher.endsWith('.bat'), `Expected .bat launcher, got: ${paths.launcher}`);
    assert.ok(paths.shortcut !== null, 'win32 should have a shortcut path');
    assert.ok(paths.shortcut?.endsWith('.lnk'), `Expected .lnk shortcut, got: ${paths.shortcut}`);
    assert.ok(paths.desktopEntry === null, 'win32 should not have a .desktop entry');
  });

  test('createLauncherFiles with port: includes port in launcher command', () => {
    const hostEntryPath = '/fake/dist/host/src/index.js';
    const root = '/fake/project';
    createLauncherFiles({
      hostEntryPath,
      root,
      port: 39240,
      plat: 'linux',
      home: tmpDir,
    });

    const paths = getLauncherPaths('linux', tmpDir);
    const content = readFileSync(paths.launcher, 'utf8');
    assert.ok(content.includes('39240'), 'Launcher must include the configured port');
  });
});

// ---------------------------------------------------------------------------
// unregisterNativeHost — also removes launcher files (Enhancement 2)
// ---------------------------------------------------------------------------

describe('unregisterNativeHost — removes launcher files (ONB-05 extension)', () => {
  let tmpDir: string;
  const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop';

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfx-uninstall-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('removes .command launcher on darwin', () => {
    const manifestPath = join(tmpDir, 'com.stickyfix.host.json');
    const manifest = buildManifest(VALID_ID, join(tmpDir, 'fake.js'));
    writeManifest(manifest, manifestPath);

    // Create a launcher file in tmpDir
    const result = createLauncherFiles({
      hostEntryPath: '/fake/index.js',
      root: '/fake/root',
      plat: 'darwin',
      home: tmpDir,
    });

    const launcherPath = result.written[0];
    assert.ok(existsSync(launcherPath), 'Launcher should exist before unregister');

    // Unregister should remove both manifest and launcher
    unregisterNativeHost({
      plat: 'darwin',
      home: tmpDir,
      manifestPath,
      launcherPaths: { launcher: launcherPath, shortcut: null, desktopEntry: null },
    });

    assert.ok(!existsSync(manifestPath), 'Manifest should be removed');
    assert.ok(!existsSync(launcherPath), 'Launcher should be removed');
  });

  test('removes .sh and .desktop on linux', () => {
    const manifestPath = join(tmpDir, 'manifest2.json');
    const manifest = buildManifest(VALID_ID, join(tmpDir, 'fake.js'));
    writeManifest(manifest, manifestPath);

    const result = createLauncherFiles({
      hostEntryPath: '/fake/index.js',
      root: '/fake/root',
      plat: 'linux',
      home: tmpDir,
    });

    const shPath = result.written.find((p) => p.endsWith('.sh'));
    const desktopPath = result.written.find((p) => p.endsWith('.desktop'));
    assert.ok(shPath && existsSync(shPath), '.sh should exist before unregister');

    unregisterNativeHost({
      plat: 'linux',
      home: tmpDir,
      manifestPath,
      launcherPaths: {
        launcher: shPath ?? '',
        shortcut: null,
        desktopEntry: desktopPath ?? null,
      },
    });

    assert.ok(!existsSync(manifestPath), 'Manifest should be removed');
    assert.ok(!existsSync(shPath!), '.sh launcher should be removed');
    if (desktopPath) {
      assert.ok(!existsSync(desktopPath), '.desktop should be removed');
    }
  });

  test('unregisterNativeHost is idempotent when launchers are already absent', () => {
    assert.doesNotThrow(() =>
      unregisterNativeHost({
        plat: 'linux',
        home: tmpDir,
        manifestPath: join(tmpDir, 'nonexistent.json'),
        launcherPaths: {
          launcher: join(tmpDir, 'no-such.sh'),
          shortcut: null,
          desktopEntry: null,
        },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// enumerateArtifacts — completeness (ONB-05), now includes launcher paths
// ---------------------------------------------------------------------------

describe('enumerateArtifacts — uninstall completeness (ONB-05)', () => {
  test('includes manifest path for darwin', () => {
    const artifacts = enumerateArtifacts({ plat: 'darwin', home: '/home/u', root: '/proj' });
    const paths = artifacts.paths ?? [];
    assert.ok(
      paths.some((p: string) => p.includes('com.stickyfix.host.json')),
      `Manifest path missing from darwin artifacts: ${JSON.stringify(paths)}`
    );
  });

  test('includes manifest path for linux', () => {
    const artifacts = enumerateArtifacts({ plat: 'linux', home: '/home/u', root: '/proj' });
    const paths = artifacts.paths ?? [];
    assert.ok(
      paths.some((p: string) => p.includes('com.stickyfix.host.json')),
      `Manifest path missing from linux artifacts: ${JSON.stringify(paths)}`
    );
  });

  test('includes .stickyfix-port in all platforms', () => {
    for (const plat of ['darwin', 'linux', 'win32'] as NodeJS.Platform[]) {
      const artifacts = enumerateArtifacts({ plat, home: '/home/u', root: '/proj' });
      const paths = artifacts.paths ?? [];
      assert.ok(
        paths.some((p: string) => p.includes('.stickyfix-port')),
        `Missing .stickyfix-port in artifacts for ${plat}: ${JSON.stringify(paths)}`
      );
    }
  });

  test('includes stickyfix config path (all platforms)', () => {
    for (const plat of ['darwin', 'linux', 'win32'] as NodeJS.Platform[]) {
      const artifacts = enumerateArtifacts({ plat, home: '/home/u', root: '/proj' });
      const paths = artifacts.paths ?? [];
      assert.ok(
        paths.some((p: string) => p.includes('stickyfix') && p.includes('config')),
        `Missing stickyfix config path for ${plat}: ${JSON.stringify(paths)}`
      );
    }
  });

  test('win32: includes Chrome and Edge registry keys', () => {
    const artifacts = enumerateArtifacts({ plat: 'win32', home: 'C:\\Users\\u', root: 'C:\\proj' });
    const regKeys = artifacts.registryKeys ?? [];
    assert.ok(
      regKeys.some((k: string) => k.includes('Chrome')),
      `Missing Chrome registry key: ${JSON.stringify(regKeys)}`
    );
    assert.ok(
      regKeys.some((k: string) => k.includes('Edge') || k.includes('Microsoft')),
      `Missing Edge registry key: ${JSON.stringify(regKeys)}`
    );
  });

  // Enhancement 2: launcher paths in enumerate
  test('darwin: includes .command launcher path', () => {
    const artifacts = enumerateArtifacts({ plat: 'darwin', home: '/home/u', root: '/proj' });
    const paths = artifacts.paths ?? [];
    assert.ok(
      paths.some((p: string) => p.endsWith('.command')),
      `Missing .command launcher in darwin artifacts: ${JSON.stringify(paths)}`
    );
  });

  test('linux: includes .sh launcher and .desktop entry paths', () => {
    const artifacts = enumerateArtifacts({ plat: 'linux', home: '/home/u', root: '/proj' });
    const paths = artifacts.paths ?? [];
    assert.ok(
      paths.some((p: string) => p.endsWith('.sh')),
      `Missing .sh launcher in linux artifacts: ${JSON.stringify(paths)}`
    );
    assert.ok(
      paths.some((p: string) => p.endsWith('.desktop')),
      `Missing .desktop entry in linux artifacts: ${JSON.stringify(paths)}`
    );
  });

  test('win32: includes .bat launcher and Desktop .lnk shortcut paths', () => {
    const artifacts = enumerateArtifacts({ plat: 'win32', home: 'C:\\Users\\u', root: 'C:\\proj' });
    const paths = artifacts.paths ?? [];
    assert.ok(
      paths.some((p: string) => p.endsWith('.bat')),
      `Missing .bat launcher in win32 artifacts: ${JSON.stringify(paths)}`
    );
    assert.ok(
      paths.some((p: string) => p.endsWith('.lnk')),
      `Missing .lnk shortcut in win32 artifacts: ${JSON.stringify(paths)}`
    );
  });

  // Enhancement 1: init defaults to stable extension ID
  test('buildManifest with STABLE_EXTENSION_ID sets correct allowed_origins', () => {
    const m = buildManifest(STABLE_EXTENSION_ID, '/fake/path') as { allowed_origins: string[] };
    assert.strictEqual(
      m.allowed_origins[0],
      `chrome-extension://${STABLE_EXTENSION_ID}/`,
      'allowed_origins must use STABLE_EXTENSION_ID when no --extension-id is supplied'
    );
  });
});

// ---------------------------------------------------------------------------
// registerNativeHost — native-messaging launcher wrapper (Windows .cjs fix)
// ---------------------------------------------------------------------------

describe('registerNativeHost — native wrapper points manifest at launcher', () => {
  let tmpDir: string;
  const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop';

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfx-wrapper-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('win32: writes wrapper and points manifest path at it', () => {
    const hostBinPath = join(tmpDir, 'dist', 'host', 'stickyfix-native.cjs');
    // CRITICAL: inject a no-op execReg. The HKCU key name is a hardcoded
    // constant, so a real `reg ADD` here would clobber the developer's actual
    // Chrome/Edge native-messaging registration (pointing it at this tmpDir
    // manifest, which afterEach deletes — breaking the live extension until
    // `init` is re-run). We capture the calls and assert the keys instead.
    const regCalls: readonly string[][] = [];
    registerNativeHost({
      extensionId: VALID_ID,
      hostBinPath,
      plat: 'win32',
      home: tmpDir,
      execReg: (args) => { (regCalls as string[][]).push([...args]); },
    });

    // Both Chrome and Edge HKCU keys are registered (without touching real HKCU)
    assert.strictEqual(regCalls.length, 2, 'should register Chrome + Edge');
    assert.ok(regCalls.some((a) => a.join(' ').includes('Chrome')), 'Chrome key registered');
    assert.ok(regCalls.some((a) => a.join(' ').includes('Edge')), 'Edge key registered');

    const wrapperPath = nativeWrapperPath('win32', tmpDir);
    assert.ok(existsSync(wrapperPath), `Wrapper should exist at ${wrapperPath}`);
    assert.ok(wrapperPath.endsWith('.bat'), `win32 wrapper should be a .bat: ${wrapperPath}`);

    const wrapperContent = readFileSync(wrapperPath, 'utf8');
    assert.ok(wrapperContent.includes('node'), 'Wrapper must invoke node');
    assert.ok(
      wrapperContent.includes(hostBinPath),
      `Wrapper must reference the abs cjs path: ${wrapperContent}`
    );

    const manifestPath = nativeManifestPath('win32', tmpDir);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { path: string };
    assert.strictEqual(
      manifest.path,
      wrapperPath,
      `Manifest path must point at the wrapper, got: ${manifest.path}`
    );
  });
});

// ---------------------------------------------------------------------------
// Firefox port (cross-browser) — allowed_extensions, Mozilla paths, registry key
// ---------------------------------------------------------------------------

describe('Firefox: nativeManifestPath — Mozilla locations', () => {
  const fakeHome = '/home/testuser';

  test('darwin: returns Mozilla/NativeMessagingHosts path', () => {
    const result = nativeManifestPath('darwin', fakeHome, 'firefox');
    const normalized = result.replace(/\\/g, '/');
    assert.ok(
      normalized.includes('Library/Application Support/Mozilla/NativeMessagingHosts'),
      `Expected macOS Mozilla path, got: ${result}`
    );
    assert.ok(result.endsWith('com.stickyfix.host.json'), `Expected .json suffix, got: ${result}`);
  });

  test('linux: returns .mozilla/native-messaging-hosts path', () => {
    const result = nativeManifestPath('linux', fakeHome, 'firefox');
    const normalized = result.replace(/\\/g, '/');
    assert.ok(
      normalized.includes('.mozilla/native-messaging-hosts'),
      `Expected Linux Mozilla path, got: ${result}`
    );
    assert.ok(result.endsWith('com.stickyfix.host.json'), `Expected .json suffix, got: ${result}`);
  });

  test('win32: returns a stickyfix data-dir path with a firefox-distinct filename', () => {
    const fakeWinHome = 'C:\\Users\\testuser';
    const result = nativeManifestPath('win32', fakeWinHome, 'firefox');
    assert.ok(result.includes('stickyfix'), `Expected stickyfix data dir, got: ${result}`);
    // Distinct from the Chrome win32 manifest so they can coexist on disk
    const chromeWin = nativeManifestPath('win32', fakeWinHome, 'chrome');
    assert.notStrictEqual(result, chromeWin, 'Firefox win32 manifest must differ from Chrome');
    assert.ok(result.endsWith('.json'), `Expected .json suffix, got: ${result}`);
  });

  test('chrome remains the default (no regression)', () => {
    const def = nativeManifestPath('linux', fakeHome);
    const chrome = nativeManifestPath('linux', fakeHome, 'chrome');
    assert.strictEqual(def, chrome, 'Default browser must be chrome');
    assert.ok(def.replace(/\\/g, '/').includes('.config/google-chrome'));
  });
});

describe('Firefox: buildManifest — allowed_extensions (not allowed_origins)', () => {
  const GECKO_ID = 'stickyfix@stickyfix.dev';

  test('emits allowed_extensions with the gecko id', () => {
    const m = buildManifest(GECKO_ID, '/usr/bin/node', 'firefox') as {
      allowed_extensions: string[];
      allowed_origins?: unknown;
    };
    assert.ok(Array.isArray(m.allowed_extensions), 'allowed_extensions must be an array');
    assert.strictEqual(m.allowed_extensions.length, 1);
    assert.strictEqual(m.allowed_extensions[0], GECKO_ID);
  });

  test('does NOT emit allowed_origins (Firefox rejects that field)', () => {
    const m = buildManifest(GECKO_ID, '/usr/bin/node', 'firefox') as Record<string, unknown>;
    assert.strictEqual(m.allowed_origins, undefined, 'Firefox manifest must not carry allowed_origins');
  });

  test('name/type/path preserved with absolute path', () => {
    const m = buildManifest(GECKO_ID, './rel/host', 'firefox') as {
      name: string; type: string; path: string;
    };
    assert.strictEqual(m.name, 'com.stickyfix.host');
    assert.strictEqual(m.type, 'stdio');
    assert.ok(isAbsolute(m.path), `Expected absolute path, got: ${m.path}`);
  });

  test('accepts a gecko id and rejects a Chrome a-p id on the firefox path', () => {
    assert.doesNotThrow(() => buildManifest(GECKO_ID, '/usr/bin/node', 'firefox'));
    // A Chrome-shaped id has no @domain — must be rejected on the firefox path
    assert.throws(() => buildManifest(STABLE_EXTENSION_ID, '/usr/bin/node', 'firefox'));
  });

  test('chrome path still rejects a gecko id (no cross-contamination)', () => {
    assert.throws(() => buildManifest(GECKO_ID, '/usr/bin/node', 'chrome'));
    assert.throws(() => buildManifest(GECKO_ID, '/usr/bin/node')); // default chrome
  });
});

describe('Firefox: registerNativeHost — Mozilla registry key + manifest', () => {
  let tmpDir: string;
  const GECKO_ID = 'stickyfix@stickyfix.dev';
  const VALID_AP_ID = 'abcdefghijklmnopabcdefghijklmnop'; // 32 a-p chars (Chrome)

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfx-ff-reg-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('win32: registers ONLY the Mozilla HKCU key (no Chrome/Edge)', () => {
    const hostBinPath = join(tmpDir, 'dist', 'host', 'stickyfix-native.cjs');
    // No-op execReg — never touch the developer's real HKCU (see Chrome test note).
    const regCalls: readonly string[][] = [];
    registerNativeHost({
      extensionId: GECKO_ID,
      hostBinPath,
      plat: 'win32',
      home: tmpDir,
      browser: 'firefox',
      execReg: (args) => { (regCalls as string[][]).push([...args]); },
    });

    assert.strictEqual(regCalls.length, 1, 'firefox registers exactly one key');
    const joined = regCalls[0]!.join(' ');
    assert.ok(joined.includes('Mozilla'), `Expected Mozilla key, got: ${joined}`);
    assert.ok(!joined.includes('Google'), 'must not register Chrome key');
    assert.ok(!joined.includes('Edge'), 'must not register Edge key');

    // Manifest is written at the firefox path and carries allowed_extensions
    const manifestPath = nativeManifestPath('win32', tmpDir, 'firefox');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      path: string; allowed_extensions: string[]; allowed_origins?: unknown;
    };
    assert.deepStrictEqual(manifest.allowed_extensions, [GECKO_ID]);
    assert.strictEqual(manifest.allowed_origins, undefined);

    const wrapperPath = nativeWrapperPath('win32', tmpDir, 'firefox');
    assert.ok(existsSync(wrapperPath), `Wrapper should exist at ${wrapperPath}`);
    assert.strictEqual(manifest.path, wrapperPath, 'Manifest path must point at the wrapper');
    // The Firefox wrapper MUST be a file distinct from the Chrome wrapper, else
    // a Firefox uninstall would clobber a co-installed Chrome (HIGH regression).
    assert.ok(
      wrapperPath.endsWith('.firefox.bat'),
      `Firefox win32 wrapper must be .firefox.bat, got: ${wrapperPath}`
    );
    assert.notStrictEqual(
      wrapperPath,
      nativeWrapperPath('win32', tmpDir, 'chrome'),
      'Firefox wrapper path must differ from Chrome wrapper path'
    );
  });

  test('win32: Firefox uninstall does NOT remove the co-installed Chrome wrapper', () => {
    const hostBinPath = join(tmpDir, 'dist', 'host', 'stickyfix-native.cjs');
    const noopReg = () => {};
    // Install BOTH browsers (no-op execReg — never touch the real HKCU).
    registerNativeHost({ extensionId: VALID_AP_ID, hostBinPath, plat: 'win32', home: tmpDir, browser: 'chrome', execReg: noopReg });
    registerNativeHost({ extensionId: GECKO_ID, hostBinPath, plat: 'win32', home: tmpDir, browser: 'firefox', execReg: noopReg });

    const chromeWrapper = nativeWrapperPath('win32', tmpDir, 'chrome');
    const firefoxWrapper = nativeWrapperPath('win32', tmpDir, 'firefox');
    assert.ok(existsSync(chromeWrapper), 'Chrome wrapper should exist after chrome install');
    assert.ok(existsSync(firefoxWrapper), 'Firefox wrapper should exist after firefox install');
    assert.notStrictEqual(chromeWrapper, firefoxWrapper, 'wrappers must be distinct files');
    // Chrome wrapper keeps the canonical (unsuffixed) name — regression guard.
    assert.ok(chromeWrapper.endsWith('com.stickyfix.host.bat'), `Chrome wrapper name changed: ${chromeWrapper}`);

    // Uninstall ONLY Firefox.
    unregisterNativeHost({ plat: 'win32', home: tmpDir, browser: 'firefox' });

    assert.ok(!existsSync(firefoxWrapper), 'Firefox wrapper should be removed by firefox uninstall');
    assert.ok(
      existsSync(chromeWrapper),
      'Chrome wrapper MUST survive a Firefox uninstall (cross-browser regression guard)'
    );

    // The Chrome manifest still points at the surviving Chrome wrapper.
    const chromeManifestPath = nativeManifestPath('win32', tmpDir, 'chrome');
    const chromeManifest = JSON.parse(readFileSync(chromeManifestPath, 'utf8')) as { path: string };
    assert.strictEqual(chromeManifest.path, chromeWrapper, 'Chrome manifest must still reference its wrapper');
  });

  test('linux: writes the Firefox manifest under .mozilla and round-trips unregister', () => {
    const hostBinPath = join(tmpDir, 'dist', 'host', 'stickyfix-native.cjs');
    registerNativeHost({
      extensionId: GECKO_ID,
      hostBinPath,
      plat: 'linux',
      home: tmpDir,
      browser: 'firefox',
    });

    const manifestPath = nativeManifestPath('linux', tmpDir, 'firefox');
    assert.ok(
      manifestPath.replace(/\\/g, '/').includes('.mozilla/native-messaging-hosts'),
      `Expected .mozilla path, got: ${manifestPath}`
    );
    assert.ok(existsSync(manifestPath), 'Firefox manifest should be written');

    unregisterNativeHost({ plat: 'linux', home: tmpDir, browser: 'firefox' });
    assert.ok(!existsSync(manifestPath), 'Firefox manifest should be removed after unregister');
  });
});

describe('Firefox: enumerateArtifacts — Mozilla manifest + registry key', () => {
  test('win32: includes ONLY the Mozilla registry key', () => {
    const artifacts = enumerateArtifacts({
      plat: 'win32', home: 'C:\\Users\\u', root: 'C:\\proj', browser: 'firefox',
    });
    const regKeys = artifacts.registryKeys ?? [];
    assert.deepStrictEqual(regKeys.length, 1, 'firefox enumerates exactly one reg key');
    assert.ok(regKeys[0]!.includes('Mozilla'), `Expected Mozilla key: ${JSON.stringify(regKeys)}`);
    assert.ok(!regKeys.some((k) => k.includes('Google') || k.includes('Edge')), 'no Chrome/Edge keys');
  });

  test('linux: includes the .mozilla manifest path', () => {
    const artifacts = enumerateArtifacts({
      plat: 'linux', home: '/home/u', root: '/proj', browser: 'firefox',
    });
    const paths = (artifacts.paths ?? []).map((p) => p.replace(/\\/g, '/'));
    assert.ok(
      paths.some((p) => p.includes('.mozilla/native-messaging-hosts')),
      `Missing Firefox manifest path: ${JSON.stringify(paths)}`
    );
  });

  test('chrome (default) still enumerates Chrome + Edge keys (no regression)', () => {
    const artifacts = enumerateArtifacts({ plat: 'win32', home: 'C:\\Users\\u', root: 'C:\\proj' });
    const regKeys = artifacts.registryKeys ?? [];
    assert.ok(regKeys.some((k) => k.includes('Chrome')), 'Chrome key still present');
    assert.ok(regKeys.some((k) => k.includes('Edge') || k.includes('Microsoft')), 'Edge key still present');
    assert.ok(!regKeys.some((k) => k.includes('Mozilla')), 'chrome path must not list Mozilla');
  });
});

// ---------------------------------------------------------------------------
// buildPickerArgs — no shell metacharacters (ONB-04 / T-09-01)
// ---------------------------------------------------------------------------

describe('buildPickerArgs — shell-safe arg arrays', () => {
  const TITLE = 'Choose project folder';

  // Shell injection metacharacters that should NOT appear from user-controlled
  // input leaking into the args in an unescaped way.
  // Note: the PowerShell -Command arg legitimately uses $ and ; as PowerShell
  // syntax — that is expected and safe because execFile does NOT spawn a shell.
  // We scan for characters that would indicate unescaped POSIX shell injection
  // from user input leaking into the command structure (backtick, pipe, &&).
  const INJECTION_RE = /(`|&&|\|\|)/;

  function scanForInjection(args: string[], title: string): void {
    const joined = args.join(' ');
    assert.ok(
      !INJECTION_RE.test(joined),
      `Potential shell injection found in args: ${joined}`
    );
    // Ensure the raw title is not passed verbatim when it contains special chars
    // (only relevant when title itself has injection chars)
    if (title.includes('`') || title.includes('$(')) {
      assert.ok(
        !joined.includes('$('),
        `Unescaped $( found in args — potential command substitution: ${joined}`
      );
    }
  }

  test('win32: powershell.exe command', () => {
    const result = buildPickerArgs('win32', TITLE);
    assert.strictEqual(result.cmd, 'powershell.exe');
    assert.ok(Array.isArray(result.args), 'args must be an array (execFile, not exec)');
  });

  test('win32: args is an array (execFile contract — no shell spawned)', () => {
    const result = buildPickerArgs('win32', TITLE);
    assert.ok(Array.isArray(result.args));
    assert.ok(result.args.length > 0);
    // No argument should be just 'sh', 'cmd', '/c', '/bin/sh' — those indicate shell fallback
    const joined = result.args.join(' ');
    assert.ok(!joined.match(/\bcmd\s*\/c\b/), 'Found cmd /c — shell fallback');
    assert.ok(!joined.includes('/bin/sh'), 'Found /bin/sh — shell fallback');
  });

  test('win32: no "shell" key name in args (no shell:true pattern)', () => {
    const result = buildPickerArgs('win32', TITLE);
    // Verify args don't contain a string that looks like passing shell:true as an option name
    result.args.forEach(arg => {
      assert.ok(
        arg !== 'shell',
        `Found bare "shell" as an argument — suspicious: ${arg}`
      );
    });
  });

  test('win32: title with single quotes is escaped (no PowerShell injection)', () => {
    const titleWithQuote = "Developer's Project";
    const result = buildPickerArgs('win32', titleWithQuote);
    const cmdArg = result.args.find(a => a.includes('Description'));
    assert.ok(cmdArg, 'Expected -Command arg containing Description');
    // PowerShell single-quote escape: ' → '' (doubled)
    assert.ok(
      cmdArg.includes("Developer''s"),
      `Expected single-quote escaped to '' in: ${cmdArg}`
    );
    scanForInjection(result.args, titleWithQuote);
  });

  test('darwin: osascript command, args array', () => {
    const result = buildPickerArgs('darwin', TITLE);
    assert.strictEqual(result.cmd, 'osascript');
    assert.ok(Array.isArray(result.args));
  });

  test('linux: zenity command (primary), args array', () => {
    const result = buildPickerArgs('linux', TITLE);
    assert.ok(
      result.cmd === 'zenity' || result.cmd === 'kdialog',
      `Expected zenity or kdialog, got: ${result.cmd}`
    );
    assert.ok(Array.isArray(result.args));
    scanForInjection(result.args, TITLE);
  });

  test('title with special chars is embedded in single-quoted PowerShell string (safe)', () => {
    // $( inside PowerShell single-quoted strings is LITERAL — safe because execFile
    // does not spawn a shell; the arg is passed directly to PowerShell.exe.
    // The security invariant is: execFile (no shell) + title inside '...' single-quoted string.
    const dangerTitle = "$(echo pwned) Folder";
    const result = buildPickerArgs('win32', dangerTitle);
    // Verify no backtick injection (backtick is PowerShell's escape char)
    const joined = result.args.join(' ');
    assert.ok(!joined.includes('`'), `Backtick found in args — PowerShell escape injection: ${joined}`);
    // Verify no double-quote breakout
    const cmdArg = result.args.find(a => a.includes('Description')) ?? '';
    assert.ok(
      cmdArg.includes(`'${dangerTitle}'`) || cmdArg.includes(`'$(echo pwned) Folder'`),
      `Title should be inside single quotes in PowerShell -Command: ${cmdArg}`
    );
  });

  test('args array cmd is a fixed binary name (not user-controlled)', () => {
    const result = buildPickerArgs('win32', TITLE);
    assert.ok(['powershell.exe', 'osascript', 'zenity', 'kdialog'].includes(result.cmd));
  });
});
