/**
 * Native messaging stdio framing for stickyfix.
 * Implements the Chrome native messaging wire protocol:
 *   4-byte UInt32LE JSON byte length + UTF-8 JSON body.
 *
 * ONB-02: framing must be lossless and chunk-safe.
 * Pitfall 2: ALL stdout writes MUST use Buffer (never string) to avoid
 *   Windows text-mode \n→\r\n corruption of the binary length field.
 *
 * Node builtins only — no WXT, no Chrome imports.
 */

// ---------------------------------------------------------------------------
// encodeNativeMessage
// ---------------------------------------------------------------------------

/**
 * Encode a message object into the Chrome native messaging wire format:
 * [4 bytes: UInt32LE JSON byte length][N bytes: UTF-8 JSON]
 *
 * Returns a single Buffer containing both header and body (one alloc).
 */
export function encodeNativeMessage(msg: object): Buffer {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

// ---------------------------------------------------------------------------
// decodeNativeMessages
// ---------------------------------------------------------------------------

/**
 * Decode zero or more complete native-messaging frames from `buf`.
 *
 * Returns:
 *   - `messages`: array of decoded objects for all complete frames found
 *   - `rest`: the unconsumed tail of `buf` (may be empty or a partial frame)
 *
 * Malformed JSON frames are swallowed (the buffer is advanced past them
 * so a bad frame does not stall the reader — RESEARCH Pattern 2).
 */
export function decodeNativeMessages(buf: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let pos = 0;

  while (buf.length - pos >= 4) {
    const msgLen = buf.readUInt32LE(pos);
    if (buf.length - pos < 4 + msgLen) {
      // Frame is incomplete — stop here, return remainder
      break;
    }

    const jsonSlice = buf.slice(pos + 4, pos + 4 + msgLen).toString('utf8');
    pos += 4 + msgLen;

    try {
      messages.push(JSON.parse(jsonSlice));
    } catch {
      // Malformed JSON — swallow and continue (do not stall reader)
    }
  }

  return { messages, rest: pos > 0 ? buf.slice(pos) : buf };
}

// ---------------------------------------------------------------------------
// sendNativeMessage
// ---------------------------------------------------------------------------

/**
 * Write one native message to `out` (defaults to process.stdout).
 *
 * CRITICAL (Pitfall 2): writes the combined header+body as a single Buffer
 * via Buffer.concat — NEVER passes a string to out.write(). On Windows,
 * string writes go through text-mode I/O which translates \n → \r\n and
 * corrupts the binary length prefix.
 */
export function sendNativeMessage(
  msg: object,
  out: { write(b: Buffer): boolean } = process.stdout as unknown as { write(b: Buffer): boolean },
): void {
  out.write(encodeNativeMessage(msg));
}

// ---------------------------------------------------------------------------
// readNativeMessages
// ---------------------------------------------------------------------------

/**
 * Attach to `inp` (defaults to process.stdin) and call `onMessage` for each
 * fully decoded native-messaging frame received.
 *
 * Accumulates chunks into a module-local Buffer, draining complete frames via
 * decodeNativeMessages after every data event.  Calls process.exit(0) when
 * stdin closes (per Chrome native messaging lifecycle — 'end' = Chrome closed
 * the pipe, native host should terminate).
 */
export function readNativeMessages(
  onMessage: (msg: unknown) => void,
  inp: NodeJS.ReadableStream = process.stdin,
): void {
  let buf: Buffer = Buffer.alloc(0);

  inp.on('data', (chunk: Uint8Array) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, rest } = decodeNativeMessages(buf);
    buf = Buffer.from(rest);
    for (const msg of messages) {
      onMessage(msg);
    }
  });

  inp.on('end', () => {
    process.exit(0);
  });
}
