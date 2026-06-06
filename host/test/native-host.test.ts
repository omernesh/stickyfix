/**
 * Tests for native-msg.ts stdio framing.
 * ONB-02 dependency: proves 4-byte LE framing is lossless + chunk-safe + Buffer-only.
 *
 * Analog: host/test/config.test.ts (describe/test.before/test.after/tmpdir/throws shape)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodeNativeMessage,
  decodeNativeMessages,
  sendNativeMessage,
} from '../src/native-msg.js';
import { validateChosenFolder, handlePickFolder } from '../src/native-host.js';

// ---------------------------------------------------------------------------
// encodeNativeMessage
// ---------------------------------------------------------------------------

describe('encodeNativeMessage', () => {
  test('returns a Buffer', () => {
    const buf = encodeNativeMessage({ type: 'TEST' });
    assert.ok(Buffer.isBuffer(buf));
  });

  test('first 4 bytes are UInt32LE JSON byte length', () => {
    const obj = { type: 'HELLO', value: 42 };
    const json = JSON.stringify(obj);
    const jsonLen = Buffer.byteLength(json, 'utf8');
    const buf = encodeNativeMessage(obj);
    assert.strictEqual(buf.readUInt32LE(0), jsonLen);
  });

  test('remaining bytes are valid UTF-8 JSON equal to stringify', () => {
    const obj = { type: 'HELLO', value: 42 };
    const json = JSON.stringify(obj);
    const buf = encodeNativeMessage(obj);
    const jsonSlice = buf.slice(4).toString('utf8');
    assert.strictEqual(jsonSlice, json);
  });

  test('total length = 4 + byte length of JSON', () => {
    const obj = { type: 'HELLO', unicode: 'éà' };
    const json = JSON.stringify(obj);
    const jsonLen = Buffer.byteLength(json, 'utf8');
    const buf = encodeNativeMessage(obj);
    assert.strictEqual(buf.length, 4 + jsonLen);
  });
});

// ---------------------------------------------------------------------------
// decodeNativeMessages
// ---------------------------------------------------------------------------

describe('decodeNativeMessages', () => {
  test('round-trip: encodeNativeMessage -> decodeNativeMessages yields [obj] with empty rest', () => {
    const obj = { type: 'PING', seq: 1 };
    const encoded = encodeNativeMessage(obj);
    const { messages, rest } = decodeNativeMessages(encoded);
    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(messages[0], obj);
    assert.strictEqual(rest.length, 0);
  });

  test('two concatenated frames yields both objects', () => {
    const a = { type: 'A' };
    const b = { type: 'B', x: 99 };
    const combined = Buffer.concat([encodeNativeMessage(a), encodeNativeMessage(b)]);
    const { messages, rest } = decodeNativeMessages(combined);
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(messages[0], a);
    assert.deepStrictEqual(messages[1], b);
    assert.strictEqual(rest.length, 0);
  });

  test('partial message (header only) returns zero messages and full buffer as rest', () => {
    const obj = { type: 'PARTIAL' };
    const full = encodeNativeMessage(obj);
    // Only give 4 bytes (just the header, no body)
    const headerOnly = full.slice(0, 4);
    const { messages, rest } = decodeNativeMessages(headerOnly);
    assert.strictEqual(messages.length, 0);
    assert.strictEqual(rest.length, 4);
    assert.deepStrictEqual(rest, headerOnly);
  });

  test('buffer split mid-message returns zero messages and full buffer as rest', () => {
    const obj = { type: 'SPLIT', data: 'hello world' };
    const full = encodeNativeMessage(obj);
    // Give header + half the body
    const half = full.slice(0, Math.floor(full.length / 2));
    const { messages, rest } = decodeNativeMessages(half);
    assert.strictEqual(messages.length, 0);
    assert.strictEqual(rest.length, half.length);
    assert.deepStrictEqual(rest, half);
  });

  test('exactly 3 bytes (less than header) returns zero messages', () => {
    const buf = Buffer.from([0x05, 0x00, 0x00]); // only 3 bytes, incomplete header
    const { messages, rest } = decodeNativeMessages(buf);
    assert.strictEqual(messages.length, 0);
    assert.strictEqual(rest.length, 3);
  });

  test('empty buffer returns zero messages and empty rest', () => {
    const { messages, rest } = decodeNativeMessages(Buffer.alloc(0));
    assert.strictEqual(messages.length, 0);
    assert.strictEqual(rest.length, 0);
  });

  test('malformed JSON is skipped (swallowed) and buffer advances', () => {
    // Build a frame with invalid JSON content
    const bad = Buffer.from('NOT_JSON_AT_ALL', 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bad.length, 0);
    const frame = Buffer.concat([header, bad]);
    const { messages, rest } = decodeNativeMessages(frame);
    // Malformed JSON is swallowed — zero messages, no remainder
    assert.strictEqual(messages.length, 0);
    assert.strictEqual(rest.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Chunk reassembly: one byte at a time
// ---------------------------------------------------------------------------

describe('chunk reassembly — one byte at a time', () => {
  test('feeding one byte at a time yields exactly one message after final byte', () => {
    const obj = { type: 'CHUNKED', idx: 7 };
    const full = encodeNativeMessage(obj);

    let accumulated = Buffer.alloc(0);
    let messagesFound: unknown[] = [];

    for (let i = 0; i < full.length; i++) {
      accumulated = Buffer.concat([accumulated, full.slice(i, i + 1)]);
      const { messages, rest } = decodeNativeMessages(accumulated);
      messagesFound = messagesFound.concat(messages);
      accumulated = Buffer.from(rest);

      if (i < full.length - 1) {
        // Before the last byte: no complete message yet
        assert.strictEqual(
          messagesFound.length,
          0,
          `Expected 0 messages after byte ${i}, got ${messagesFound.length}`
        );
      }
    }

    // After all bytes: exactly one message
    assert.strictEqual(messagesFound.length, 1);
    assert.deepStrictEqual(messagesFound[0], obj);
    assert.strictEqual(accumulated.length, 0);
  });
});

// ---------------------------------------------------------------------------
// sendNativeMessage — Buffer-only output (Pitfall 2)
// ---------------------------------------------------------------------------

describe('sendNativeMessage — Buffer-only write', () => {
  let tmpRoot: string;

  test.before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sfx-native-msg-test-'));
  });

  test.after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('produces bytes equal to encodeNativeMessage via fake writable', () => {
    const obj = { type: 'WRITE_TEST', value: 'hello' };
    const expected = encodeNativeMessage(obj);

    // Fake writable that captures all writes
    const written: Uint8Array[] = [];
    const fakeOut = {
      write(b: Uint8Array | string): boolean {
        written.push(Buffer.isBuffer(b) ? b : Buffer.from(b as string, 'utf8'));
        return true;
      },
    };

    sendNativeMessage(obj, fakeOut as unknown as NodeJS.WritableStream);

    assert.strictEqual(written.length, 1, 'sendNativeMessage should call write exactly once');
    assert.ok(Buffer.isBuffer(written[0]), 'write must be called with a Buffer (not a string) — Pitfall 2');
    assert.deepStrictEqual(Buffer.from(written[0]), expected);
  });

  test('write is called exactly once (single atomic Buffer.concat write)', () => {
    const obj = { type: 'ATOMIC', data: [1, 2, 3] };
    const calls: unknown[] = [];
    const fakeOut = {
      write(b: unknown): boolean {
        calls.push(b);
        return true;
      },
    };

    sendNativeMessage(obj, fakeOut as unknown as NodeJS.WritableStream);
    assert.strictEqual(calls.length, 1, 'Must write header+body in ONE Buffer.concat call');
  });
});

// ---------------------------------------------------------------------------
// PICK_FOLDER validation + dispatch (Plan 09-04, T-09-14 / ONB-04)
// ---------------------------------------------------------------------------

/** Capture a single FOLDER_PICKED frame written by handlePickFolder. */
function captureFrame(): {
  out: { write(b: Buffer): boolean };
  read(): { type?: string; origin?: string; folder?: string | null } | null;
} {
  const written: Buffer[] = [];
  const out = {
    write(b: Buffer): boolean {
      written.push(Buffer.from(b));
      return true;
    },
  };
  return {
    out,
    read() {
      if (written.length === 0) return null;
      const { messages } = decodeNativeMessages(Buffer.concat(written));
      return (messages[0] as { type?: string; origin?: string; folder?: string | null }) ?? null;
    },
  };
}

describe('validateChosenFolder — defensive path validation (T-09-14)', () => {
  let realDir: string;

  test.before(() => {
    realDir = mkdtempSync(join(tmpdir(), 'sfx-pickfolder-test-'));
  });

  test.after(() => {
    rmSync(realDir, { recursive: true, force: true });
  });

  test('null input → null (user cancelled)', () => {
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

  test('a real existing directory → the normalized absolute path', () => {
    const result = validateChosenFolder(realDir);
    assert.ok(result, 'expected a non-null folder for a real directory');
    // Compare via resolve to be path-separator tolerant
    assert.strictEqual(result, join(realDir));
  });

  test('a system directory → null (deny-list rejection)', () => {
    if (process.platform === 'win32') {
      assert.strictEqual(validateChosenFolder('C:\\Windows', 'win32'), null);
      assert.strictEqual(validateChosenFolder('C:\\Program Files', 'win32'), null);
      // Case-insensitive on win32
      assert.strictEqual(validateChosenFolder('c:\\windows', 'win32'), null);
    } else {
      assert.strictEqual(validateChosenFolder('/etc', 'linux'), null);
      assert.strictEqual(validateChosenFolder('/', 'linux'), null);
      assert.strictEqual(validateChosenFolder('/usr', 'linux'), null);
    }
  });
});

describe('handlePickFolder — FOLDER_PICKED frame shape (ONB-04)', () => {
  let realDir: string;

  test.before(() => {
    realDir = mkdtempSync(join(tmpdir(), 'sfx-handlepick-test-'));
  });

  test.after(() => {
    rmSync(realDir, { recursive: true, force: true });
  });

  test('valid chosen directory → FOLDER_PICKED with origin echoed + folder set', async () => {
    const cap = captureFrame();
    await handlePickFolder('https://example.com', async () => realDir, process.platform, cap.out);
    const frame = cap.read();
    assert.ok(frame, 'expected a FOLDER_PICKED frame');
    assert.strictEqual(frame.type, 'FOLDER_PICKED');
    assert.strictEqual(frame.origin, 'https://example.com');
    assert.strictEqual(frame.folder, join(realDir));
  });

  test('cancelled pick (pickFolder resolves null) → folder:null, origin echoed', async () => {
    const cap = captureFrame();
    await handlePickFolder('https://example.com', async () => null, process.platform, cap.out);
    const frame = cap.read();
    assert.ok(frame);
    assert.strictEqual(frame.type, 'FOLDER_PICKED');
    assert.strictEqual(frame.origin, 'https://example.com');
    assert.strictEqual(frame.folder, null);
  });

  test('pick resolves a system directory → folder:null (deny-list)', async () => {
    const sysDir = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    const cap = captureFrame();
    await handlePickFolder('https://evil.example', async () => sysDir, process.platform, cap.out);
    const frame = cap.read();
    assert.ok(frame);
    assert.strictEqual(frame.type, 'FOLDER_PICKED');
    assert.strictEqual(frame.origin, 'https://evil.example');
    assert.strictEqual(frame.folder, null, 'system directory must be rejected to null');
  });
});
