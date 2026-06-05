/**
 * deriveExtensionId — deterministic Chrome extension ID derivation from a
 * base64-encoded SPKI/DER public key (the same value used in manifest.json `key`).
 *
 * Algorithm (Phase 9 / RESEARCH Pattern 3):
 *   1. Base64-decode the manifest `key` field to get DER bytes.
 *   2. SHA-256 hash the DER bytes.
 *   3. Take the first 16 bytes (= first 32 hex nibbles).
 *   4. Map each nibble 0-f to the letter a-p  (0→a, 1→b, … 9→j, a→k, … f→p).
 *
 * This matches how Chrome computes the extension ID from the key field.
 * [VERIFIED: developer.chrome.com/docs/extensions/reference/manifest/key]
 *
 * Node builtins only — no WXT, no Chrome imports.
 */

import { createHash } from 'node:crypto';

/**
 * The stable extension ID derived from the committed public key in wxt.config.ts.
 * Generated during Phase 9 bootstrapping (2026-06-05).
 * Private key is at .keys/stickyfix-extension.pem (gitignored).
 *
 * If you regenerate the keypair, update wxt.config.ts `key` field AND this constant.
 */
export const STABLE_EXTENSION_ID = 'ccdfmbhdcafhmnnnfjpbhgebfkfgjgca';

/**
 * The base64 SPKI/DER public key matching STABLE_EXTENSION_ID.
 * Committed in wxt.config.ts `key` field and stored in .keys/manifest-key.txt.
 */
export const MANIFEST_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1RFrtpIlsiHwm21+ISi8v5381HQeJq2pw4lgbvqQ2a6o2uZ6H1uHfT+1xRy2msqHzXMOJOhwfAKuwBoebATIFDcms132Msz11DJPHUgoVX29sh9PWxUN5aJ/KovtPgIXoEDTKg/QtV+C9Hza0bcdncqymi9xBw5De/rRn/ZQdkXx2ZFiIm6AuHE0Q4dJrSPLqRLEFxP7mf+/SNPQ0LGDYsWUBbDLz8ksMU0VrrDDtRbDSPhBglxNzVYv00MYpwPEHijBCG9wQ57a34tDuA2/TFvNSwpbkWIYiGe6GyN5DvVHdIZgHcmTxSoY43Xu8EAvX+isRp3DdK8j3tAx1C/wIwIDAQAB';

/**
 * Derive the Chrome extension ID from a base64-encoded SPKI/DER public key.
 *
 * @param publicKeyBase64 - Base64-encoded DER/SPKI public key (the manifest `key` value).
 * @returns 32-character lowercase extension ID using the a-p alphabet.
 *
 * @example
 * const id = deriveExtensionId(MANIFEST_PUBLIC_KEY);
 * // → 'ccdfmbhdcafhmnnnfjpbhgebfkfgjgca'
 */
export function deriveExtensionId(publicKeyBase64: string): string {
  const derBytes = Buffer.from(publicKeyBase64, 'base64');
  const hash = createHash('sha256').update(derBytes).digest('hex');
  // Take first 32 hex nibbles (16 bytes) and map 0-f → a-p
  return hash
    .slice(0, 32)
    .split('')
    .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
    .join('');
}
