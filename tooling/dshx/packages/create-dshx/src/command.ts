import { execa } from 'execa'
import type { CommandRunner, PackageManager } from './types.js'

const defaultCommandRunner: CommandRunner = async (command, args, options) => {
  const result = await execa(command, args, { cwd: options.cwd, reject: false })
  return { exitCode: result.exitCode ?? (result.failed ? 1 : 0), stdout: result.stdout, stderr: result.stderr }
}

const commandAvailable = async (command: string, runner = defaultCommandRunner): Promise<boolean> => {
  const result = await runner('which', [command], { cwd: process.cwd() })
  return result.exitCode === 0
}

const installCommand = (manager: PackageManager): { readonly command: string; readonly args: readonly string[] } => {
  return { command: manager, args: ['install'] }
}

export class CreateCommandRuntime {
  static readonly defaultRunner = defaultCommandRunner
  static readonly available = commandAvailable
  static readonly install = installCommand
}
