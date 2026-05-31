import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'stickyfix',
    description: 'Pin sticky notes on any page — your AI reads them.',
    version: '0.1.0',
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
    // Phase 3 additions — D-04 / EXT-01
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
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
