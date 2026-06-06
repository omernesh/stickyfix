/**
 * Tests for the shared validateChosenFolder helper (T-09-14 / T-09-14b).
 *
 * This is the single source of truth for folder validation, used by BOTH the
 * native host (folder-pick result) and the HTTP server (per-request targetDir).
 * Covers: valid dir, non-absolute, missing, file-not-dir, and each system dir.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateChosenFolder } from '../src/validate-folder.js';

describe('validateChosenFolder — shared defensive path validation (T-09-14b)', () => {
  let realDir: string;
  let realFile: string;

  test.before(() => {
    realDir = mkdtempSync(join(tmpdir(), 'sfx-validate-folder-test-'));
    realFile = join(realDir, 'a-file.txt');
    writeFileSync(realFile, 'not a directory');
  });

  test.after(() => {
    rmSync(realDir, { recursive: true, force: true });
  });

  test('null input → null (user cancelled / no target)', () => {
    assert.strictEqual(validateChosenFolder(null), null);
  });

  test('empty string → null', () => {
    assert.strictEqual(validateChosenFolder(''), null);
  });

  test('relative path → null (not absolute)', () => {
    assert.strictEqual(validateChosenFolder('relative/path'), null);
  });

  test('non-existent absolute path → null', () => {
    const ghost = join(realDir, 'does-not-exist-xyz');
    assert.strictEqual(validateChosenFolder(ghost), null);
  });

  test('a file (not a directory) → null', () => {
    assert.strictEqual(validateChosenFolder(realFile), null);
  });

  test('a real existing directory → the normalized absolute path', () => {
    const result = validateChosenFolder(realDir);
    assert.ok(result, 'expected a non-null folder for a real directory');
    // Compare via join to be path-separator tolerant
    assert.strictEqual(result, join(realDir));
  });

  test('each system directory → null (deny-list rejection)', () => {
    if (process.platform === 'win32') {
      assert.strictEqual(validateChosenFolder('C:\\Windows', 'win32'), null);
      assert.strictEqual(validateChosenFolder('C:\\Program Files', 'win32'), null);
      // Case-insensitive on win32
      assert.strictEqual(validateChosenFolder('c:\\windows', 'win32'), null);
      assert.strictEqual(validateChosenFolder('C:\\PROGRAM FILES', 'win32'), null);
    } else {
      assert.strictEqual(validateChosenFolder('/', 'linux'), null);
      assert.strictEqual(validateChosenFolder('/System', 'darwin'), null);
      assert.strictEqual(validateChosenFolder('/usr', 'linux'), null);
      assert.strictEqual(validateChosenFolder('/etc', 'linux'), null);
    }
  });
});
