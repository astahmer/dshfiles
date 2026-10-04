import { defineTool } from '@dshfiles/dshx/host'
import { classifyBashCommand } from './classify.js'

const MAX_COMMANDS = 32
const MAX_COMMAND_LENGTH = 8_000
const MAX_OUTPUT = 220_000

const text = (value: string) => ({ type: 'text' as const, text: value })

export const readOnlyBashTool = defineTool({
  name: 'bash_readonly',
  description:
    'Run several INDEPENDENT read-only shell commands concurrently instead of one after another. '
    + 'Each command gets its own process and they all start together, so eight reads finish in the time of the slowest one. '
    + 'Use this only for commands that merely read: listing, reading, diffing, status, and search. '
    + 'Any command that writes, or that cannot be proven to read only, is refused — use the regular `bash` tool for those. '
    + 'Pass complete command strings; each runs in its own shell and must be self-contained.',
  parameters: {
    type: 'object',
    properties: {
      commands: {
        type: 'array',
        description: `Complete shell commands to run concurrently, between 2 and ${MAX_COMMANDS} entries.`,
        items: { type: 'string' },
        minItems: 2,
        maxItems: MAX_COMMANDS,
      },
      workdir: {
        type: 'string',
        description: 'Absolute directory to run in. Defaults to the session workspace.',
      },
    },
    required: ['commands'],
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              exitCode: { type: 'number' },
              output: { type: 'string' },
              truncated: { type: 'boolean' },
            },
            required: ['command', 'exitCode', 'output', 'truncated'],
          },
        },
      },
      required: ['results'],
    },
    render: (_args, value) => value.results.map((result, index) => {
      const header = `[${index + 1}/${value.results.length}] ${result.command}`
      const status = result.exitCode === 0 ? '' : ` (exit ${result.exitCode})`
      const suffix = result.truncated ? '\n[output truncated]' : ''
      return text(`${header}${status}\n${result.output}${suffix}`)
    }),
  },
  isConcurrencySafe: (args) =>
    args.commands.every((command) => classifyBashCommand(command).parallel),
  execute: async (args, exec) => {
    const subprocess = exec.agent?.ctx.subprocess
    if (subprocess === undefined) throw new Error('bash_readonly requires the subprocess service.')

    const runs = args.commands.map(async (command, index) => {
      const label = `[${index + 1}] ${command}`
      if (command.trim().length === 0) {
        return { command: label, exitCode: -1, output: 'empty command', truncated: false }
      }
      if (command.length > MAX_COMMAND_LENGTH) {
        return { command: label, exitCode: -1, output: `command exceeds ${MAX_COMMAND_LENGTH} characters`, truncated: false }
      }
      try {
        const handle = subprocess.spawn({
          argv: ['bash', '-c', command],
          ...args.workdir !== undefined ? { cwd: args.workdir } : {},
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_OUTPUT },
            stderr: { maxBytes: MAX_OUTPUT },
          },
          signal: exec.signal,
        })
        const outcome = await handle.done
        if (!(await handle.waitForExit(exec.signal))) handle.terminate()
        const stdout = handle.collected.stdout?.readFrom(0)
        const stderr = handle.collected.stderr?.readFrom(0)
        const body = [stdout?.text, stderr?.text].filter((part) => part !== undefined && part.length > 0).join('')
        return {
          command: label,
          exitCode: outcome.exitCode ?? -1,
          output: body.length > 0 ? body : '(no output)',
          truncated: (stdout?.lossy ?? false) || (stderr?.lossy ?? false),
        }
      } catch (error) {
        return {
          command: label,
          exitCode: -1,
          output: error instanceof Error ? error.message : 'command failed to start',
          truncated: false,
        }
      }
    })

    return { results: await Promise.all(runs) }
  },
})