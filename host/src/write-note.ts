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

/**
 * Validate the data:image/png;base64, prefix and decode to a Buffer (Pattern 7).
 * Throws an error with statusCode 400 if the prefix is wrong.
 */
export function decodePngDataUrl(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(PNG_PREFIX)) {
    throw Object.assign(
      new Error('Invalid screenshot mime: expected data:image/png;base64,'),
      { statusCode: 400 }
    );
  }
  return Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the YAML frontmatter block per PRD §9.2 (Pattern 8).
 * selector + react_component ONLY for element mode (D-11).
 */
export function buildFrontmatter(
  base: string,
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

  // Collect relative screenshot filenames for frontmatter
  const screenshotRelPaths = (payload.screenshots ?? []).map((_, i) => `${base}+${i + 1}.png`);

  // Build and write the .md file
  const frontmatter = buildFrontmatter(base, payload, serial, screenshotRelPaths);
  const body = buildNoteBody(base, payload);
  await writeFile(mdPath, frontmatter + body, 'utf8');

  // Decode and write each PNG next to the .md
  for (let i = 0; i < (payload.screenshots ?? []).length; i++) {
    const screenshot = payload.screenshots![i];
    const pngBuf = decodePngDataUrl(screenshot.dataUrl);
    const pngPath = join(notesDir, `${base}+${i + 1}.png`);
    await writeFile(pngPath, pngBuf);
  }

  return { file: mdPath, serial: padded };
}
