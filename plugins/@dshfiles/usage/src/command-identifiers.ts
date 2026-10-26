import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'
import { z } from 'zod'

const argumentsSchema = z.object({ command: z.string().max(4_096) })
export const shellToolArgumentsSchema = z.union([z.string().max(4_096), argumentsSchema])
export type ShellToolArguments = z.infer<typeof shellToolArgumentsSchema>
const safeIdentifier = /^[a-zA-Z0-9][\w.+:-]{0,39}$/
const subcommandTools = new Set(['cargo', 'dshx', 'git', 'go', 'jj', 'nix', 'vitest', 'jest', 'playwright'])
const shellTool = /^(?:functions\.)?(?:bash|pwsh|powershell|exec_command|shell\.run)$/

export interface CommandIdentifiers {
  readonly normalizedCommand: string | null
  readonly testRunner: string | null
}

const safeWord = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined
  const word = raw
    .replace(/^['"]|['"]$/g, '')
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
  if (word === undefined || !safeIdentifier.test(word)) return undefined
  return word.toLowerCase()
}

const commandTokens = (command: string): string[] => {
  const withoutCd = command.replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*&&\s*)+/i, '')
  if (/[;|<>\n]/u.test(withoutCd) || /&&|\|\|/u.test(withoutCd)) return []
  return withoutCd.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []
}

const commandIdentifier = (command: string): string | null => {
  const tokens = commandTokens(command)
  if (tokens.length === 0) return null
  let index = 0
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) index++
  if (tokens[index] === 'env') {
    index++
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) index++
    if (tokens[index] === '--') index++
    if ((tokens[index] ?? '').startsWith('-')) return null
  }
  if (tokens[index] === 'fnm' && tokens[index + 1] === 'exec') {
    index += 2
    while (index < tokens.length) {
      const token = tokens[index] ?? ''
      if (token === '--using') index += 2
      else if (token.startsWith('--')) index++
      else break
    }
  }
  const executable = safeWord(tokens[index])
  if (executable === undefined) return null
  index++
  if (executable === 'node' && tokens[index] === '--test') return 'node --test'
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(executable)) {
    while (index < tokens.length) {
      const token = tokens[index] ?? ''
      if (['--dir', '--filter', '-C'].includes(token)) index += 2
      else if (['--workspace-root', '--silent', '--offline', '--recursive', '-r', '--prod'].includes(token)) index++
      else if (token.startsWith('-')) return executable
      else break
    }
    let subcommand = safeWord(tokens[index])
    if (subcommand === 'run') {
      index++
      subcommand = safeWord(tokens[index])
    }
    if (subcommand === 'exec') {
      index++
      const nested = safeWord(tokens[index])
      if (nested === undefined) return executable
      if (['vitest', 'jest', 'pytest', 'playwright'].includes(nested)) return nested
      return `${executable} exec ${nested}`.slice(0, 80)
    }
    if (subcommand === undefined) return executable
    return `${executable} ${subcommand}`.slice(0, 80)
  }
  if (!subcommandTools.has(executable)) return executable
  const subcommand = safeWord(tokens[index])
  if (subcommand === undefined || subcommand.startsWith('-')) return executable
  return `${executable} ${subcommand}`.slice(0, 80)
}

const testRunnerIdentifier = (normalizedCommand: string | null): string | null => {
  if (normalizedCommand === null) return null
  if (/^(vitest|jest|pytest|playwright)(?:\s|$)/.test(normalizedCommand)) return normalizedCommand.split(' ')[0] ?? null
  if (['cargo test', 'go test'].includes(normalizedCommand)) return normalizedCommand.replace(' ', '-')
  if (normalizedCommand === 'node --test') return 'node-test'
  const packageTest = normalizedCommand.match(/^(pnpm|npm|yarn|bun) (test(?::[\w.-]+)?)$/)
  if (packageTest?.[2] !== undefined) return `${packageTest[1]}:${packageTest[2]}`.slice(0, 80)
  return null
}

export const identifyCommand = (input: { readonly toolName: string; readonly arguments: ShellToolArguments | undefined }): CommandIdentifiers => {
  if (!shellTool.test(input.toolName)) return { normalizedCommand: null, testRunner: null }
  const serialized = z.string().max(4_096).safeParse(input.arguments)
  let decoded: unknown = input.arguments
  if (serialized.success) {
    try {
      decoded = decodeJson(jsonValueSchema, serialized.data)
    } catch {
      return { normalizedCommand: null, testRunner: null }
    }
  }
  const parsed = argumentsSchema.safeParse(decoded)
  if (!parsed.success) return { normalizedCommand: null, testRunner: null }
  const command = commandIdentifier(parsed.data.command)
  return {
    normalizedCommand: command,
    testRunner: testRunnerIdentifier(command),
  }
}
