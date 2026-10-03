import { defineCommand, parseArgs as parseCittyArgs } from 'citty'

export type CliCommand =
  | 'build'
  | 'check'
  | 'dev'
  | 'inspect'
  | 'add'
  | 'test'
  | 'package'
  | 'status'
  | 'info'
  | 'doctor'
  | 'sessions'
  | 'plugins'
  | 'bundles'
  | 'commands'
  | 'config'
export type CliInspectTarget = 'slots' | 'tools' | 'services' | 'events'
export type CliAddTarget = 'ui' | 'tool' | 'command' | 'hook'

export interface CliArgs {
  readonly command?: CliCommand
  readonly inspectTarget?: CliInspectTarget
  readonly addTarget?: CliAddTarget
  readonly platformArgs?: readonly string[]
  readonly cwd?: string
  readonly root?: string
  readonly verbose: boolean
  readonly json: boolean
  readonly runtime: boolean
  readonly open: boolean
  readonly port?: number
  readonly slot?: string
  readonly name?: string
  readonly description?: string
  readonly event?: string
  readonly provider?: string
  readonly file?: string
  readonly id?: string
  readonly order?: number
  readonly dryRun: boolean
  readonly fix: boolean
  readonly help: boolean
  readonly version: boolean
  readonly quiet?: boolean
  readonly noColor?: boolean
  readonly url?: string
  readonly session?: string
  readonly namespace?: string
  readonly line?: string
  readonly output?: string
  readonly agentPreset?: string
  readonly max?: number
  readonly atSeq?: number
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

const valueOptions = new Set([
  '--cwd',
  '--root',
  '--slot',
  '--name',
  '--description',
  '--event',
  '--provider',
  '--file',
  '--id',
  '--order',
  '--port',
  '--url',
  '--session',
  '--namespace',
  '--line',
  '--output',
  '--agent-preset',
  '--max',
  '--at-seq',
])
const booleanOptions = new Set([
  '--help',
  '-h',
  '--version',
  '-V',
  '--verbose',
  '--json',
  '--runtime',
  '--open',
  '--dry-run',
  '--fix',
  '--quiet',
  '--no-color',
])

const sharedArgs = {
  cwd: {
    type: 'string',
    description: 'Run from a different project directory.',
    valueHint: 'path',
  },
  root: {
    type: 'string',
    description: 'Limit Slot inspection to a root Slot.',
    valueHint: 'slot',
  },
  verbose: {
    type: 'boolean',
    description: 'Print underlying command failures.',
  },
  json: { type: 'boolean', description: 'Emit stable machine-readable JSON.' },
  runtime: { type: 'boolean', description: 'Require a linked and reachable DSH runtime when checking.' },
  open: { type: 'boolean', description: 'Open the development URL.' },
  port: {
    type: 'string',
    description: 'Set the DSH Web development port; use 0 to let the OS choose.',
    valueHint: 'port',
  },
  slot: {
    type: 'string',
    description: 'Select a Slot by name.',
    valueHint: 'name',
  },
  name: {
    type: 'string',
    description: 'Name a generated Tool or Command.',
    valueHint: 'name',
  },
  description: {
    type: 'string',
    description: 'Describe a generated Tool or Command.',
    valueHint: 'text',
  },
  event: {
    type: 'string',
    description: 'Select a DSH lifecycle event.',
    valueHint: 'name',
  },
  provider: {
    type: 'string',
    description: 'Select a UI provider package.',
    valueHint: 'package',
  },
  file: {
    type: 'string',
    description: 'Override the generated file path.',
    valueHint: 'path',
  },
  id: {
    type: 'string',
    description: 'Set the generated contribution id.',
    valueHint: 'id',
  },
  order: {
    type: 'string',
    description: 'Set the UI contribution order.',
    valueHint: 'integer',
  },
  dryRun: {
    type: 'boolean',
    description: 'Plan changes without writing files.',
  },
  fix: { type: 'boolean', description: 'Repair safe manifest issues.' },
  quiet: { type: 'boolean', description: 'Suppress human-readable output; retain exit status.' },
  noColor: { type: 'boolean', description: 'Disable terminal colors.' },
  url: { type: 'string', description: 'Tokenized local DSH launch URL (defaults to DSHX_URL).', valueHint: 'url' },
  session: { type: 'string', description: 'Scope a DSH command operation to this Session.', valueHint: 'id' },
  namespace: { type: 'string', description: 'Select a DSH settings namespace.', valueHint: 'id' },
  line: { type: 'string', description: 'Run one slash-prefixed DSH command line.', valueHint: 'command' },
  output: { type: 'string', description: 'Write an export to this file.', valueHint: 'path' },
  agentPreset: { type: 'string', description: 'Create the Session with this DSH Agent preset.', valueHint: 'id' },
  max: { type: 'string', description: 'Maximum messages to return in one history page.', valueHint: 'count' },
  atSeq: { type: 'string', description: 'Fork at this inclusive Session event sequence.', valueHint: 'sequence' },
  help: { type: 'boolean', alias: 'h', description: 'Show command help.' },
  version: {
    type: 'boolean',
    alias: 'V',
    description: 'Show the installed version.',
  },
} as const

/** Citty command metadata is the single declaration of DSHX commands and options. */
export const dshxCommand = defineCommand({
  meta: {
    name: 'dshx',
    description: 'Build DSH plugins and inspect or control a running DSH installation.',
  },
  args: sharedArgs,
  subCommands: {
    test: defineCommand({ meta: { name: 'test', description: 'Run project-local Vitest tests.' }, args: sharedArgs }),
    package: defineCommand({ meta: { name: 'package', description: 'Build, validate, and pack a native plugin bundle.' }, args: sharedArgs }),
    build: defineCommand({
      meta: {
        name: 'build',
        description: 'Build Host and Client plugin artifacts.',
      },
      args: sharedArgs,
    }),
    check: defineCommand({
      meta: {
        name: 'check',
        description: 'Validate compatibility and project wiring.',
      },
      args: sharedArgs,
    }),
    dev: defineCommand({
      meta: {
        name: 'dev',
        description: 'Run a compatibility-aware DSH development session.',
      },
      args: sharedArgs,
    }),
    inspect: defineCommand({
      meta: {
        name: 'inspect',
        description: 'Inspect Slots, Tools, Services, or Events.',
      },
      args: sharedArgs,
    }),
    add: defineCommand({
      meta: {
        name: 'add',
        description: 'Scaffold a UI, Tool, Command, or Hook contribution.',
      },
      args: sharedArgs,
    }),
    status: defineCommand({ meta: { name: 'status', description: 'Check the authenticated local DSH Host connection.' }, args: sharedArgs }),
    info: defineCommand({ meta: { name: 'info', description: 'Show local DSHX and Node runtime information.' }, args: sharedArgs }),
    doctor: defineCommand({ meta: { name: 'doctor', description: 'Diagnose local DSHX and reachable DSH APIs.' }, args: sharedArgs }),
    sessions: defineCommand({ meta: { name: 'sessions', description: 'List, inspect, create, fork, cancel, and export DSH Sessions.' }, args: sharedArgs }),
    plugins: defineCommand({ meta: { name: 'plugins', description: 'List, inspect, enable, and disable DSH plugins.' }, args: sharedArgs }),
    bundles: defineCommand({ meta: { name: 'bundles', description: 'List, inspect, enable, and disable DSH bundles.' }, args: sharedArgs }),
    commands: defineCommand({ meta: { name: 'commands', description: 'Inspect and run Session-scoped DSH commands.' }, args: sharedArgs }),
    config: defineCommand({ meta: { name: 'config', description: 'Read and update one DSH settings namespace.' }, args: sharedArgs }),
  },
})

function validateOptionTokens(argv: readonly string[]): void {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('-')) continue
    if (booleanOptions.has(token)) continue
    if (!valueOptions.has(token)) throw new CliUsageError(`Unknown argument ${JSON.stringify(token)}.`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('-')) throw new CliUsageError(`${token} requires a value.`)
    index += 1
  }
}

/** Parse the small, intentionally stable DSHX command grammar. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  validateOptionTokens(argv)
  const parsed = parseCittyArgs([...argv], sharedArgs)
  let command: CliCommand | undefined
  let inspectTarget: CliInspectTarget | undefined
  let addTarget: CliAddTarget | undefined
  const platformArgs: string[] = []
  let order: number | undefined

  for (const token of parsed._) {
    if (token === undefined) continue
    if (
      token === 'build' || token === 'check' || token === 'dev' || token === 'inspect' || token === 'add' || token === 'test' || token === 'package' ||
      token === 'status' || token === 'info' || token === 'doctor' || token === 'sessions' || token === 'plugins' || token === 'bundles' ||
      token === 'commands' || token === 'config'
    ) {
      if (command !== undefined) throw new CliUsageError('Only one command may be specified.')
      command = token
      continue
    }
    if (command === 'inspect' && (token === 'slots' || token === 'tools' || token === 'services' || token === 'events')) {
      if (inspectTarget !== undefined) throw new CliUsageError('Only one inspect target may be specified.')
      inspectTarget = token
      continue
    }
    if (command === 'add' && (token === 'ui' || token === 'tool' || token === 'command' || token === 'hook')) {
      if (addTarget !== undefined) throw new CliUsageError('Only one add target may be specified.')
      addTarget = token
      continue
    }
    if (command === 'sessions' || command === 'plugins' || command === 'bundles' || command === 'commands' || command === 'config') {
      platformArgs.push(token)
      continue
    }
    throw new CliUsageError(`Unknown argument ${JSON.stringify(token)}.`)
  }

  const cwd = parsed.cwd
  const root = parsed.root
  const verbose = parsed.verbose ?? false
  const json = parsed.json ?? false
  const runtime = parsed.runtime ?? false
  const open = parsed.open ?? false
  let port: number | undefined
  const slot = parsed.slot
  const name = parsed.name
  const description = parsed.description
  const event = parsed.event
  const provider = parsed.provider
  const file = parsed.file
  const id = parsed.id
  const dryRun = parsed.dryRun ?? false
  const fix = parsed.fix ?? false
  const help = parsed.help ?? false
  const version = parsed.version ?? false
  const quiet = parsed.quiet ?? false
  const noColor = parsed.noColor ?? false
  const url = parsed.url
  const session = parsed.session
  const namespace = parsed.namespace
  const line = parsed.line
  const output = parsed.output
  const agentPreset = parsed.agentPreset
  let max: number | undefined
  let atSeq: number | undefined
  if (parsed.max !== undefined) {
    max = Number(parsed.max)
    if (!Number.isSafeInteger(max) || max < 1 || max > 10_000) throw new CliUsageError('--max requires an integer from 1 to 10000.')
  }
  if (parsed.atSeq !== undefined) {
    atSeq = Number(parsed.atSeq)
    if (!Number.isSafeInteger(atSeq) || atSeq < 0) throw new CliUsageError('--at-seq requires a non-negative safe integer.')
  }
  if (parsed.order !== undefined) {
    const value = Number(parsed.order)
    if (!Number.isInteger(value)) throw new CliUsageError('--order requires an integer value.')
    order = value
  }
  if (parsed.port !== undefined) {
    const value = Number(parsed.port)
    if (!Number.isInteger(value) || value < 0 || value > 65_535) throw new CliUsageError('--port requires an integer from 0 to 65535.')
    port = value
  }

  const platformCommand = command === 'status' || command === 'info' || command === 'doctor' || command === 'sessions' || command === 'plugins' || command === 'bundles' || command === 'commands' || command === 'config'
  if (json && command !== undefined && command !== 'check' && command !== 'inspect' && command !== 'add' && !platformCommand)
    throw new CliUsageError('--json is only valid with check, inspect, or add.')
  if (open && command !== undefined && command !== 'dev') throw new CliUsageError('--open is only valid with dev.')
  if (port !== undefined && command !== 'dev') throw new CliUsageError('--port is only valid with dev.')
  if (dryRun && command !== 'add' && !(command === 'check' && fix))
    throw new CliUsageError('DSHX4147: --dry-run is only valid with add commands or check --fix.')
  if (fix && command !== 'check') throw new CliUsageError('DSHX4147: --fix is only valid with check.')
  if (runtime && command !== 'check') throw new CliUsageError('--runtime is only valid with check.')
  if (url !== undefined && !platformCommand) throw new CliUsageError('--url is only valid with DSH platform commands.')
  if (session !== undefined && command !== 'commands') throw new CliUsageError('--session is only valid with commands.')
  if (namespace !== undefined && command !== 'config') throw new CliUsageError('--namespace is only valid with config.')
  if (line !== undefined && command !== 'commands') throw new CliUsageError('--line is only valid with commands run.')
  if (output !== undefined && !(command === 'sessions' && platformArgs[0] === 'export')) throw new CliUsageError('--output is only valid with sessions export.')
  if (agentPreset !== undefined && !(command === 'sessions' && platformArgs[0] === 'create')) throw new CliUsageError('--agent-preset is only valid with sessions create.')
  if (max !== undefined && !(command === 'sessions' && platformArgs[0] === 'history')) throw new CliUsageError('--max is only valid with sessions history.')
  if (atSeq !== undefined && !(command === 'sessions' && platformArgs[0] === 'fork')) throw new CliUsageError('--at-seq is only valid with sessions fork.')
  if (command === 'status' || command === 'info' || command === 'doctor') {
    if (parsed._.length > 1 && !help) throw new CliUsageError(`${command} does not accept positional arguments.`)
  }
  if (command === 'sessions' && !help) {
    const [action, id, ...extra] = platformArgs
    if (!['list', 'show', 'history', 'create', 'fork', 'cancel', 'export'].includes(action ?? '')) throw new CliUsageError('sessions requires list, show, history, create, fork, cancel, or export.')
    if (['show', 'history', 'fork', 'cancel', 'export'].includes(action ?? '') && !id) throw new CliUsageError(`sessions ${action} requires a Session id.`)
    if (extra.length > 0) throw new CliUsageError(`sessions ${action} accepts no extra positional arguments.`)
    if (['list', 'create'].includes(action ?? '') && id !== undefined) throw new CliUsageError(`sessions ${action} accepts no positional argument.`)
  }
  if ((command === 'plugins' || command === 'bundles') && !help) {
    const [action, id, ...extra] = platformArgs
    if (!['list', 'info', 'enable', 'disable'].includes(action ?? '')) throw new CliUsageError(`${command} requires list, info, enable, or disable.`)
    if (['info', 'enable', 'disable'].includes(action ?? '') && !id) throw new CliUsageError(`${command} ${action} requires an id.`)
    if (extra.length > 0 || (action === 'list' && id !== undefined)) throw new CliUsageError(`${command} ${action} accepts no extra positional arguments.`)
  }
  if (command === 'commands' && !help) {
    const [action, commandName, ...extra] = platformArgs
    if (!['list', 'info', 'run'].includes(action ?? '')) throw new CliUsageError('commands requires list, info, or run.')
    if (session === undefined) throw new CliUsageError(`commands ${action} requires --session <id>.`)
    if (action === 'info' && !commandName) throw new CliUsageError('commands info requires a command name.')
    if (action === 'run' && line === undefined && platformArgs.length < 2) throw new CliUsageError('commands run requires a slash-prefixed line or --line.')
    if (action !== 'run' && (commandName !== undefined || extra.length > 0)) throw new CliUsageError(`commands ${action} accepts no extra positional arguments.`)
  }
  if (command === 'config' && !help) {
    const [action, namespaceArg, path, ...extra] = platformArgs
    if (!['list', 'get', 'set', 'unset'].includes(action ?? '')) throw new CliUsageError('config requires list, get, set, or unset.')
    const selectedNamespace = namespace ?? namespaceArg
    if (action !== 'list' && selectedNamespace === undefined) throw new CliUsageError(`config ${action} requires a settings namespace.`)
    if (action === 'get' && extra.length > 0) throw new CliUsageError('config get accepts one optional path.')
    if ((action === 'set' || action === 'unset') && path === undefined) throw new CliUsageError(`config ${action} requires a settings path.`)
    if (action === 'set' && extra.length === 0) throw new CliUsageError('config set requires a JSON value.')
    if (action === 'unset' && extra.length > 0) throw new CliUsageError('config unset accepts no JSON value.')
    if (action === 'list' && (namespaceArg !== undefined || path !== undefined || extra.length > 0)) throw new CliUsageError('config list accepts no namespace or path.')
  }
  if (!platformCommand && platformArgs.length > 0) throw new CliUsageError('Unexpected positional arguments.')
  if ((slot !== undefined || provider !== undefined || id !== undefined || order !== undefined) && command !== 'add')
    throw new CliUsageError('add ui options are only valid with add ui.')
  if ((name !== undefined || description !== undefined) && command !== 'add')
    throw new CliUsageError('add name options are only valid with add tool or add command.')
  if (event !== undefined && command !== 'add') throw new CliUsageError('--event is only valid with add hook.')
  if (root !== undefined && (command !== 'inspect' || inspectTarget !== 'slots')) throw new CliUsageError('--root is only valid with inspect slots.')
  if ((json || open || port !== undefined) && command === undefined) throw new CliUsageError('An option requires a command.')
  if (command !== 'inspect' && inspectTarget !== undefined) throw new CliUsageError('Inspect targets are only valid with the inspect command.')
  if (command !== 'add' && addTarget !== undefined) throw new CliUsageError('Add targets are only valid with the add command.')
  if (command === 'inspect' && inspectTarget === undefined && !help && !version)
    throw new CliUsageError('Inspect requires a target: slots, tools, services, or events.')
  if (command === 'add' && addTarget === undefined && !help && !version) throw new CliUsageError('Add requires a target: ui, tool, command, or hook.')
  if (command === 'add' && addTarget !== 'ui' && addTarget !== 'tool' && addTarget !== 'command' && addTarget !== 'hook')
    throw new CliUsageError('Only add ui, add tool, add command, and add hook are supported.')
  if (command === 'add' && addTarget !== 'ui' && (slot !== undefined || provider !== undefined || id !== undefined || order !== undefined))
    throw new CliUsageError('Slot options are only valid with add ui.')
  if (command === 'add' && addTarget !== 'tool' && addTarget !== 'command' && (name !== undefined || description !== undefined))
    throw new CliUsageError('Name and description options are only valid with add tool or add command.')
  if (command === 'add' && addTarget !== 'hook' && event !== undefined) throw new CliUsageError('--event is only valid with add hook.')
  if (help || version)
    return {
      ...(command === undefined ? {} : { command }),
      ...(inspectTarget === undefined ? {} : { inspectTarget }),
      ...(addTarget === undefined ? {} : { addTarget }),
      ...(platformArgs.length === 0 ? {} : { platformArgs }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(root === undefined ? {} : { root }),
      ...(slot === undefined ? {} : { slot }),
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(event === undefined ? {} : { event }),
      ...(provider === undefined ? {} : { provider }),
      ...(file === undefined ? {} : { file }),
      ...(id === undefined ? {} : { id }),
      ...(order === undefined ? {} : { order }),
      ...(port === undefined ? {} : { port }),
      verbose,
      json,
      runtime,
      open,
      dryRun,
      fix,
      help,
      version,
      ...(quiet ? { quiet } : {}),
      ...(noColor ? { noColor } : {}),
      ...(url === undefined ? {} : { url }),
      ...(session === undefined ? {} : { session }),
      ...(namespace === undefined ? {} : { namespace }),
      ...(line === undefined ? {} : { line }),
      ...(output === undefined ? {} : { output }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
      ...(max === undefined ? {} : { max }),
      ...(atSeq === undefined ? {} : { atSeq }),
    }
  if (command === undefined) throw new CliUsageError('A command is required: build, check, dev, test, package, inspect, or add.')
  return {
    command,
    ...(inspectTarget === undefined ? {} : { inspectTarget }),
    ...(addTarget === undefined ? {} : { addTarget }),
    ...(platformArgs.length === 0 ? {} : { platformArgs }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(root === undefined ? {} : { root }),
    ...(slot === undefined ? {} : { slot }),
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(event === undefined ? {} : { event }),
    ...(provider === undefined ? {} : { provider }),
    ...(file === undefined ? {} : { file }),
    ...(id === undefined ? {} : { id }),
    ...(order === undefined ? {} : { order }),
    ...(port === undefined ? {} : { port }),
    verbose,
    json,
    runtime,
    open,
    dryRun,
    fix,
    help,
    version,
    ...(quiet ? { quiet } : {}),
    ...(noColor ? { noColor } : {}),
    ...(url === undefined ? {} : { url }),
    ...(session === undefined ? {} : { session }),
    ...(namespace === undefined ? {} : { namespace }),
    ...(line === undefined ? {} : { line }),
    ...(output === undefined ? {} : { output }),
    ...(agentPreset === undefined ? {} : { agentPreset }),
    ...(max === undefined ? {} : { max }),
    ...(atSeq === undefined ? {} : { atSeq }),
  }
}
