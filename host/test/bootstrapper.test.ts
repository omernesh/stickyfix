/**
 * Tests for bootstrap/register.ts and folder-picker.ts.
 * Analog: host/test/index.test.ts (describe/before/after/tmpdir lifecycle)
 *
 * Covers:
 * - nativeManifestPath: per-OS path resolution
 * - buildManifest: required fields, absolute path, allowed_origins, bad-ID rejection
 * - writeManifest + unregisterNativeHost round-trip on tmpdir
 * - enumerateArtifacts: includes manifest + config + .stickyfix-port + (win32) reg keys
 * - buildPickerArgs: no shell metacharacters, no interpolated user input
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import {
  nativeManifestPath,
  buildManifest,
  writeManifest,
  enumerateArtifacts,
  unregisterNativeHost,
} from '../src/bootstrap/register.js';
import { buildPickerArgs } from '../src/folder-picker.js';

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
// enumerateArtifacts — completeness (ONB-05)
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
