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
    // @ts-ignore — valid MV3 key; WXT 0.20.x types do not include this field yet (A1)
    optional_host_permissions: ['<all_urls>'],
    // Note: no static content_scripts — review UI is injected on-demand via
    // chrome.scripting.executeScript (D-04 / EXT-02)
  },
});
