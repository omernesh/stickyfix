/**
 * OS native folder-picker dialog for stickyfix (D-04).
 * Spawns the OS dialog binary via execFile (NEVER exec, NEVER shell:true).
 * Arguments are a static array — no user-supplied strings interpolated into
 * shell command context (T-09-01 / RESEARCH Pattern 5).
 *
 * Node builtins only — no WXT, no Chrome imports.
 */

import { execFile } from 'node:child_process';

// ---------------------------------------------------------------------------
// buildPickerArgs — per-OS static argument array builder
// ---------------------------------------------------------------------------

export interface PickerArgs {
  cmd: string;
  args: string[];
}

/**
 * Build the command + argument array for the OS folder-picker dialog.
 *
 * Security contract (T-09-01):
 * - Uses execFile (not exec) — no shell spawned
 * - The `title` is the only variable input; it is escaped for safe use in
 *   the dialog command but never allows shell metacharacters to pass through
 * - No user-controlled input (origin, username, path) is interpolated into
 *   the command string beyond the developer-static dialog title
 *
 * @param plat - NodeJS.Platform override for testing
 * @param title - Static dialog title (developer-controlled)
 */
export function buildPickerArgs(
  plat: NodeJS.Platform = process.platform,
  title: string = 'Choose folder',
): PickerArgs {
  switch (plat) {
    case 'win32': {
      // PowerShell FolderBrowserDialog — fixed arg array, no shell interpolation.
      // Single-quote escape: replace ' with '' (PowerShell string literal escape).
      // Title is developer-controlled (static label) — not user/origin input.
      const safeTitle = title.replace(/'/g, "''");
      return {
        cmd: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-OutputFormat',
          'Text',
          '-Command',
          `Add-Type -AssemblyName System.Windows.Forms;` +
            `$d = New-Object System.Windows.Forms.FolderBrowserDialog;` +
            `$d.Description = '${safeTitle}';` +
            `$null = $d.ShowDialog();` +
            `$d.SelectedPath`,
        ],
      };
    }

    case 'darwin': {
      // osascript choose folder — fixed arg array
      return {
        cmd: 'osascript',
        args: ['-e', `choose folder with prompt "Choose a project folder"`],
      };
    }

    case 'linux':
    default: {
      // zenity (GNOME primary), kdialog fallback handled at runtime in pickFolder
      return {
        cmd: 'zenity',
        args: ['--file-selection', '--directory', `--title=${title}`],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// pickFolder — invoke the OS dialog and return the chosen path
// ---------------------------------------------------------------------------

/**
 * Open a native OS folder-picker dialog and return the chosen absolute path,
 * or null if the user cancels, the dialog binary is not available, or the
 * timeout (120 s) is exceeded.
 *
 * Uses execFile (not exec) with a static argument array — T-09-01.
 * The returned path should be validated with isInsideDir before use.
 *
 * @param title - Dialog title (developer-static label, not user-controlled)
 * @param plat  - Platform override for testing
 */
export async function pickFolder(
  title: string = 'Choose a project folder',
  plat: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (plat === 'darwin') {
    // osascript returns an HFS+ alias path; convert to POSIX
    return new Promise((resolve) => {
      const { args } = buildPickerArgs('darwin', title);
      execFile('osascript', args, { timeout: 120_000 }, (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        const raw = stdout.trim();
        // Convert alias to POSIX path via second osascript call
        execFile(
          'osascript',
          ['-e', `POSIX path of (${raw})`],
          {},
          (e2, out2) => {
            resolve(e2 ? null : out2.trim() || null);
          },
        );
      });
    });
  }

  if (plat === 'win32') {
    const { cmd, args } = buildPickerArgs('win32', title);
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: 120_000 }, (err, stdout) => {
        resolve(err ? null : stdout.trim() || null);
      });
    });
  }

  // Linux: try zenity first, then kdialog
  const zenityResult = await tryLinuxPicker('zenity', title);
  if (zenityResult !== undefined) return zenityResult;

  const kdialogResult = await tryLinuxPicker('kdialog', title);
  if (kdialogResult !== undefined) return kdialogResult;

  // Headless fallback: return null (native host falls back to --root config)
  return null;
}

/**
 * Try a Linux folder-picker tool.
 * Returns the path string if successful, null if user cancelled,
 * undefined if the tool is not found.
 */
function tryLinuxPicker(tool: 'zenity' | 'kdialog', title: string): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    const args =
      tool === 'zenity'
        ? ['--file-selection', '--directory', `--title=${title}`]
        : ['--getexistingdirectory', '/home'];

    execFile(tool, args, { timeout: 120_000 }, (err, stdout) => {
      if (err) {
        // Distinguish "not found" (ENOENT) from "user cancelled" (non-zero exit)
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') {
          resolve(undefined); // tool not installed — try next
        } else {
          resolve(null); // user cancelled or dialog error
        }
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}
