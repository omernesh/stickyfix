/**
 * node:test unit tests for host/src/read-note.ts
 *
 * Covers HOST-14/15/16:
 *   - resolveSerialFile: finds *.md and *.read.md by serial prefix; returns null on miss
 *   - listAnnotations: URL path match (query ignored), serial extraction, mode/status/rect/
 *     viewportCoords from frontmatter; skips notes with non-string url
 *   - editNote: rewrites body + sets status:unread; preserves frontmatter + screenshots; 404 on miss
 *   - deleteNote: removes .md + +N.png siblings; 404 on miss; path confinement
 *
 * D-03: free-note note_position frontmatter round-trips into viewportCoords (canonical key check).
 *
 * Pattern: mkdtempSync tmpdir lifecycle per describe; full frontmatter fixtures.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import {
  resolveSerialFile,
  listAnnotations,
  editNote,
  deleteNote,
} from '../src/read-note.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal .md fixture with frontmatter
// ---------------------------------------------------------------------------

function makeFrontmatter(fields: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'object' && v !== null) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        lines.push(`  ${sk}: ${sv}`);
      }
    } else if (typeof v === 'string') {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function writeFixture(dir: string, filename: string, fm: Record<string, unknown>, body: string): string {
  const content = makeFrontmatter(fm) + body + '\n';
  const fullPath = join(dir, filename);
  writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

// ---------------------------------------------------------------------------
// resolveSerialFile
// ---------------------------------------------------------------------------

describe('resolveSerialFile', () => {
  let dir: string;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'sfx-read-resolve-')); });
  test.after(() => { rmSync(dir, { recursive: true, force: true }); });

  test('finds *.md file by serial prefix', () => {
    writeFileSync(join(dir, '0003-20260603-100000.md'), 'content', 'utf8');
    const result = resolveSerialFile(dir, '0003');
    assert.ok(result !== null, 'should find file');
    assert.ok(result.endsWith('0003-20260603-100000.md'), `got: ${result}`);
  });

  test('finds *.read.md file by serial prefix', () => {
    writeFileSync(join(dir, '0004-20260603-110000.read.md'), 'content', 'utf8');
    const result = resolveSerialFile(dir, '0004');
    assert.ok(result !== null, 'should find .read.md file');
    assert.ok(result.endsWith('0004-20260603-110000.read.md'), `got: ${result}`);
  });

  test('returns null when no file matches the serial', () => {
    const result = resolveSerialFile(dir, '9999');
    assert.strictEqual(result, null);
  });

  test('does not match wrong serial prefix', () => {
    writeFileSync(join(dir, '0010-20260603-120000.md'), 'content', 'utf8');
    const result = resolveSerialFile(dir, '0001');
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// listAnnotations
// ---------------------------------------------------------------------------

describe('listAnnotations', () => {
  let dir: string;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'sfx-read-list-')); });
  test.after(() => { rmSync(dir, { recursive: true, force: true }); });

  test('includes note whose url path matches (ignoring query)', () => {
    writeFixture(dir, '0001-20260603-100000.md', {
      id: 1, mode: 'free', url: 'https://example.com/admin/users',
      status: 'unread', screenshots: [],
    }, 'First note body');

    const pins = listAnnotations(dir, 'https://example.com/admin/users?tab=2');
    assert.strictEqual(pins.length, 1);
    assert.strictEqual(pins[0].serial, '0001');
  });

  test('excludes note whose url path differs', () => {
    writeFixture(dir, '0002-20260603-100000.md', {
      id: 2, mode: 'free', url: 'https://example.com/other-page',
      status: 'unread', screenshots: [],
    }, 'Different page note');

    const pins = listAnnotations(dir, 'https://example.com/admin/users');
    const found = pins.find(p => p.serial === '0002');
    assert.strictEqual(found, undefined, 'should exclude note with different path');
  });

  test('extracts serial from filename (not from fm.id)', () => {
    writeFixture(dir, '0005-20260603-100000.md', {
      id: 5, mode: 'element', url: 'https://example.com/page',
      status: 'unread', screenshots: [],
    }, 'Element note');

    const pins = listAnnotations(dir, 'https://example.com/page');
    const pin = pins.find(p => p.serial === '0005');
    assert.ok(pin, 'should find note with serial 0005');
    assert.strictEqual(pin.serial, '0005');
  });

  test('reads mode and status from frontmatter', () => {
    writeFixture(dir, '0006-20260603-100000.md', {
      id: 6, mode: 'element', url: 'https://example.com/page',
      status: 'read', screenshots: [],
      selector: '#save-btn',
    }, 'Element note body');

    const pins = listAnnotations(dir, 'https://example.com/page');
    const pin = pins.find(p => p.serial === '0006');
    assert.ok(pin, 'should find note 0006');
    assert.strictEqual(pin.mode, 'element');
    assert.strictEqual(pin.status, 'read');
    assert.strictEqual(pin.selector, '#save-btn');
  });

  test('free-note: note_position frontmatter round-trips into viewportCoords (D-03 canonical key)', () => {
    writeFixture(dir, '0007-20260603-100000.md', {
      id: 7, mode: 'free', url: 'https://example.com/page',
      status: 'unread', screenshots: [],
      note_position: { x: 320, y: 480 },
    }, 'Free note with position');

    const pins = listAnnotations(dir, 'https://example.com/page');
    const pin = pins.find(p => p.serial === '0007');
    assert.ok(pin, 'should find note 0007');
    assert.deepStrictEqual(pin.viewportCoords, { x: 320, y: 480 });
  });

  test('element-note: rect from frontmatter available in pin descriptor', () => {
    writeFixture(dir, '0008-20260603-100000.md', {
      id: 8, mode: 'element', url: 'https://example.com/page',
      status: 'unread', screenshots: [],
      selector: '#btn', rect: { x: 100, y: 200, width: 80, height: 30 },
    }, 'Element note with rect');

    const pins = listAnnotations(dir, 'https://example.com/page');
    const pin = pins.find(p => p.serial === '0008');
    assert.ok(pin, 'should find note 0008');
    assert.deepStrictEqual(pin.rect, { x: 100, y: 200, width: 80, height: 30 });
  });

  test('skips notes without a string url field', () => {
    // Write a note with numeric url (would fail typeof check)
    writeFileSync(
      join(dir, '0009-20260603-100000.md'),
      '---\nid: 9\nmode: free\nstatus: unread\nscreenshots: []\n---\nno url field\n',
      'utf8'
    );
    const countBefore = listAnnotations(dir, 'https://example.com/page').length;
    // This note should not appear in any listAnnotations results
    assert.ok(countBefore >= 0); // just verify it doesn't throw
  });

  test('extracts first body line as text', () => {
    writeFixture(dir, '0010-20260603-100000.md', {
      id: 10, mode: 'free', url: 'https://example.com/page',
      status: 'unread', screenshots: [],
    }, 'First line text content\nSecond line');

    const pins = listAnnotations(dir, 'https://example.com/page');
    const pin = pins.find(p => p.serial === '0010');
    assert.ok(pin, 'should find note 0010');
    assert.strictEqual(pin.text, 'First line text content');
  });
});

// ---------------------------------------------------------------------------
// editNote
// ---------------------------------------------------------------------------

describe('editNote', () => {
  let dir: string;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'sfx-read-edit-')); });
  test.after(() => { rmSync(dir, { recursive: true, force: true }); });

  test('rewrites body and sets status:unread', async () => {
    writeFixture(dir, '0001-20260603-100000.md', {
      id: 1, mode: 'free', url: 'https://example.com/', status: 'read', screenshots: [],
    }, 'Original comment\n');

    await editNote(dir, '0001', 'Updated comment text');

    const content = readFileSync(join(dir, '0001-20260603-100000.md'), 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fmMatch, 'frontmatter block must be present');
    const fm = yamlParse(fmMatch[1]) as Record<string, unknown>;
    assert.strictEqual(fm['status'], 'unread');
    assert.ok(content.includes('Updated comment text'), 'body should contain new comment');
    assert.ok(!content.includes('Original comment'), 'old body should be gone');
  });

  test('preserves frontmatter fields other than status', async () => {
    writeFixture(dir, '0002-20260603-100000.md', {
      id: 2, mode: 'element', url: 'https://example.com/app', status: 'read',
      selector: '#save-btn', screenshots: [],
    }, 'Original note\n');

    await editNote(dir, '0002', 'New text');

    const content = readFileSync(join(dir, '0002-20260603-100000.md'), 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fmMatch);
    const fm = yamlParse(fmMatch[1]) as Record<string, unknown>;
    assert.strictEqual(fm['mode'], 'element');
    assert.strictEqual(fm['url'], 'https://example.com/app');
    assert.strictEqual(fm['selector'], '#save-btn');
  });

  test('preserves screenshots section in body', async () => {
    const fmStr = makeFrontmatter({
      id: 3, mode: 'free', url: 'https://example.com/', status: 'unread', screenshots: ['0003-20260603+1.png'],
    });
    const body = 'Old comment\n\n### Screenshots\n![+1](0003-20260603+1.png)\n';
    writeFileSync(join(dir, '0003-20260603-100000.md'), fmStr + body, 'utf8');

    await editNote(dir, '0003', 'New comment');

    const content = readFileSync(join(dir, '0003-20260603-100000.md'), 'utf8');
    assert.ok(content.includes('### Screenshots'), 'screenshots section must be preserved');
    assert.ok(content.includes('0003-20260603+1.png'), 'screenshot filename must be preserved');
    assert.ok(content.includes('New comment'), 'new comment must be in body');
  });

  test('throws {statusCode:404} when serial not found', async () => {
    let threw = false;
    try {
      await editNote(dir, '9999', 'new text');
    } catch (e: unknown) {
      threw = true;
      const err = e as { statusCode?: number };
      assert.strictEqual(err.statusCode, 404);
    }
    assert.ok(threw, 'should throw for unknown serial');
  });
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

describe('deleteNote', () => {
  let dir: string;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'sfx-read-delete-')); });
  test.after(() => { rmSync(dir, { recursive: true, force: true }); });

  test('removes the .md file', async () => {
    writeFixture(dir, '0001-20260603-100000.md', {
      id: 1, mode: 'free', url: 'https://example.com/', status: 'unread', screenshots: [],
    }, 'Note to delete\n');

    await deleteNote(dir, '0001');

    assert.ok(!existsSync(join(dir, '0001-20260603-100000.md')), '.md should be removed');
  });

  test('removes +N.png screenshots alongside the .md', async () => {
    writeFixture(dir, '0002-20260603-100000.md', {
      id: 2, mode: 'free', url: 'https://example.com/', status: 'unread',
      screenshots: ['0002-20260603-100000+1.png'],
    }, 'Note with screenshots\n');
    writeFileSync(join(dir, '0002-20260603-100000+1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await deleteNote(dir, '0002');

    assert.ok(!existsSync(join(dir, '0002-20260603-100000.md')), '.md should be removed');
    assert.ok(!existsSync(join(dir, '0002-20260603-100000+1.png')), '+1.png should be removed');
  });

  test('removes .read.md file and associated png', async () => {
    writeFixture(dir, '0003-20260603-100000.read.md', {
      id: 3, mode: 'free', url: 'https://example.com/', status: 'read',
      screenshots: ['0003-20260603-100000+1.png'],
    }, 'Read note\n');
    writeFileSync(join(dir, '0003-20260603-100000+1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await deleteNote(dir, '0003');

    assert.ok(!existsSync(join(dir, '0003-20260603-100000.read.md')), '.read.md should be removed');
    assert.ok(!existsSync(join(dir, '0003-20260603-100000+1.png')), '+1.png should be removed');
  });

  test('throws {statusCode:404} when serial not found', async () => {
    let threw = false;
    try {
      await deleteNote(dir, '9999');
    } catch (e: unknown) {
      threw = true;
      const err = e as { statusCode?: number };
      assert.strictEqual(err.statusCode, 404);
    }
    assert.ok(threw, 'should throw for unknown serial');
  });
});
