import { createRequire } from 'node:module'
import type { Writable } from 'node:stream'
import { styleText } from 'node:util'
import type { CliIO } from './run.js'

export type TerminalStyle = Parameters<typeof styleText>[0]

const require = createRequire(import.meta.url)

const packageVersion = (): string => {
  try {
    // SAFETY: only `version` is read, and it is checked to be a non-empty string before use.
    const manifest = require('../../package.json') as { version?: unknown }
    if (typeof manifest.version === 'string' && manifest.version !== '') return manifest.version
  } catch {
    /* source-only environments may not have package metadata */
  }
  return '0.0.0'
}

/** Output helpers shared by the command dispatcher and the project commands it loads on demand. */
export class CliOutput {
  /** Per-stream `--quiet` / `--no-color`, set once by `runCli` after parsing. */
  static readonly options = new WeakMap<Writable, { readonly quiet: boolean; readonly noColor: boolean }>()
  static readonly version = packageVersion()

  static readonly defaultIO = (): CliIO => ({ stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })

  static readonly write = (stream: Writable, text: string): void => {
    if (CliOutput.options.get(stream)?.quiet) return
    stream.write(text)
  }

  static readonly paint = (stream: Writable, style: TerminalStyle, text: string): string => {
    if (CliOutput.options.get(stream)?.noColor) return text
    // SAFETY: `isTTY` is optional on Writable and only compared to `true`.
    const terminal = stream as Writable & { isTTY?: boolean }
    if (terminal.isTTY !== true || process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') return text
    return styleText(style, text)
  }
}
