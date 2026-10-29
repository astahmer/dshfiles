import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DshCommandResult, DshCommandRunner } from './types.js'

const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 * 1024

async function execute(command: string, args: readonly string[], options: Parameters<DshCommandRunner>[1]): Promise<DshCommandResult> {
  const result = await execa(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    reject: false,
    timeout: options.timeoutMs,
  })
  return {
    ...(result.exitCode !== undefined && { exitCode: result.exitCode }),
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.code !== undefined && { failureCode: result.code }),
    ...(result.failed && { cause: result }),
    executable: command === 'pnpm' ? 'local' : 'global',
  }
}

/** Execute the installed project shim directly, then the user's PATH. No package-manager bootstrap is needed to run an existing executable. */
export const runProjectDsh: DshCommandRunner = async (args, options) => {
  const localBin =
    process.platform === 'win32'
      ? [resolve(options.cwd, 'node_modules/.bin/dsh.cmd'), resolve(options.cwd, 'node_modules/.bin/dsh.CMD')]
      : [resolve(options.cwd, 'node_modules/.bin/dsh')]
  const local = options.executable === 'global' ? undefined : localBin.find(existsSync)
  if (local !== undefined) return { ...(await execute(local, args, options)), executable: 'local' }
  return execute('dsh', args, options)
}
