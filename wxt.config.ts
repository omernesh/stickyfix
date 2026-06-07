import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'stickyfix',
    description: 'Pin sticky notes on any page — your AI reads them.',
    version: '1.0.0',
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
    // Phase 3 additions — D-04 / EXT-01
    // Phase 9 addition — ONB-02/03: native messaging for auto-pairing (extension-only API)
    permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'nativeMessaging'],
    // Stable extension ID (Phase 9 enhancement): base64 SPKI/DER public key.
    // Generated with Node crypto.generateKeyPairSync('rsa',{modulusLength:2048}).
    // Private key is in .keys/stickyfix-extension.pem (gitignored — needed only for CWS publish).
    // Derived extension ID: ccdfmbhdcafhmnnnfjpbhgebfkfgjgca
    // To re-derive: sha256(DER-public-key-bytes)[0..15] → hex → map 0-9a-f to a-p
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1RFrtpIlsiHwm21+ISi8v5381HQeJq2pw4lgbvqQ2a6o2uZ6H1uHfT+1xRy2msqHzXMOJOhwfAKuwBoebATIFDcms132Msz11DJPHUgoVX29sh9PWxUN5aJ/KovtPgIXoEDTKg/QtV+C9Hza0bcdncqymi9xBw5De/rRn/ZQdkXx2ZFiIm6AuHE0Q4dJrSPLqRLEFxP7mf+/SNPQ0LGDYsWUBbDLz8ksMU0VrrDDtRbDSPhBglxNzVYv00MYpwPEHijBCG9wQ57a34tDuA2/TFvNSwpbkWIYiGe6GyN5DvVHdIZgHcmTxSoY43Xu8EAvX+isRp3DdK8j3tAx1C/wIwIDAQAB',
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
    optional_host_permissions: ['<all_urls>'],
    // Note: no static content_scripts — review UI is injected on-demand via
    // chrome.scripting.executeScript (D-04 / EXT-02)
  },
  hooks: {
    // CR-01: WXT hoists web_accessible_resources[].matches into host_permissions,
    // including the '<all_urls>' pattern from the runtime content-script CSS.
    // PRD §7.1 mandates host_permissions contain ONLY localhost at install time;
    // '<all_urls>' must be requested on demand via optional_host_permissions.
    // Strip it here after WXT's manifest generation so the grant model is correct.
    'build:manifestGenerated'(_wxt, manifest) {
      manifest.host_permissions = (manifest.host_permissions ?? [])
        .filter((p: string) => p !== '<all_urls>');
    },
  },
});
