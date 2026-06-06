/**
 * Native-messaging manifest writer, per-OS path resolver, Windows registry
 * registration, uninstall enumerator, and desktop launcher creator for stickyfix.
 *
 * Node builtins only — no WXT, no Chrome imports.
 *
 * Security:
 * - T-09-02: buildManifest resolves an ABSOLUTE path (Pitfall 4)
 * - T-09-03: Windows registry writes use HKCU (Pitfall 5), execFileSync (never exec)
 * - T-09-05: enumerateArtifacts lists every init-created artifact (ONB-05)
 * - Launcher shortcut: execFile(powershell, [argArray]) — NEVER exec or shell interpolation
 *
 * Analog: host/src/config.ts (mkdirSync/writeFileSync/existsSync/rmSync patterns)
 */

import { mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isInsideDir } from '../security.js';

// The native host name — must match the manifest JSON `name` field and the
// value passed to chrome.runtime.sendNativeMessage in background.ts.
const NATIVE_HOST_NAME = 'com.stickyfix.host';
const MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`;

// Native-messaging launcher wrapper file names. On Windows, Chrome launches the
// native host via CreateProcess, which cannot execute a .cjs directly — so the
// manifest must point at a wrapper that runs `node <abs cjs>`.
const NATIVE_WRAPPER_WIN = `${NATIVE_HOST_NAME}.bat`;
const NATIVE_WRAPPER_NIX = `${NATIVE_HOST_NAME}.sh`;

// Chrome/Edge registry key prefixes (Windows HKCU — Pitfall 5: never HKLM)
const REG_CHROME_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
const REG_EDGE_KEY = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

// Config file location (read by native host at startup)
const CONFIG_DIR = (home: string) => join(home, '.config', 'stickyfix');
const CONFIG_PATH = (home: string) => join(CONFIG_DIR(home), 'config.json');

// Launcher file names used across functions
const LAUNCHER_BATCH_FILENAME = 'stickyfix-host.bat';
const LAUNCHER_VBS_FILENAME = 'stickyfix-host.vbs';
const LAUNCHER_LNK_FILENAME = 'Stickyfix Host.lnk';
const LAUNCHER_COMMAND_FILENAME = 'stickyfix-host.command';
const LAUNCHER_DESKTOP_FILENAME = 'stickyfix-host.desktop';
const LAUNCHER_SH_FILENAME = 'stickyfix-host.sh';

// ---------------------------------------------------------------------------
// nativeManifestPath — per-OS path resolver
// ---------------------------------------------------------------------------

/**
 * Return the absolute path where the native-messaging manifest JSON should
 * be written for the given platform and home directory.
 *
 * Paths verified via Chrome + Edge native-messaging docs (RESEARCH Pattern 4):
 *   darwin: ~/Library/App Support/Google/Chrome/NativeMessagingHosts/
 *   linux:  ~/.config/google-chrome/NativeMessagingHosts/
 *   win32:  ~/.local/share/stickyfix/  (manifest only; registry key written separately)
 */
export function nativeManifestPath(
  plat: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  switch (plat) {
    case 'darwin':
      return join(
        home,
        'Library',
        'Application Support',
        'Google',
        'Chrome',
        'NativeMessagingHosts',
        MANIFEST_FILENAME,
      );
    case 'linux':
      return join(home, '.config', 'google-chrome', 'NativeMessagingHosts', MANIFEST_FILENAME);
    case 'win32':
      return join(home, '.local', 'share', 'stickyfix', MANIFEST_FILENAME);
    default:
      throw new Error(`Unsupported platform: ${plat}`);
  }
}

// ---------------------------------------------------------------------------
// nativeWrapperPath / writeNativeWrapper — native-messaging launcher wrapper
// ---------------------------------------------------------------------------

/**
 * Return the path of the native-messaging launcher wrapper, in the SAME
 * directory as the manifest. On win32 a .bat, otherwise a .sh.
 */
export function nativeWrapperPath(
  plat: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const dir = dirname(nativeManifestPath(plat, home));
  return join(dir, plat === 'win32' ? NATIVE_WRAPPER_WIN : NATIVE_WRAPPER_NIX);
}

/**
 * Write the per-OS launcher wrapper that runs `node <abs cjs>`, returning its
 * path. Chrome's CreateProcess (Windows) cannot execute a .cjs directly; the
 * manifest must point at this wrapper instead of the raw .cjs.
 *
 * Security: `abs` is a developer-controlled absolute path (no user input);
 * this is a file write, not exec — no injection vector.
 */
export function writeNativeWrapper(
  hostBinPath: string,
  plat: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const wrapperPath = nativeWrapperPath(plat, home);
  mkdirSync(dirname(wrapperPath), { recursive: true });
  const abs = resolve(hostBinPath);

  if (plat === 'win32') {
    const content = `@echo off\r\n"node" "${abs}" %*\r\n`;
    writeFileSync(wrapperPath, content, { encoding: 'utf8' });
  } else {
    const content = `#!/bin/sh\nexec node "${abs}" "$@"\n`;
    writeFileSync(wrapperPath, content, { encoding: 'utf8', mode: 0o755 });
  }

  return wrapperPath;
}

// ---------------------------------------------------------------------------
// launcherDir — where launcher files are stored (alongside the manifest on win32)
// ---------------------------------------------------------------------------

/**
 * Return the directory where launcher files (batch, .command, .desktop) are written.
 * On win32: ~/.local/share/stickyfix/ (same dir as the manifest)
 * On darwin/linux: ~/.config/stickyfix/
 */
export function launcherDir(
  plat: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (plat === 'win32') {
    return join(home, '.local', 'share', 'stickyfix');
  }
  return join(home, '.config', 'stickyfix');
}

// ---------------------------------------------------------------------------
// launcherPaths — per-OS launcher file paths
// ---------------------------------------------------------------------------

export interface LauncherPaths {
  /** Primary launcher file (batch on win32, .command on darwin, .sh on linux) */
  launcher: string;
  /** Desktop shortcut (.lnk on win32, absent on other platforms) */
  shortcut: string | null;
  /** .desktop entry (linux only) */
  desktopEntry: string | null;
}

/**
 * Return the expected paths of all launcher files for the given platform.
 * These paths are used by both createLauncherFiles and enumerateArtifacts.
 */
export function getLauncherPaths(
  plat: NodeJS.Platform = process.platform,
  home: string = homedir(),
): LauncherPaths {
  const dir = launcherDir(plat, home);

  if (plat === 'win32') {
    return {
      launcher: join(dir, LAUNCHER_BATCH_FILENAME),
      shortcut: join(home, 'Desktop', LAUNCHER_LNK_FILENAME),
      desktopEntry: null,
    };
  }

  if (plat === 'darwin') {
    return {
      launcher: join(dir, LAUNCHER_COMMAND_FILENAME),
      shortcut: null,
      desktopEntry: null,
    };
  }

  // linux
  return {
    launcher: join(dir, LAUNCHER_SH_FILENAME),
    shortcut: null,
    desktopEntry: join(home, '.local', 'share', 'applications', LAUNCHER_DESKTOP_FILENAME),
  };
}

// ---------------------------------------------------------------------------
// buildManifest — manifest object builder
// ---------------------------------------------------------------------------

/** Regex: exactly 32 lowercase a-p characters (Chrome extension ID alphabet) */
const EXT_ID_RE = /^[a-p]{32}$/;

/**
 * Build a Chrome native-messaging manifest object for the given extension ID
 * and host binary path.
 *
 * - hostBinPath is resolved to an ABSOLUTE path (Pitfall 4).
 * - extensionId must be exactly 32 lowercase a-p chars; throws otherwise.
 * - allowed_origins contains exactly one entry: `chrome-extension://<id>/`.
 */
export function buildManifest(extensionId: string, hostBinPath: string): object {
  if (!EXT_ID_RE.test(extensionId)) {
    throw new Error(
      `Invalid extension ID "${extensionId}": must be exactly 32 lowercase a-p characters.`
    );
  }

  const absPath = resolve(hostBinPath);

  return {
    name: NATIVE_HOST_NAME,
    description: 'stickyfix native messaging host',
    path: absPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

// ---------------------------------------------------------------------------
// writeManifest — write manifest JSON to disk
// ---------------------------------------------------------------------------

/**
 * Write the manifest object to `manifestPath`, creating parent directories
 * if needed. Mode 0o644 (non-credential — readable by Chrome process).
 *
 * Analog: ensureNotesDir (mkdirSync recursive) + writeTokenFile pattern.
 */
export function writeManifest(manifest: object, manifestPath: string): void {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), {
    encoding: 'utf8',
    mode: 0o644,
  });
}

// ---------------------------------------------------------------------------
// createLauncherFiles — per-OS desktop launcher for the HTTP host
// ---------------------------------------------------------------------------

export interface LauncherOptions {
  /** Absolute path to the host entry JS (e.g. dist/host/src/index.js) */
  hostEntryPath: string;
  /** Absolute path to the project root folder */
  root: string;
  /** HTTP port the host should use (or undefined to let host auto-scan) */
  port?: number;
  /** Absolute path to the 128px icon PNG (used for Windows .lnk shortcut) */
  iconPath?: string;
  plat?: NodeJS.Platform;
  home?: string;
}

export interface LauncherResult {
  /** Paths of files successfully written */
  written: string[];
  /** Non-fatal warnings (e.g. shortcut creation failed) */
  warnings: string[];
}

/**
 * Create a double-click launcher that starts the HTTP host backend,
 * so the user never has to open a terminal.
 *
 * Windows: writes stickyfix-host.bat in the stickyfix data dir, then creates
 * a Desktop shortcut (.lnk) pointing at that batch file. If the .lnk creation
 * fails, the batch file alone is the acceptable fallback.
 *
 * macOS: writes an executable stickyfix-host.command (bash script).
 *
 * Linux: writes stickyfix-host.sh + a .desktop entry.
 *
 * Security: the ONLY subprocess allowed is the Windows .lnk creation via
 * execFile(powershell, [argArray]) — mirroring folder-picker.ts safety exactly.
 * No user-controlled values are interpolated into the PowerShell script string;
 * all paths are developer-controlled absolute paths validated before use.
 *
 * Node builtins only (fs, child_process.execFile).
 */
export function createLauncherFiles(opts: LauncherOptions): LauncherResult {
  const plat = opts.plat ?? process.platform;
  const home = opts.home ?? homedir();
  const written: string[] = [];
  const warnings: string[] = [];

  const paths = getLauncherPaths(plat, home);
  const launcherDirPath = launcherDir(plat, home);
  mkdirSync(launcherDirPath, { recursive: true });

  const nodeCmd = 'node';
  const hostEntry = opts.hostEntryPath;
  const rootArg = opts.root;
  const portArg = opts.port !== undefined ? ` --port ${opts.port}` : '';

  if (plat === 'win32') {
    // Write batch file — plain text, no exec required
    const batchContent = [
      '@echo off',
      `rem Stickyfix HTTP host launcher — double-click to start the backend`,
      `rem Generated by: npx stickyfix init`,
      `rem Root: ${rootArg}`,
      ``,
      `"${nodeCmd}" "${hostEntry}" --root "${rootArg}"${portArg}`,
      `if %ERRORLEVEL% NEQ 0 pause`,
    ].join('\r\n');

    const batchPath = paths.launcher;
    writeFileSync(batchPath, batchContent, { encoding: 'utf8' });
    written.push(batchPath);

    // Write a VBScript that launches the host HIDDEN (no console window) and
    // shows an auto-dismissing native Windows dialog confirming it's running.
    // VBS string-literal escaping: a literal " is doubled ("").
    const vq = (s: string) => s.replace(/"/g, '""');
    const vbsHostEntry = vq(hostEntry);
    const vbsRoot = vq(rootArg);
    const vbsPortArg = opts.port !== undefined ? ` --port ${opts.port}` : '';
    const vbsContent = [
      'Option Explicit',
      'Dim sh, fso, hostEntry, root, portFile, msg, port, f',
      'Set sh = CreateObject("WScript.Shell")',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      `hostEntry = "${vbsHostEntry}"`,
      `root = "${vbsRoot}"`,
      "' Launch the host hidden (window style 0), do not wait",
      `sh.Run "cmd /c node """ & hostEntry & """ --root """ & root & """${vbsPortArg}", 0, False`,
      "' Give it a moment to bind and write the port file",
      'WScript.Sleep 1800',
      'msg = "Stickyfix host is running." & vbCrLf & vbCrLf & "You can start dropping notes."',
      'portFile = root & "\\.stickyfix-port"',
      'If fso.FileExists(portFile) Then',
      '  Set f = fso.OpenTextFile(portFile, 1)',
      '  port = Trim(f.ReadAll)',
      '  f.Close',
      '  If Len(port) > 0 Then msg = "Stickyfix host is running on port " & port & "." & vbCrLf & vbCrLf & "You can start dropping notes."',
      'End If',
      'sh.Popup msg, 5, "Stickyfix", 64',
    ].join('\r\n');

    const vbsPath = join(launcherDir(plat, home), LAUNCHER_VBS_FILENAME);
    writeFileSync(vbsPath, vbsContent, { encoding: 'utf8' });
    written.push(vbsPath);

    // Create Desktop shortcut (.lnk) via PowerShell WScript.Shell.
    // The shortcut launches the VBS via wscript.exe so the console stays HIDDEN.
    // Security: ALL paths are developer-controlled absolute strings — no user input.
    // execFile (not exec) — no shell spawned, no injection vector.
    // If this fails for any reason, fall through to the warning (batch file is the fallback).
    if (paths.shortcut) {
      const lnkPath = paths.shortcut;
      const iconPath = opts.iconPath ?? '';

      // Build PowerShell script as a single string — paths passed as PS variables
      // set from the -Command string. No shell metacharacter interpolation from
      // external data; all values are constants determined at registration time.
      // PowerShell single-quote escaping: replace ' with '' in path strings.
      const safeLnkPath = lnkPath.replace(/'/g, "''");
      const safeIconPath = iconPath.replace(/'/g, "''");
      const wscriptPath = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'wscript.exe');
      const safeWscript = wscriptPath.replace(/'/g, "''");
      const safeVbsPath = vbsPath.replace(/'/g, "''");

      const psScript =
        `$ws = New-Object -ComObject WScript.Shell;` +
        `$s = $ws.CreateShortcut('${safeLnkPath}');` +
        `$s.TargetPath = '${safeWscript}';` +
        `$s.Arguments = '"${safeVbsPath}"';` +
        `$s.Description = 'Start the Stickyfix HTTP backend host';` +
        (safeIconPath ? `$s.IconLocation = '${safeIconPath},0';` : '') +
        `$s.Save()`;

      // execFileSync — NEVER exec; arg array is static with respect to user input.
      // Synchronous so init reports the shortcut accurately (the async variant
      // raced existsSync in the CLI and printed a false "skipped" message).
      try {
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psScript],
          { timeout: 15_000, stdio: 'ignore' },
        );
        // Only record the shortcut once it actually exists on disk.
        written.push(lnkPath);
      } catch (err) {
        // Non-fatal: batch file is the acceptable fallback
        warnings.push(
          `Desktop shortcut creation failed (non-fatal): ${String((err as Error).message)}. ` +
          `The batch file at ${batchPath} can be used directly.`
        );
      }
    }

  } else if (plat === 'darwin') {
    // macOS: executable .command file (double-click in Finder to run in Terminal)
    const commandContent = [
      '#!/bin/bash',
      `# Stickyfix HTTP host launcher — double-click in Finder or drag to Dock`,
      `# Generated by: npx stickyfix init`,
      ``,
      `exec "${nodeCmd}" "${hostEntry}" --root "${rootArg}"${portArg}`,
    ].join('\n');

    const commandPath = paths.launcher;
    writeFileSync(commandPath, commandContent, { encoding: 'utf8', mode: 0o755 });
    written.push(commandPath);

  } else {
    // Linux: executable shell script + .desktop entry
    const shContent = [
      '#!/bin/sh',
      `# Stickyfix HTTP host launcher`,
      `# Generated by: npx stickyfix init`,
      ``,
      `exec "${nodeCmd}" "${hostEntry}" --root "${rootArg}"${portArg}`,
    ].join('\n');

    const shPath = paths.launcher;
    writeFileSync(shPath, shContent, { encoding: 'utf8' });
    try {
      chmodSync(shPath, 0o755);
    } catch {
      warnings.push(`Could not chmod 755 ${shPath} — run: chmod +x "${shPath}"`);
    }
    written.push(shPath);

    // .desktop entry
    if (paths.desktopEntry) {
      const desktopDir = dirname(paths.desktopEntry);
      mkdirSync(desktopDir, { recursive: true });
      const iconLine = opts.iconPath ? `Icon=${opts.iconPath}` : 'Icon=utilities-terminal';
      const desktopContent = [
        '[Desktop Entry]',
        'Version=1.0',
        'Type=Application',
        'Name=Stickyfix Host',
        'Comment=Start the Stickyfix HTTP backend host',
        `Exec=${shPath}`,
        iconLine,
        'Terminal=true',
        'Categories=Development;',
      ].join('\n');

      writeFileSync(paths.desktopEntry, desktopContent, { encoding: 'utf8', mode: 0o644 });
      written.push(paths.desktopEntry);
    }
  }

  return { written, warnings };
}

// ---------------------------------------------------------------------------
// registerNativeHost — write manifest + optional registry keys
// ---------------------------------------------------------------------------

interface RegisterOptions {
  extensionId: string;
  hostBinPath: string;
  plat?: NodeJS.Platform;
  home?: string;
}

/**
 * Write the native-messaging manifest and, on Windows, register it in both
 * the Chrome and Edge HKCU registry keys.
 *
 * execFileSync is used (NEVER exec, NEVER shell) — T-09-03.
 */
export function registerNativeHost(opts: RegisterOptions): void {
  const plat = opts.plat ?? process.platform;
  const home = opts.home ?? homedir();

  const manifestPath = nativeManifestPath(plat, home);
  // Chrome's CreateProcess cannot run a .cjs directly — point the manifest at a
  // per-OS wrapper that runs `node <abs cjs>` instead of the raw bin path.
  const wrapperPath = writeNativeWrapper(opts.hostBinPath, plat, home);
  const manifest = buildManifest(opts.extensionId, wrapperPath);
  writeManifest(manifest, manifestPath);

  if (plat === 'win32') {
    // Register for Chrome (HKCU — Pitfall 5, never HKLM)
    execFileSync('reg', ['ADD', REG_CHROME_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
    // Register for Edge (drop-in, D-05)
    execFileSync('reg', ['ADD', REG_EDGE_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
  }
}

// ---------------------------------------------------------------------------
// unregisterNativeHost — remove manifest + optional registry keys + launchers
// ---------------------------------------------------------------------------

interface UnregisterOptions {
  plat?: NodeJS.Platform;
  home?: string;
  /** Override the manifest path (used by tests to avoid touching real OS paths) */
  manifestPath?: string;
  /** Override launcher paths (used by tests) */
  launcherPaths?: Partial<LauncherPaths>;
}

/**
 * Remove the native-messaging manifest, launcher files, Desktop shortcut,
 * and on Windows delete the Chrome and Edge HKCU registry keys.
 *
 * Idempotent: does not throw if any artifact is already absent.
 * execFileSync is used (NEVER exec) with the /f flag to tolerate absent keys.
 */
export function unregisterNativeHost(opts: UnregisterOptions = {}): void {
  const plat = opts.plat ?? process.platform;
  const home = opts.home ?? homedir();
  const manifestPath = opts.manifestPath ?? nativeManifestPath(plat, home);

  rmSync(manifestPath, { force: true });
  rmSync(nativeWrapperPath(plat, home), { force: true });

  // Remove launcher files
  const defaultPaths = getLauncherPaths(plat, home);
  const lPaths: LauncherPaths = {
    launcher: opts.launcherPaths?.launcher ?? defaultPaths.launcher,
    shortcut: opts.launcherPaths?.shortcut !== undefined
      ? opts.launcherPaths.shortcut
      : defaultPaths.shortcut,
    desktopEntry: opts.launcherPaths?.desktopEntry !== undefined
      ? opts.launcherPaths.desktopEntry
      : defaultPaths.desktopEntry,
  };

  rmSync(lPaths.launcher, { force: true });
  if (lPaths.shortcut) rmSync(lPaths.shortcut, { force: true });
  if (lPaths.desktopEntry) rmSync(lPaths.desktopEntry, { force: true });

  // Remove the hidden-launch VBS (win32 only — written by createLauncherFiles)
  if (plat === 'win32') {
    rmSync(join(launcherDir(plat, home), LAUNCHER_VBS_FILENAME), { force: true });
  }

  if (plat === 'win32') {
    // /f flag suppresses "are you sure?" prompt; tolerates absent key (non-zero exit ignored)
    try {
      execFileSync('reg', ['DELETE', REG_CHROME_KEY, '/f']);
    } catch {
      // Key may not exist — ignore
    }
    try {
      execFileSync('reg', ['DELETE', REG_EDGE_KEY, '/f']);
    } catch {
      // Key may not exist — ignore
    }
  }
}

// ---------------------------------------------------------------------------
// enumerateArtifacts — complete list of paths/keys created by init (ONB-05)
// ---------------------------------------------------------------------------

interface ArtifactOptions {
  plat?: NodeJS.Platform;
  home?: string;
  root?: string;
}

interface ArtifactList {
  paths: string[];
  registryKeys: string[];
}

/**
 * Return the complete list of filesystem paths and registry keys that
 * `registerNativeHost` + `createLauncherFiles` create, so `uninstall` can
 * remove everything and leave no orphaned artifacts (ONB-05 / T-09-05).
 *
 * paths includes:
 *   - native-messaging manifest JSON
 *   - stickyfix config file (~/.config/stickyfix/config.json)
 *   - <root>/.stickyfix-port (written by HTTP host on startup)
 *   - launcher batch/command/sh file
 *   - Desktop shortcut (.lnk on win32) or .desktop entry (linux)
 *
 * registryKeys (win32 only):
 *   - HKCU Chrome NativeMessagingHosts key
 *   - HKCU Edge NativeMessagingHosts key
 */
export function enumerateArtifacts(opts: ArtifactOptions = {}): ArtifactList {
  const plat = opts.plat ?? process.platform;
  const home = opts.home ?? homedir();
  const root = opts.root;

  const paths: string[] = [
    nativeManifestPath(plat, home),
    nativeWrapperPath(plat, home),
    CONFIG_PATH(home),
  ];

  // .stickyfix-port is written by the HTTP host alongside .stickyfix-token
  if (root) {
    paths.push(join(root, '.stickyfix-port'));
  } else {
    // Include a generic indicator when root is unknown
    paths.push('.stickyfix-port');
  }

  // Launcher files created by createLauncherFiles
  const lPaths = getLauncherPaths(plat, home);
  paths.push(lPaths.launcher);
  if (lPaths.shortcut) paths.push(lPaths.shortcut);
  if (lPaths.desktopEntry) paths.push(lPaths.desktopEntry);
  if (plat === 'win32') {
    paths.push(join(launcherDir(plat, home), LAUNCHER_VBS_FILENAME));
  }

  const registryKeys: string[] = plat === 'win32' ? [REG_CHROME_KEY, REG_EDGE_KEY] : [];

  return { paths, registryKeys };
}

// Re-export isInsideDir for consumers that need path validation
export { isInsideDir };
