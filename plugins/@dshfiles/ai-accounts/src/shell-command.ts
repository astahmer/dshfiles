const powerShellQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`

/** Copyable terminal lines. Pure: the account schema and the settings panel run in the browser. */
export class ShellCommand {
  /** A Windows Host's drive-absolute path (`C:\…` or `C:/…`). */
  static readonly isWindowsAbsolutePath = (path: string): boolean => /^[A-Za-z]:[\\/]/u.test(path)

  /** One single-quoted POSIX shell word. */
  static readonly posixQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

  /**
   * A line that runs `command` with one environment variable set for that command only, like POSIX
   * `NAME=value command`. A drive-absolute path means a Windows Host, whose terminal is PowerShell: there the line
   * saves the previous value and restores it afterwards, so a later plain command in the same terminal is not
   * redirected.
   */
  static readonly withEnvironment = (name: string, value: string, command: string): string =>
    ShellCommand.isWindowsAbsolutePath(value)
      ? `& { $previous = $env:${name}; $env:${name} = ${powerShellQuote(value)}; try { ${command} } finally { $env:${name} = $previous } }`
      : `${name}=${ShellCommand.posixQuote(value)} ${command}`
}
