import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { writeNote, decodePngDataUrl } from '../src/write-note.js';
import type { AnnotationPayload } from '../src/types.js';

// Minimal valid 1x1 transparent PNG, base64-encoded
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

const FREE_PAYLOAD: AnnotationPayload = {
  mode: 'free',
  comment: 'This is a free-mode comment.',
  page: { url: 'https://example.com', title: 'Example Page' },
  viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
};

const ELEMENT_PAYLOAD: AnnotationPayload = {
  mode: 'element',
  comment: 'Element-mode comment.',
  page: { url: 'https://example.com/app', title: 'App: Dashboard' },
  viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
  element: {
    selector: '#main .hero-button',
    tag: 'button',
    id: 'hero-button',
    classList: ['hero-button', 'cta'],
    role: 'button',
    ariaLabel: 'Get started',
    text: 'Get started',
    rect: { x: 100, y: 200, width: 120, height: 40 },
    computedStyles: { color: 'rgb(255,255,255)', background: 'rgb(0,112,243)' },
    outerHTML: '<button id="hero-button">Get started</button>',
    reactComponent: 'HeroButton',
  },
  screenshots: [
    { kind: 'element', mime: 'image/png', dataUrl: TINY_PNG_DATA_URL },
  ],
};

// ---------------------------------------------------------------------------
// Helper: extract YAML frontmatter from .md content
// ---------------------------------------------------------------------------
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'frontmatter block not found');
  return yamlParse(match[1]) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// writeNote: free mode
// ---------------------------------------------------------------------------
describe('writeNote — free mode', () => {
  let dir: string;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'sfx-note-')); });
  test.after(() => { rmSync(dir, { recursive: true }); });

  test('writes .md file with correct frontmatter keys', async () => {
    const { file } = await writeNote(dir, FREE_PAYLOAD, 1);
    assert.ok(existsSync(file), `.md file does not exist: ${file}`);

    const content = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);

    assert.strictEqual(fm['mode'], 'free');
    assert.strictEqual(fm['status'], 'unread');
    assert.ok(fm['id'] !== undefined, 'id missing');
    assert.ok(fm['created'] !== undefined, 'created missing');
    assert.ok(content.includes('https://example.com'), 'url not in frontmatter');
    assert.ok(content.includes('Example Page'), 'title not in frontmatter');

    // Free mode must NOT contain selector
    assert.ok(!('selector' in fm), 'selector must not appear in free-mode frontmatter');
    assert.ok(!('react_component' in fm), 'react_component must not appear in free-mode frontmatter');
  });

  test('includes comment in body', async () => {
    const { file } = await writeNote(dir, FREE_PAYLOAD, 2);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('This is a free-mode comment.'), 'comment not in body');
  });

  test('screenshots frontmatter is empty list for no screenshots', async () => {
    const { file } = await writeNote(dir, FREE_PAYLOAD, 3);
    const content = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);
    // screenshots key should be absent or empty array
    const screenshots = fm['screenshots'];
    if (screenshots !== undefined) {
      assert.deepStrictEqual(screenshots, [], 'screenshots should be empty for no-screenshot note');
    }
  });
});

// ---------------------------------------------------------------------------
// writeNote: element mode + PNG decode
// ---------------------------------------------------------------------------
describe('writeNote — element mode + PNG', () => {
  let dir: string;
  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'sfx-note-')); });
  test.after(() => { rmSync(dir, { recursive: true }); });

  test('frontmatter contains selector and react_component', async () => {
    const { file } = await writeNote(dir, ELEMENT_PAYLOAD, 1);
    const content = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);

    assert.strictEqual(fm['mode'], 'element');
    assert.ok('selector' in fm, 'selector missing');
    assert.ok('react_component' in fm, 'react_component missing');
    assert.strictEqual(fm['selector'], '#main .hero-button');
    assert.strictEqual(fm['react_component'], 'HeroButton');
  });

  test('body contains ## Element context section', async () => {
    const { file } = await writeNote(dir, ELEMENT_PAYLOAD, 2);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('## Element context'), '## Element context missing');
  });

  test('body contains computed-styles table', async () => {
    const { file } = await writeNote(dir, ELEMENT_PAYLOAD, 3);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('### Computed styles'), 'computed-styles table missing');
    assert.ok(content.includes('color'), 'color prop missing from table');
  });

  test('body contains truncated outerHTML', async () => {
    const { file } = await writeNote(dir, ELEMENT_PAYLOAD, 4);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('### outerHTML'), 'outerHTML section missing');
    assert.ok(content.includes('<button'), 'outerHTML content missing');
  });

  test('PNG data-URL decoded to +1.png with non-zero bytes', async () => {
    const { file } = await writeNote(dir, ELEMENT_PAYLOAD, 5);
    const pngPath = file.replace(/\.md$/, '+1.png');
    assert.ok(existsSync(pngPath), `+1.png not found: ${pngPath}`);
    const pngBytes = readFileSync(pngPath);
    assert.ok(pngBytes.length > 0, '+1.png has zero bytes');
  });

  test('frontmatter screenshots lists the +1.png filename', async () => {
    const { file } = await writeNote(dir, ELEMENT_PAYLOAD, 6);
    const content = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);
    const screenshots = fm['screenshots'] as string[];
    assert.ok(Array.isArray(screenshots) && screenshots.length === 1, 'screenshots should have 1 entry');
    assert.ok(screenshots[0].endsWith('+1.png'), `expected +1.png, got: ${screenshots[0]}`);
  });

  test('body Screenshots section references the png', async () => {
    const { file } = await writeNote(dir, ELEMENT_PAYLOAD, 7);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('+1.png'), '+1.png not referenced in body');
  });
});

// ---------------------------------------------------------------------------
// decodePngDataUrl — error cases
// ---------------------------------------------------------------------------
describe('decodePngDataUrl', () => {
  test('throws statusCode 400 for non-PNG-prefix dataUrl', () => {
    assert.throws(
      () => decodePngDataUrl('data:image/jpeg;base64,/9j/abc123'),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  test('returns a Buffer for a valid PNG data-URL', () => {
    const result = decodePngDataUrl(TINY_PNG_DATA_URL);
    assert.ok(Buffer.isBuffer(result), 'should return a Buffer');
    assert.ok(result.length > 0, 'buffer should be non-empty');
  });

  // WR-04: PNG magic-byte validation
  test('WR-04: throws statusCode 400 for correct prefix but wrong magic bytes (not a real PNG)', () => {
    // base64-encode "NOTAPNG" — has the right prefix but wrong magic bytes
    const fakeB64 = Buffer.from('NOTAPNG1234567890').toString('base64');
    assert.throws(
      () => decodePngDataUrl(`data:image/png;base64,${fakeB64}`),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes('magic bytes') || err.message.includes('PNG'), `unexpected message: ${err.message}`);
        return true;
      }
    );
  });

  test('WR-04: throws statusCode 400 for zero-length decoded buffer (empty base64 payload)', () => {
    assert.throws(
      () => decodePngDataUrl('data:image/png;base64,'),
      (err: any) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });
});
