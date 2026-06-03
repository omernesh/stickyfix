/**
 * Note file writer for stickyfix-host.
 * D-09/HOST-07: writes <serial>-<YYYYMMDD-HHmmss>.md with YAML frontmatter
 * D-09/HOST-08: decodes PNG data-URLs to <base>+<N>.png next to the .md
 * D-11: PRD §9.2 note format — frontmatter + comment + element context + screenshots
 */

import { writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { AnnotationPayload } from './types.js';

const PNG_PREFIX = 'data:image/png;base64,';

// ---------------------------------------------------------------------------
// Public helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Format local time as YYYYMMDD-HHmmss (Pattern 10).
 * 15 characters including the dash.
 */
export function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// 8-byte PNG file signature (ISO 15948 §12.1)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validate the data:image/png;base64, prefix, decode to a Buffer, and assert
 * the 8-byte PNG magic signature (WR-04). Throws {statusCode:400} on any failure
 * (wrong prefix, zero-length buffer, bad magic bytes).
 */
export function decodePngDataUrl(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(PNG_PREFIX)) {
    throw Object.assign(
      new Error('Invalid screenshot mime: expected data:image/png;base64,'),
      { statusCode: 400 }
    );
  }
  const buf = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');
  // WR-04: reject zero-length buffers and non-PNG magic bytes
  if (buf.length < PNG_SIGNATURE.length) {
    throw Object.assign(
      new Error('Invalid screenshot: decoded buffer is too small to be a PNG'),
      { statusCode: 400 }
    );
  }
  if (!buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw Object.assign(
      new Error('Invalid screenshot: PNG magic bytes not found'),
      { statusCode: 400 }
    );
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the YAML frontmatter block per PRD §9.2 (Pattern 8).
 * selector + react_component ONLY for element mode (D-11).
 * IN-01: `base` parameter removed (was unused).
 */
export function buildFrontmatter(
  payload: AnnotationPayload,
  serial: number,
  screenshotRelPaths: string[]
): string {
  const { mode, page, viewport, element } = payload;

  const fm: Record<string, unknown> = {
    id: serial,
    created: new Date().toISOString(),
    mode,
    url: page.url,
    title: page.title,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      dpr: viewport.devicePixelRatio,
    },
  };

  if (mode === 'element' && element) {
    if (element.selector) fm['selector'] = element.selector;
    if (element.reactComponent) fm['react_component'] = element.reactComponent;
    // D-03: persist page-absolute rect for orphaned pin fallback (PIN-03)
    if (element.rect) fm['rect'] = element.rect;
  }

  // D-03: persist free-note viewport coords for pin floating position (PIN-02)
  // CANONICAL KEY: note_position — matches listAnnotations read key (D-03)
  if (mode === 'free' && payload.notePosition) {
    fm['note_position'] = payload.notePosition;
  }

  fm['screenshots'] = screenshotRelPaths;
  fm['status'] = 'unread';

  return '---\n' + yamlStringify(fm) + '---\n';
}

/**
 * Build the Markdown body per PRD §9.2 RESEARCH "Note Body Building" example.
 * Free notes: comment only + optional Screenshots section.
 * Element notes: comment + ## Element context + computed styles table + outerHTML + Screenshots.
 */
export function buildNoteBody(base: string, payload: AnnotationPayload): string {
  const { comment, element, screenshots } = payload;
  const screenshotBasenames = (screenshots ?? []).map((_, i) => `${base}+${i + 1}.png`);

  let body = `${comment ?? ''}\n`;

  if (element) {
    body += `\n## Element context\n\n`;
    body += `- **Selector:** \`${element.selector}\`\n`;
    if (element.reactComponent) body += `- **React component:** \`${element.reactComponent}\`\n`;
    body += `- **Tag / role:** \`${element.tag}\` / \`${element.role ?? element.tag}\``;
    if (element.ariaLabel) body += `  ·  **aria-label:** ${element.ariaLabel}`;
    body += '\n';
    if (element.text) body += `- **Text:** ${element.text}\n`;
    const r = element.rect;
    if (r) body += `- **Rect:** x=${r.x} y=${r.y} w=${r.width} h=${r.height}\n`;

    if (element.computedStyles && Object.keys(element.computedStyles).length > 0) {
      body += `\n### Computed styles (curated)\n| prop | value |\n|------|-------|\n`;
      for (const [k, v] of Object.entries(element.computedStyles)) {
        body += `| ${k} | ${v} |\n`;
      }
    }

    if (element.outerHTML) {
      body += `\n### outerHTML (truncated)\n\`\`\`html\n${element.outerHTML}\n\`\`\`\n`;
    }
  }

  if (screenshotBasenames.length > 0) {
    body += `\n### Screenshots\n`;
    screenshotBasenames.forEach((p, i) => {
      const kind = payload.screenshots?.[i]?.kind ?? `+${i + 1}`;
      body += `![${kind}](${p})\n`;
    });
  }

  return body;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Write a note to `notesDir` using the provided serial (caller holds the lock).
 * Returns { file, serial } where file is the absolute .md path.
 *
 * The caller (server.ts) must call this inside withSerialLock so that
 * getNextSerial → writeNote is atomic (Pitfall 3 / D-03).
 */
export async function writeNote(
  notesDir: string,
  payload: AnnotationPayload,
  serial: number
): Promise<{ file: string; serial: string }> {
  const ts = localTimestamp();
  const padded = String(serial).padStart(4, '0');
  const base = `${padded}-${ts}`;
  const mdPath = join(notesDir, `${base}.md`);

  // CR-02: Decode/validate ALL screenshots into buffers BEFORE touching disk.
  // A bad dataUrl throws {statusCode:400} here — before any file is written —
  // so there is no partial on-disk state (no orphaned .md, no burned serial).
  const pngBuffers = (payload.screenshots ?? []).map(s => decodePngDataUrl(s.dataUrl));

  // Collect relative screenshot filenames for frontmatter
  const screenshotRelPaths = pngBuffers.map((_, i) => `${base}+${i + 1}.png`);

  // Build and write the .md file
  const frontmatter = buildFrontmatter(payload, serial, screenshotRelPaths);
  const body = buildNoteBody(base, payload);
  await writeFile(mdPath, frontmatter + body, 'utf8');

  // Write each decoded PNG buffer next to the .md
  for (let i = 0; i < pngBuffers.length; i++) {
    const pngPath = join(notesDir, `${base}+${i + 1}.png`);
    await writeFile(pngPath, pngBuffers[i]);
  }

  return { file: mdPath, serial: padded };
}
