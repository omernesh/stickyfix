# Cross-Browser Packaging Guide

> **v1.0 support status:** Microsoft Edge is fully supported as a Chromium drop-in —
> no extra build steps required. Firefox and Safari packaging paths are documented
> here for reference and are tracked as **FUT-01** (v2 scope); neither is built,
> tested, or shipped in v1.0.

---

## Microsoft Edge — supported now

Edge is a Chromium-based browser and a complete drop-in for stickyfix. No separate
build is needed; the same `.output/chrome-mv3/` artifact that works in Chrome loads
directly in Edge.

### Native-messaging manifest registration

The `npx stickyfix init` bootstrapper registers the native-messaging manifest in both
Chrome and Edge locations on all platforms so a single install covers both browsers.

**Windows (registry — no admin rights required):**

```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.stickyfix.host
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.stickyfix.host
```

Edge checks the Chrome registry path as a fallback. Writing both keys is the
recommended approach so the extension works regardless of which browser the user
opens first.

**macOS (user-level, no admin rights):**

```
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.stickyfix.host.json
~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.stickyfix.host.json
```

**Linux (user-level):**

```
~/.config/google-chrome/NativeMessagingHosts/com.stickyfix.host.json
~/.config/microsoft-edge/NativeMessagingHosts/com.stickyfix.host.json
```

### Dual-store extension ID caveat

If the extension is published to both the Chrome Web Store and the Microsoft Edge
Add-ons store, each store assigns a distinct extension ID. Both IDs must appear in
the `allowed_origins` array of the native-messaging manifest:

```json
{
  "allowed_origins": [
    "chrome-extension://<CHROME-WEB-STORE-ID>/",
    "chrome-extension://<EDGE-ADD-ONS-STORE-ID>/"
  ]
}
```

Running `npx stickyfix init` again after loading the extension in Edge will prompt
for the Edge extension ID and append it to the manifest automatically.

---

## Firefox (documented path — FUT-01, not built in v1.0)

Firefox supports the WebExtension native-messaging API but uses a **different manifest
key** to identify allowed add-ons. The Chrome and Firefox manifests are **not
interchangeable**.

### Key difference: `allowed_extensions` vs `allowed_origins`

Chrome/Edge use `allowed_origins` (a list of `chrome-extension://<ID>/` URIs).
Firefox uses `allowed_extensions` (a list of add-on IDs such as
`"stickyfix@stickyfix.dev"`). A Chrome manifest placed in a Firefox search path will
cause Firefox to log a warning about the unrecognised `allowed_origins` field and
refuse to connect.

### Firefox manifest format

```json
{
  "name": "com.stickyfix.host",
  "description": "stickyfix native messaging host",
  "path": "/path/to/dist/host/stickyfix-native.cjs",
  "type": "stdio",
  "allowed_extensions": ["stickyfix@stickyfix.dev"]
}
```

The `allowed_extensions` value must match the `browser_specific_settings.gecko.id`
field in the extension's `manifest.json`. Without this field Firefox cannot establish
the add-on's identity, so the native-messaging connection will be refused.

### Firefox manifest locations

**macOS (user-level):**

```
~/Library/Application Support/Mozilla/NativeMessagingHosts/com.stickyfix.host.json
```

**Linux (user-level):**

```
~/.mozilla/native-messaging-hosts/com.stickyfix.host.json
```

**Windows (registry — HKCU, no admin rights):**

```
HKCU\Software\Mozilla\NativeMessagingHosts\com.stickyfix.host
```

The registry value (Default) must point to the absolute path of the manifest JSON
file, matching the pattern used for Chrome/Edge.

**Windows coexistence — distinct filenames.** On Windows the Firefox manifest and
its launcher wrapper live in the same stickyfix data dir as the Chrome ones
(`~/.local/share/stickyfix/`). To let both browsers be installed at once, the
Firefox files use a `.firefox` infix so they never collide with — or get deleted
alongside — the Chrome files:

| File | Chrome | Firefox |
|------|--------|---------|
| On-disk manifest JSON | `com.stickyfix.host.json` | `com.stickyfix.host.firefox.json` |
| Native-host wrapper | `com.stickyfix.host.bat` | `com.stickyfix.host.firefox.bat` |

The Firefox registry value points at `com.stickyfix.host.firefox.json`, whose
`path` field points at `com.stickyfix.host.firefox.bat`. Because the wrapper is a
separate file, `npx stickyfix uninstall --browser firefox` removes only the
Firefox wrapper and leaves the Chrome wrapper (still referenced by the Chrome
manifest) intact. (On macOS/Linux Firefox uses its own Mozilla directory, so the
manifest keeps the canonical `com.stickyfix.host.json` filename there; only the
wrapper carries the `.firefox` infix to stay paired.)

### Required extension manifest addition

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "stickyfix@stickyfix.dev",
      "strict_min_version": "109.0"
    }
  }
}
```

### v1.0 status

Firefox packaging is **FUT-01** — documented for planning purposes only. No Firefox
build, test run, or Add-ons store submission is included in v1.0. When this work is
scheduled, the bootstrapper will need a `--browser firefox` mode that writes the
separate Firefox manifest to the correct location.

---

## Safari (documented path — FUT-01, not built in v1.0)

Safari web extensions have a fundamentally different architecture from Chrome/Edge and
Firefox. There is no standalone CRX or XPI equivalent that can be sideloaded. The
extension must be bundled inside a macOS (or iOS) application and distributed through
the Mac App Store.

### Architecture overview

| Concept | Chrome/Edge | Safari |
|---------|-------------|--------|
| Extension format | `.crx` / unpacked directory | App bundle containing an extension target |
| Native host | Separate process, registered via manifest | The containing macOS app itself |
| Host communication | stdio + manifest JSON | `SFSafariApplication.dispatchMessage` (same-sandbox) |
| Distribution | Chrome Web Store / sideload | Mac App Store (required) |
| Developer prerequisites | Google account | Xcode + Apple Developer Program ($99/year) |

### Conversion starting point

Apple provides a command-line converter that takes an existing Chrome/Firefox
extension directory and scaffolds an Xcode project:

```bash
xcrun safari-web-extension-converter /path/to/chrome-extension-directory \
  --project-location ./safari-project \
  --app-name "stickyfix" \
  --bundle-identifier dev.stickyfix.app
```

This produces a Swift/Xcode project with:
- A macOS app target (the "native host" equivalent)
- A Safari extension target embedding the converted web extension files
- `Info.plist` entries wiring the two together

### Key differences requiring code changes

1. **No manifest-registered native host.** Communication with the app uses
   `browser.runtime.sendNativeMessage` on the extension side and
   `SFSafariApplication.dispatchMessage` / `SFSafariExtensionHandler` on the Swift
   side. The stdio + 4-byte framing protocol used by Chrome native messaging does not
   apply.

2. **No sideloading.** The converted app must be submitted to the Mac App Store via
   Xcode and TestFlight for distribution. There is no equivalent of "Load unpacked"
   for production Safari extensions.

3. **App Store review.** Each update requires an App Store review cycle (typically
   1–3 days). Rapid iteration during development is possible via TestFlight but not
   via direct file distribution.

4. **Token pairing.** The existing `npx stickyfix init` native-messaging registration
   path does not apply to Safari. A new pairing mechanism using
   `SFSafariApplication.dispatchMessage` would need to be designed.

### v1.0 status

Safari packaging is **FUT-01** — documented for planning purposes only. No Safari
build, Xcode project, or App Store submission is included in v1.0. The converter
output is a useful starting point when this work is scheduled, but significant
Swift/Xcode work is required beyond the initial scaffold.

---

## Summary table

| Browser | v1.0 status | Build needed | Extra manifest key | Distribution path |
|---------|-------------|--------------|-------------------|-------------------|
| Chrome | Supported | No | `allowed_origins` | Chrome Web Store / sideload |
| Edge | Supported | No | `allowed_origins` (both store IDs) | Edge Add-ons / sideload |
| Firefox | FUT-01 (docs only) | Yes (API gaps) | `allowed_extensions` | Firefox Add-ons (AMO) |
| Safari | FUT-01 (docs only) | Yes (Xcode app) | N/A (app-bundled) | Mac App Store |
