/**
 * The cmd.exe command line that runs a Windows batch shim (`pnpm.cmd`, `npm.cmd`, `node_modules\.bin\*.cmd`).
 *
 * Node refuses to spawn a `.cmd` or `.bat` file without a shell (EINVAL, CVE-2024-27980), and package managers resolve
 * to exactly such shims on Windows. Effect's spawner then takes the whole line as one command, which Node hands to
 * `cmd.exe /d /s /c "…"` verbatim. Plain double quotes do not stop cmd.exe from expanding `%VAR%` or reading `&`, so
 * every metacharacter is caret-escaped, quotes included. A batch file hands its arguments on through `%*` (or `%1`),
 * which cmd.exe parses a second time, so arguments are escaped twice. cross-spawn does that only for
 * `node_modules\.bin` shims; a global `pnpm.cmd` forwards `%*` the same way, so here every batch file gets it.
 *
 * Escaping ported from cross-spawn 7.0.6 `lib/util/escape.js` and `lib/parse.js` (MIT, © 2018 Made With MOXY Lda,
 * https://github.com/moxystudio/node-cross-spawn).
 */
const META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/gu

const escapeCommand = (command: string): string => command.replace(META_CHARACTERS, '^$1')

const escapeArgument = (argument: string): string => {
  // Backslashes before a quote, or before the closing quote added below, are doubled so they stay literal.
  const quoted = `"${argument.replace(/(?=(\\+?)?)\1"/gu, '$1$1\\"').replace(/(?=(\\+?)?)\1$/u, '$1$1')}"`
  return quoted.replace(META_CHARACTERS, '^$1').replace(META_CHARACTERS, '^$1')
}

export class WindowsCommandLine {
  /** Whether this resolved executable is a batch file that only runs through cmd.exe. */
  static readonly needsShell = (executable: string, platform: NodeJS.Platform = process.platform): boolean =>
    platform === 'win32' && /\.(?:cmd|bat)$/iu.test(executable)

  /** One cmd.exe line for an absolute batch file and its arguments, each passed through literally. */
  static readonly forBatchFile = (executable: string, args: readonly string[]): string => [escapeCommand(executable), ...args.map(escapeArgument)].join(' ')
}
