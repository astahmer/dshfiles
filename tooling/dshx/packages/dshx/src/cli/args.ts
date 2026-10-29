import { parseArgs as parseCittyArgs } from 'citty'
import type { ArgsDef } from 'citty'

export type CliCommand = keyof typeof cliCommandMetadata
export type CliInspectTarget = 'slots' | 'tools' | 'services' | 'events'
export type CliAddTarget = 'ui' | 'panel' | 'api' | 'tool' | 'command' | 'hook'

export interface CliArgs {
  readonly command?: CliCommand
  readonly inspectTarget?: CliInspectTarget
  readonly addTarget?: CliAddTarget
  readonly platformArgs?: readonly string[]
  readonly cwd?: string
  readonly root?: string
  readonly explain: boolean
  readonly boot: boolean
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
  readonly hostSelector?: string
  readonly local?: boolean
  readonly sshTarget?: string
  readonly launchUrlEnv?: string
  readonly unit?: string
  readonly remoteHome?: string
  readonly directoryOnly?: boolean
  readonly line?: string
  readonly output?: string
  readonly agentPreset?: string
  readonly title?: string
  readonly mode?: 'queue' | 'steer'
  readonly reasoningEffort?: string
  readonly max?: number
  readonly atSeq?: number
  readonly principal?: string
  readonly delivery?: 'quiet' | 'queue'
  readonly priority?: 'normal' | 'urgent'
  readonly topic?: string
  readonly limit?: number
  readonly sinceSeq?: number
  readonly tail?: number
  readonly types?: readonly string[]
  readonly follow?: boolean
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

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
  explain: {
    type: 'boolean',
    description: 'Explain a Client slot offline: declaring package, imports, owner props.',
  },
  boot: {
    type: 'boolean',
    description: 'Boot a throwaway profile and report whether the plugin actually loads.',
  },

  verbose: {
    type: 'boolean',
    description: 'Print underlying command failures.',
  },
  json: { type: 'boolean', description: 'Emit stable machine-readable JSON.' },
  runtime: {
    type: 'boolean',
    description: 'Require a linked and reachable DSH runtime when checking.',
  },
  open: { type: 'boolean', description: 'Open the development URL.' },
  port: {
    type: 'string',
    description: 'Set the DSH Web development port; with check --boot, use 0 to let the OS choose.',
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
  title: {
    type: 'string',
    description: 'Set the new Session title; without it the Host titles the Session from its first message.',
    valueHint: 'title',
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
    description: 'Plan add or check --fix changes without writing files.',
  },
  fix: { type: 'boolean', description: 'Repair safe manifest issues.' },
  quiet: {
    type: 'boolean',
    description: 'Suppress human-readable output; retain exit status.',
  },
  noColor: { type: 'boolean', description: 'Disable terminal colors.' },
  url: {
    type: 'string',
    description: 'Tokenized local DSH launch URL (defaults to DSHX_URL).',
    valueHint: 'url',
  },
  session: {
    type: 'string',
    description: 'Scope this operation to a DSH Session.',
    valueHint: 'id',
  },
  host: {
    type: 'string',
    description: 'Select one registered host or runtime for Session commands.',
    valueHint: 'id',
  },
  local: { type: 'boolean', description: 'Register a local execution host.' },
  sshTarget: {
    type: 'string',
    description: 'Register an SSH host target that already has a trusted host key.',
    valueHint: 'user@host',
  },
  launchUrlEnv: {
    type: 'string',
    description: 'Read a local runtime launch URL from this environment variable.',
    valueHint: 'variable',
  },
  unit: { type: 'string', description: 'Remote systemd user unit for a DSH runtime.', valueHint: 'unit' },
  remoteHome: { type: 'string', description: 'Remote DSH_HOME for a DSH runtime.', valueHint: 'path' },
  directoryOnly: { type: 'boolean', description: 'Remove directory references while keeping remote runtime data.' },
  line: {
    type: 'string',
    description: 'Run one slash-prefixed DSH command line.',
    valueHint: 'command',
  },
  output: {
    type: 'string',
    description: 'Write an export to this file.',
    valueHint: 'path',
  },
  agentPreset: {
    type: 'string',
    description: 'Create the Session with this DSH Agent preset.',
    valueHint: 'id',
  },
  mode: {
    type: 'string',
    description: 'Deliver a Session prompt by queueing or steering the active turn.',
    valueHint: 'queue|steer',
  },
  reasoningEffort: {
    type: 'string',
    description: 'Select a model reasoning effort reported by DSH.',
    valueHint: 'id',
  },
  max: {
    type: 'string',
    description: 'Maximum messages to return in one history page.',
    valueHint: 'count',
  },
  atSeq: {
    type: 'string',
    description: 'Fork at this inclusive Session event sequence.',
    valueHint: 'sequence',
  },
  principal: {
    type: 'string',
    description: 'Stable external DSHX communication identity.',
    valueHint: 'name',
  },
  delivery: {
    type: 'string',
    description: 'External topic delivery: quiet or queue.',
    valueHint: 'quiet|queue',
  },
  priority: {
    type: 'string',
    description: 'Communication message priority.',
    valueHint: 'normal|urgent',
  },
  topic: {
    type: 'string',
    description: 'Filter communication inbox by topic.',
    valueHint: 'topic',
  },
  limit: {
    type: 'string',
    description: 'Maximum communication messages, diagnostic rows, or digest actions to return.',
    valueHint: 'count',
  },
  sinceSeq: {
    type: 'string',
    description: 'Only Session events after this sequence number.',
    valueHint: 'sequence',
  },
  tail: {
    type: 'string',
    description: 'Only the newest matching Session events.',
    valueHint: 'count',
  },
  types: {
    type: 'string',
    description: 'Comma-separated Session event types; a prefix such as tool matches tool/call and tool/result.',
    valueHint: 'type,...',
  },
  follow: { type: 'boolean', description: 'Keep printing new Session events until interrupted.' },
  help: { type: 'boolean', alias: 'h', description: 'Show command help.' },
  version: {
    type: 'boolean',
    alias: 'V',
    description: 'Show the installed version.',
  },
} as const

type SharedArgDefinition = {
  readonly type: 'boolean' | 'string'
  readonly alias?: string | readonly string[]
}

const optionDefinitions = new Map<string, SharedArgDefinition>()
const toKebabCase = (value: string): string => value.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)

for (const [name, definition] of Object.entries<SharedArgDefinition>(sharedArgs)) {
  optionDefinitions.set(`--${toKebabCase(name)}`, definition)
  if (definition.alias !== undefined) {
    const aliases = typeof definition.alias === 'string' ? [definition.alias] : definition.alias
    for (const alias of aliases) optionDefinitions.set(`-${alias}`, definition)
  }
}

/** Citty command metadata is the single declaration of DSHX commands and options. */
export const cliCommandMetadata = {
  create: 'Create a DSHX plugin project.',
  test: 'Run project-local Vitest tests.',
  package: 'Build, validate, and pack a native plugin bundle.',
  publish: 'Validate that a plugin package is ready for a registry publish without uploading it (publish --dry-run).',
  build: 'Build Host and Client plugin artifacts.',
  check: 'Validate compatibility and project wiring; check repo runs repository health checks (dshx check repo --help).',
  dev: 'Run a compatibility-aware DSH development session; dev up|doctor|open|shot|down drive a scratch DSH (dshx dev up --help).',
  checkout: 'Bring the jj checkout that runs DSH onto main, then reinstall and rebuild what changed (dshx checkout sync --help).',
  inspect: 'Inspect Slots, Tools, Services, or Events.',
  add: 'Scaffold a slot, a panel, an API, a Tool, a Command, or a Hook contribution; or install a plugin into a profile (dshx add <package> --help).',
  update: 'Move a plugin installed in a profile to a newer version (dshx update --help).',
  remove: 'Uninstall a plugin from a profile (dshx remove --help).',
  status: 'Report the running local DSH: process, launch revision, plugin activation, and bundles.',
  info: 'Show local DSHX and Node runtime information.',
  doctor: 'Diagnose local DSHX and reachable DSH APIs.',
  presets: 'List or inspect DSH Agent presets.',
  models: 'List or select DSH models.',
  skills: 'List Session skills.',
  sessions: 'List, inspect, create, fork, cancel, and export DSH Sessions.',
  plugins: 'List, inspect, enable, and disable DSH plugins.',
  bundles: 'List, inspect, enable, and disable DSH bundles.',
  commands: 'Inspect and run Session-scoped DSH commands.',
  config: 'Read and update one DSH settings namespace.',
  host: 'Record, verify, and select execution machines and DSH runtimes.',
  runtime: 'Register, verify, select, and remove remote DSH runtimes.',
  workspace: 'Create or open remote Workspaces on a recorded host.',
  comm: 'Exchange durable messages between DSH Agents and external MCP clients.',
} satisfies Readonly<Record<string, string>>

const isCliCommand = (value: string | undefined): value is CliCommand => value !== undefined && Object.hasOwn(cliCommandMetadata, value)
const cliInspectTargets: ReadonlySet<string> = new Set(['slots', 'tools', 'services', 'events'])
const cliAddTargets: ReadonlySet<string> = new Set(['ui', 'panel', 'api', 'tool', 'command', 'hook'])
const isCliInspectTarget = (value: string): value is CliInspectTarget => cliInspectTargets.has(value)
const isCliAddTarget = (value: string): value is CliAddTarget => cliAddTargets.has(value)

const platformCommands: ReadonlySet<CliCommand> = new Set([
  'status',
  'info',
  'doctor',
  'sessions',
  'plugins',
  'bundles',
  'presets',
  'models',
  'skills',
  'commands',
  'config',
  'host',
  'runtime',
  'workspace',
  'comm',
])

const isPlatformCommand = (command: CliCommand | undefined): boolean => command !== undefined && platformCommands.has(command)

export interface CliOptionContext {
  readonly command: CliCommand | undefined
  readonly action: string | undefined
  readonly inspectTarget: CliInspectTarget | undefined
  readonly addTarget: CliAddTarget | undefined
  readonly boot: boolean
  readonly fix: boolean
}

interface OptionScope {
  readonly allows: (context: CliOptionContext) => boolean
  readonly usage: string
}

const platformAction =
  (command: CliCommand, ...actions: string[]) =>
  (context: CliOptionContext) =>
    context.command === command && actions.includes(context.action ?? '')

const addTargets =
  (...targets: CliAddTarget[]) =>
  (context: CliOptionContext) =>
    context.command === 'add' && targets.includes(context.addTarget ?? 'ui')

const inspectSlots = (context: CliOptionContext) => context.command === 'inspect' && context.inspectTarget === 'slots'

/** Where each option is accepted: the one place a command gains or loses an option. */
const optionScopes: ReadonlyMap<string, OptionScope> = new Map([
  [
    'json',
    {
      allows: ({ command, action }) =>
        command === 'check' || command === 'inspect' || command === 'add' || (isPlatformCommand(command) && !(command === 'comm' && action === 'mcp')),
      usage: '--json is only valid with check, inspect, add, or DSH platform commands.',
    },
  ],
  ['open', { allows: ({ command }) => command === 'dev', usage: '--open is only valid with dev.' }],
  [
    'port',
    {
      allows: ({ command, boot }) => command === 'dev' || (command === 'check' && boot),
      usage: '--port is only valid with dev or check --boot.',
    },
  ],
  [
    'dryRun',
    {
      allows: ({ command, fix }) => command === 'add' || command === 'publish' || (command === 'check' && fix),
      usage: 'DSHX4147: --dry-run is only valid with add commands, publish, or check --fix.',
    },
  ],
  ['fix', { allows: ({ command }) => command === 'check', usage: 'DSHX4147: --fix is only valid with check.' }],
  ['runtime', { allows: ({ command }) => command === 'check', usage: '--runtime is only valid with check.' }],
  ['boot', { allows: ({ command }) => command === 'check', usage: '--boot is only valid with check.' }],
  [
    'url',
    {
      allows: ({ command }) => isPlatformCommand(command) && command !== 'info' && command !== 'comm',
      usage: '--url is not used by this DSH platform command.',
    },
  ],
  [
    'cwd',
    {
      allows: context => !isPlatformCommand(context.command) || platformAction('sessions', 'create', 'start')(context),
      usage: '--cwd is only valid with sessions create or sessions start among DSH platform commands.',
    },
  ],
  [
    'session',
    {
      allows: context => context.command === 'commands' || context.command === 'skills' || platformAction('models', 'select')(context),
      usage: '--session is only valid with commands, models select, or skills.',
    },
  ],
  [
    'host',
    {
      allows: platformAction(
        'sessions',
        'list',
        'search',
        'show',
        'history',
        'create',
        'start',
        'fork',
        'cancel',
        'rename',
        'archive',
        'unarchive',
        'prompt',
        'export',
        'digest',
        'tail',
      ),
      usage: '--host is only valid with sessions commands.',
    },
  ],
  ['local', { allows: platformAction('host', 'add'), usage: '--local is only valid with host add.' }],
  ['sshTarget', { allows: platformAction('host', 'add'), usage: '--ssh-target is only valid with host add.' }],
  ['launchUrlEnv', { allows: platformAction('runtime', 'add'), usage: '--launch-url-env is only valid with runtime add.' }],
  ['unit', { allows: platformAction('runtime', 'add'), usage: '--unit is only valid with runtime add.' }],
  ['remoteHome', { allows: platformAction('runtime', 'add'), usage: '--remote-home is only valid with runtime add.' }],
  ['directoryOnly', { allows: platformAction('host', 'remove'), usage: '--directory-only is only valid with host remove.' }],
  ['line', { allows: platformAction('commands', 'run'), usage: '--line is only valid with commands run.' }],
  [
    'file',
    {
      allows: context => context.command === 'test' || addTargets('ui', 'tool', 'command', 'hook')(context),
      usage: '--file is only valid with test or add ui, tool, command, or hook.',
    },
  ],
  ['output', { allows: platformAction('sessions', 'export'), usage: '--output is only valid with sessions export.' }],
  ['agentPreset', { allows: platformAction('sessions', 'create', 'start'), usage: '--agent-preset is only valid with sessions create or sessions start.' }],
  ['title', { allows: platformAction('sessions', 'start'), usage: '--title is only valid with sessions start.' }],
  ['mode', { allows: platformAction('sessions', 'prompt'), usage: '--mode is only valid with sessions prompt.' }],
  ['reasoningEffort', { allows: platformAction('models', 'select'), usage: '--reasoning-effort is only valid with models select.' }],
  ['max', { allows: platformAction('sessions', 'history'), usage: '--max is only valid with sessions history.' }],
  ['atSeq', { allows: platformAction('sessions', 'fork'), usage: '--at-seq is only valid with sessions fork.' }],
  ['principal', { allows: ({ command }) => command === 'comm', usage: '--principal is only valid with comm commands.' }],
  ['delivery', { allows: platformAction('comm', 'subscribe'), usage: '--delivery is only valid with comm subscribe.' }],
  ['priority', { allows: platformAction('comm', 'publish', 'send'), usage: '--priority is only valid with comm publish or send.' }],
  ['topic', { allows: platformAction('comm', 'inbox'), usage: '--topic is only valid with comm inbox.' }],
  [
    'limit',
    {
      allows: context =>
        platformAction('comm', 'inbox', 'report')(context) || platformAction('sessions', 'digest')(context) || platformAction('sessions', 'search')(context),
      usage: '--limit is only valid with comm inbox, comm report, sessions digest, or sessions search.',
    },
  ],
  ['sinceSeq', { allows: platformAction('sessions', 'export', 'tail'), usage: '--since-seq is only valid with sessions export or sessions tail.' }],
  ['tail', { allows: platformAction('sessions', 'export', 'tail'), usage: '--tail is only valid with sessions export or sessions tail.' }],
  ['types', { allows: platformAction('sessions', 'export', 'tail'), usage: '--types is only valid with sessions export or sessions tail.' }],
  ['follow', { allows: platformAction('sessions', 'tail'), usage: '--follow is only valid with sessions tail.' }],
  ['slot', { allows: addTargets('ui'), usage: 'Slot options are only valid with add ui.' }],
  ['provider', { allows: addTargets('ui'), usage: 'Slot options are only valid with add ui.' }],
  ['order', { allows: addTargets('ui'), usage: 'Slot options are only valid with add ui.' }],
  ['id', { allows: ({ command }) => command === 'add', usage: '--id is only valid with add commands.' }],
  ['name', { allows: addTargets('tool', 'command'), usage: 'Name and description options are only valid with add tool or add command.' }],
  ['description', { allows: addTargets('tool', 'command'), usage: 'Name and description options are only valid with add tool or add command.' }],
  ['event', { allows: addTargets('hook'), usage: '--event is only valid with add hook.' }],
  ['root', { allows: inspectSlots, usage: '--root is only valid with inspect slots.' }],
  ['explain', { allows: inspectSlots, usage: '--explain is only valid with inspect slots.' }],
])

const isSet = (value: unknown): boolean => value !== undefined && value !== false

const validateOptionScopes = (options: Readonly<Record<string, unknown>>, context: CliOptionContext): void => {
  for (const [option, value] of Object.entries(options)) {
    const scope = optionScopes.get(option)
    if (scope !== undefined && isSet(value) && !scope.allows(context)) throw new CliUsageError(scope.usage)
  }
}

const cliArgsForContext = (context: CliOptionContext): ArgsDef => {
  const args: ArgsDef = {}
  for (const [name, definition] of Object.entries(sharedArgs)) {
    const scope = optionScopes.get(name)
    if (scope !== undefined && !scope.allows(context)) continue
    const required =
      name === 'session' && (context.command === 'commands' || context.command === 'skills' || (context.command === 'models' && context.action === 'select'))
    args[toKebabCase(name)] = required ? { ...definition, required: true } : definition
  }
  return args
}

const cliArgsCommonToContexts = (contexts: readonly CliOptionContext[]): ArgsDef => {
  const [firstContext, ...remainingContexts] = contexts
  if (firstContext === undefined) return {}
  const firstArgs = cliArgsForContext(firstContext)
  const args: ArgsDef = {}
  for (const [name, definition] of Object.entries(firstArgs)) {
    if (remainingContexts.every(context => Object.hasOwn(cliArgsForContext(context), name))) args[name] = definition
  }
  return args
}

function validateOptionTokens(argv: readonly string[]): void {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('-')) continue
    const definition = optionDefinitions.get(token)
    if (definition === undefined) throw new CliUsageError(`Unknown argument ${JSON.stringify(token)}.`)
    if (definition.type === 'boolean') continue
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
      command === 'sessions' ||
      command === 'plugins' ||
      command === 'bundles' ||
      command === 'presets' ||
      command === 'models' ||
      command === 'skills' ||
      command === 'commands' ||
      command === 'config' ||
      command === 'host' ||
      command === 'runtime' ||
      command === 'workspace' ||
      command === 'comm'
    ) {
      platformArgs.push(token)
      continue
    }
    if (isCliCommand(token)) {
      if (command !== undefined) throw new CliUsageError('Only one command may be specified.')
      command = token
      continue
    }
    if (command === 'inspect' && isCliInspectTarget(token)) {
      if (inspectTarget !== undefined) throw new CliUsageError('Only one inspect target may be specified.')
      inspectTarget = token
      continue
    }
    if (command !== 'inspect' && cliInspectTargets.has(token)) {
      throw new CliUsageError('Inspect targets are only valid with the inspect command.')
    }
    if (command === 'add' && isCliAddTarget(token)) {
      if (addTarget !== undefined) throw new CliUsageError('Only one add target may be specified.')
      addTarget = token
      continue
    }
    throw new CliUsageError(`Unknown argument ${JSON.stringify(token)}.`)
  }

  const cwd = parsed.cwd
  const root = parsed.root
  const explain = parsed.explain
  const boot = parsed.boot
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
  const hostSelector = parsed.host
  const local = parsed.local ?? false
  const sshTarget = parsed.sshTarget
  const launchUrlEnv = parsed.launchUrlEnv
  const unit = parsed.unit
  const remoteHome = parsed.remoteHome
  const directoryOnly = parsed.directoryOnly ?? false
  const line = parsed.line
  const output = parsed.output
  const agentPreset = parsed.agentPreset
  const title = parsed.title
  const mode = parsed.mode
  if (mode !== undefined && mode !== 'queue' && mode !== 'steer') throw new CliUsageError('--mode requires queue or steer.')
  const reasoningEffort = parsed.reasoningEffort
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
  const principal = parsed.principal
  const delivery = parsed.delivery
  const priority = parsed.priority
  const topic = parsed.topic
  let limit: number | undefined
  if (delivery !== undefined && delivery !== 'quiet' && delivery !== 'queue') {
    throw new CliUsageError('--delivery requires quiet or queue for external communication clients.')
  }
  if (priority !== undefined && priority !== 'normal' && priority !== 'urgent') throw new CliUsageError('--priority requires normal or urgent.')
  if (principal !== undefined && !/^[a-zA-Z0-9._-]{1,64}$/.test(principal)) {
    throw new CliUsageError('--principal requires 1 to 64 letters, digits, dot, underscore, or hyphen.')
  }
  if (parsed.limit !== undefined) {
    limit = Number(parsed.limit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new CliUsageError('--limit requires an integer from 1 to 500.')
  }
  let sinceSeq: number | undefined
  let tail: number | undefined
  if (parsed.sinceSeq !== undefined) {
    sinceSeq = Number(parsed.sinceSeq)
    if (!Number.isSafeInteger(sinceSeq) || sinceSeq < 0) throw new CliUsageError('--since-seq requires a non-negative safe integer.')
  }
  if (parsed.tail !== undefined) {
    tail = Number(parsed.tail)
    if (!Number.isSafeInteger(tail) || tail < 1 || tail > 100_000) throw new CliUsageError('--tail requires an integer from 1 to 100000.')
  }
  const rawTypes: unknown = parsed.types
  const types =
    typeof rawTypes === 'string'
      ? rawTypes
          .split(',')
          .map(type => type.trim())
          .filter(type => type.length > 0)
      : undefined
  if (types !== undefined && types.length === 0) throw new CliUsageError('--types requires at least one event type.')
  const follow = parsed.follow ?? false
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

  const platformCommand = isPlatformCommand(command)
  if ((json || open || port !== undefined) && command === undefined) throw new CliUsageError('An option requires a command.')
  validateOptionScopes(
    {
      json,
      open,
      port,
      dryRun,
      fix,
      runtime,
      url,
      cwd,
      session,
      host: hostSelector,
      local,
      sshTarget,
      launchUrlEnv,
      unit,
      remoteHome,
      directoryOnly,
      line,
      output,
      agentPreset,
      title,
      mode,
      reasoningEffort,
      max,
      atSeq,
      principal,
      delivery,
      priority,
      topic,
      limit,
      sinceSeq,
      tail,
      types,
      follow,
      slot,
      provider,
      id,
      order,
      name,
      description,
      event,
      file,
      root,
      explain,
      boot,
    },
    { command, action: platformArgs[0], inspectTarget, addTarget, boot: boot === true, fix },
  )
  if (command === 'comm' && !help) {
    const [action, first, ...extra] = platformArgs
    const actions = ['agents', 'topics', 'report', 'subscribe', 'unsubscribe', 'publish', 'send', 'inbox', 'ack', 'mcp']
    if (!actions.includes(action ?? '')) throw new CliUsageError(`comm requires ${actions.join(', ')}.`)
    if (['subscribe', 'unsubscribe', 'ack'].includes(action ?? '') && first === undefined) throw new CliUsageError(`comm ${action} requires an id.`)
    if (['publish', 'send'].includes(action ?? '') && (first === undefined || extra.join(' ').trim().length === 0)) {
      throw new CliUsageError(`comm ${action} requires a target and message text.`)
    }
    if (['agents', 'topics', 'report', 'inbox', 'mcp'].includes(action ?? '') && first !== undefined)
      throw new CliUsageError(`comm ${action} accepts no positional arguments.`)
    if (['subscribe', 'unsubscribe', 'ack'].includes(action ?? '') && extra.length > 0)
      throw new CliUsageError(`comm ${action} accepts one positional argument.`)
    if (action === 'mcp' && (json || delivery !== undefined || priority !== undefined || topic !== undefined || limit !== undefined)) {
      throw new CliUsageError('comm mcp does not accept --json or inbox/message options.')
    }
  }
  if (command === 'status' || command === 'info' || command === 'doctor') {
    if (parsed._.length > 1 && !help) throw new CliUsageError(`${command} does not accept positional arguments.`)
  }
  if (command === 'sessions' && !help) {
    const [action, sessionId, ...extra] = platformArgs
    const actions = [
      'list',
      'search',
      'show',
      'history',
      'create',
      'start',
      'fork',
      'cancel',
      'rename',
      'archive',
      'unarchive',
      'prompt',
      'export',
      'digest',
      'tail',
    ]
    if (!actions.includes(action ?? '')) throw new CliUsageError(`sessions requires ${actions.join(', ')}.`)
    if (['show', 'history', 'fork', 'cancel', 'rename', 'archive', 'unarchive', 'prompt', 'export', 'digest', 'tail'].includes(action ?? '') && !sessionId)
      throw new CliUsageError(`sessions ${action} requires a Session id.`)
    if (action === 'search' && !sessionId) throw new CliUsageError('sessions search requires a query.')
    if (action === 'prompt' && extra.join(' ').trim().length === 0) throw new CliUsageError('sessions prompt requires message text.')
    if (action === 'rename' && extra.join(' ').trim().length === 0) throw new CliUsageError('sessions rename requires a title.')
    if (!['search', 'prompt', 'rename', 'start'].includes(action ?? '') && extra.length > 0)
      throw new CliUsageError(`sessions ${action} accepts no extra positional arguments.`)
    if (['list', 'create'].includes(action ?? '') && sessionId !== undefined) throw new CliUsageError(`sessions ${action} accepts no positional argument.`)
  }
  if ((command === 'plugins' || command === 'bundles') && !help) {
    const [action, id, ...extra] = platformArgs
    const actions = command === 'plugins' ? ['list', 'info', 'check', 'enable', 'disable'] : ['list', 'info', 'install', 'remove', 'enable', 'disable']
    if (!actions.includes(action ?? '')) throw new CliUsageError(`${command} requires ${actions.join(', ')}.`)
    if (['info', 'check', 'enable', 'disable', 'install', 'remove'].includes(action ?? '') && !id) {
      const target = (command === 'plugins' && action === 'check') || (command === 'bundles' && action === 'install') ? 'a package spec' : 'an id'
      throw new CliUsageError(`${command} ${action} requires ${target}.`)
    }
    if (extra.length > 0 || (action === 'list' && id !== undefined)) throw new CliUsageError(`${command} ${action} accepts no extra positional arguments.`)
  }
  if (command === 'presets' && !help) {
    const [action, id, ...extra] = platformArgs
    if (!['list', 'show'].includes(action ?? '')) throw new CliUsageError('presets requires list or show.')
    if (action === 'show' && !id) throw new CliUsageError('presets show requires an Agent preset id.')
    if (extra.length > 0 || (action === 'list' && id !== undefined)) throw new CliUsageError(`presets ${action} accepts no extra positional arguments.`)
  }
  if (command === 'models' && !help) {
    const [action, provider, model, ...extra] = platformArgs
    if (!['list', 'select'].includes(action ?? '')) throw new CliUsageError('models requires list or select.')
    if (action === 'select' && session === undefined) throw new CliUsageError('models select requires --session <id>.')
    if (action === 'select' && (!provider || !model)) throw new CliUsageError('models select requires a provider and model id.')
    if (action === 'list' && (provider !== undefined || extra.length > 0)) throw new CliUsageError('models list accepts no positional arguments.')
    if (action === 'select' && extra.length > 0) throw new CliUsageError('models select accepts one provider and one model id.')
  }
  if (command === 'skills' && !help) {
    const [action, ...extra] = platformArgs
    if (action !== 'list') throw new CliUsageError('skills currently supports list.')
    if (session === undefined) throw new CliUsageError('skills list requires --session <id>.')
    if (extra.length > 0) throw new CliUsageError('skills list accepts no extra positional arguments.')
  }
  if (command === 'commands' && !help) {
    const [action, commandName, ...extra] = platformArgs
    if (!['list', 'info', 'run'].includes(action ?? '')) throw new CliUsageError('commands requires list, info, or run.')
    if (session === undefined) throw new CliUsageError(`commands ${action} requires --session <id>.`)
    if (line !== undefined && action !== 'run') throw new CliUsageError('--line is only valid with commands run.')
    if (action === 'run' && line !== undefined && platformArgs.length > 1) throw new CliUsageError('Use either a command line argument or --line, not both.')
    if (action === 'info' && !commandName) throw new CliUsageError('commands info requires a command name.')
    if (action === 'run' && line === undefined && platformArgs.length < 2) throw new CliUsageError('commands run requires a slash-prefixed line or --line.')
    if (action !== 'run' && (commandName !== undefined || extra.length > 0))
      throw new CliUsageError(`commands ${action} accepts no extra positional arguments.`)
  }
  if (command === 'config' && !help) {
    const [action, namespace, path, ...extra] = platformArgs
    if (!['list', 'get', 'set', 'unset'].includes(action ?? '')) throw new CliUsageError('config requires list, get, set, or unset.')
    if (action !== 'list' && namespace === undefined) throw new CliUsageError(`config ${action} requires a settings namespace.`)
    if (action === 'get' && extra.length > 0) throw new CliUsageError('config get accepts one optional path.')
    if ((action === 'set' || action === 'unset') && path === undefined) throw new CliUsageError(`config ${action} requires a settings path.`)
    if (action === 'set' && extra.length === 0) throw new CliUsageError('config set requires a JSON value.')
    if (action === 'unset' && extra.length > 0) throw new CliUsageError('config unset accepts no JSON value.')
    if (action === 'list' && (namespace !== undefined || path !== undefined || extra.length > 0))
      throw new CliUsageError('config list accepts no namespace or path.')
  }
  if (command === 'host' && !help) {
    const [action, id, ...nameParts] = platformArgs
    if (!['list', 'status', 'add', 'remove'].includes(action ?? '')) throw new CliUsageError('host requires list, status, add, or remove.')
    if (action === 'list' && id !== undefined) throw new CliUsageError('host list accepts no positional arguments.')
    if (action === 'status' && (id === undefined || nameParts.length > 0)) throw new CliUsageError('host status requires exactly one host id.')
    if (action === 'remove' && (id === undefined || nameParts.length > 0)) throw new CliUsageError('host remove requires exactly one host id.')
    if (action === 'add') {
      if (id === undefined || nameParts.join(' ').trim().length === 0) throw new CliUsageError('host add requires an id and display name.')
      if (local === (sshTarget !== undefined)) throw new CliUsageError('host add requires exactly one of --local or --ssh-target <user@host>.')
    }
  }
  if (command === 'runtime' && !help) {
    const [action, id, ...nameParts] = platformArgs
    if (!['list', 'status', 'add', 'remove'].includes(action ?? '')) throw new CliUsageError('runtime requires list, status, add, or remove.')
    if (action === 'list' && platformArgs.length > 2) throw new CliUsageError('runtime list accepts at most one host id.')
    if (action === 'status' && (id === undefined || nameParts.length > 0)) throw new CliUsageError('runtime status requires exactly one runtime id.')
    if (action === 'remove' && (id === undefined || nameParts.length > 0)) throw new CliUsageError('runtime remove requires exactly one runtime id.')
    if (action === 'add') {
      if (id === undefined || nameParts.join(' ').trim().length === 0) throw new CliUsageError('runtime add requires a host id and display name.')
      const localRuntime = launchUrlEnv !== undefined
      const sshRuntime = unit !== undefined || remoteHome !== undefined
      if (localRuntime === sshRuntime)
        throw new CliUsageError('runtime add requires --launch-url-env <name> for local runtimes, or both --unit and --remote-home for SSH runtimes.')
      if (sshRuntime && (unit === undefined || remoteHome === undefined)) throw new CliUsageError('SSH runtime add requires both --unit and --remote-home.')
      if (launchUrlEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(launchUrlEnv))
        throw new CliUsageError('--launch-url-env requires an environment variable name.')
    }
  }
  if (command === 'workspace' && !help) {
    const [action, id, ...pathParts] = platformArgs
    if (!['list', 'open'].includes(action ?? '')) throw new CliUsageError('workspace requires list or open.')
    if (action === 'list' && (id === undefined || pathParts.length > 0)) throw new CliUsageError('workspace list requires exactly one host or runtime id.')
    if (action === 'open' && (id === undefined || pathParts.join(' ').trim().length === 0))
      throw new CliUsageError('workspace open requires a host or runtime id and an absolute path.')
  }
  if (!platformCommand && platformArgs.length > 0) throw new CliUsageError('Unexpected positional arguments.')
  if (command !== 'inspect' && inspectTarget !== undefined) throw new CliUsageError('Inspect targets are only valid with the inspect command.')
  if (command !== 'add' && addTarget !== undefined) throw new CliUsageError('Add targets are only valid with the add command.')
  if (command === 'inspect' && inspectTarget === undefined && !help && !version)
    throw new CliUsageError('Inspect requires a target: slots, tools, services, or events.')
  if (command === 'add' && addTarget === undefined && !help && !version)
    throw new CliUsageError('Add requires a target: ui, panel, api, tool, command, or hook.')
  if (help || version)
    return {
      explain: false,
      boot: false,
      ...(command !== undefined && { command }),
      ...(inspectTarget !== undefined && { inspectTarget }),
      ...(addTarget !== undefined && { addTarget }),
      ...(platformArgs.length !== 0 && { platformArgs }),
      ...(cwd !== undefined && { cwd }),
      ...(root !== undefined && { root }),
      ...(slot !== undefined && { slot }),
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(event !== undefined && { event }),
      ...(provider !== undefined && { provider }),
      ...(file !== undefined && { file }),
      ...(id !== undefined && { id }),
      ...(order !== undefined && { order }),
      ...(port !== undefined && { port }),
      verbose,
      json,
      runtime,
      open,
      dryRun,
      fix,
      help,
      version,
      ...(quiet ? { quiet } : undefined),
      ...(noColor ? { noColor } : undefined),
      ...(url !== undefined && { url }),
      ...(session !== undefined && { session }),
      ...(line !== undefined && { line }),
      ...(output !== undefined && { output }),
      ...(agentPreset !== undefined && { agentPreset }),
      ...(mode !== undefined && { mode }),
      ...(reasoningEffort !== undefined && { reasoningEffort }),
      ...(max !== undefined && { max }),
      ...(atSeq !== undefined && { atSeq }),
      ...(principal !== undefined && { principal }),
      ...(delivery !== undefined && { delivery }),
      ...(priority !== undefined && { priority }),
      ...(topic !== undefined && { topic }),
      ...(limit !== undefined && { limit }),
    }
  if (command === undefined && !help && !version) {
    throw new CliUsageError(`A command is required: ${Object.keys(cliCommandMetadata).join(', ')}.`)
  }
  return {
    ...(command !== undefined && { command }),
    explain: explain === true,
    boot: boot === true,
    ...(inspectTarget !== undefined && { inspectTarget }),
    ...(addTarget !== undefined && { addTarget }),
    ...(platformArgs.length !== 0 && { platformArgs }),
    ...(cwd !== undefined && { cwd }),
    ...(root !== undefined && { root }),
    ...(slot !== undefined && { slot }),
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(event !== undefined && { event }),
    ...(provider !== undefined && { provider }),
    ...(file !== undefined && { file }),
    ...(id !== undefined && { id }),
    ...(order !== undefined && { order }),
    ...(port !== undefined && { port }),
    verbose,
    json,
    runtime,
    open,
    dryRun,
    fix,
    help,
    version,
    ...(quiet ? { quiet } : undefined),
    ...(noColor ? { noColor } : undefined),
    ...(url !== undefined && { url }),
    ...(session !== undefined && { session }),
    ...(hostSelector !== undefined && { hostSelector }),
    ...(local ? { local } : undefined),
    ...(sshTarget !== undefined && { sshTarget }),
    ...(launchUrlEnv !== undefined && { launchUrlEnv }),
    ...(unit !== undefined && { unit }),
    ...(remoteHome !== undefined && { remoteHome }),
    ...(directoryOnly ? { directoryOnly } : undefined),
    ...(line !== undefined && { line }),
    ...(output !== undefined && { output }),
    ...(agentPreset !== undefined && { agentPreset }),
    ...(title !== undefined && { title }),
    ...(mode !== undefined && { mode }),
    ...(reasoningEffort !== undefined && { reasoningEffort }),
    ...(max !== undefined && { max }),
    ...(atSeq !== undefined && { atSeq }),
    ...(principal !== undefined && { principal }),
    ...(delivery !== undefined && { delivery }),
    ...(priority !== undefined && { priority }),
    ...(topic !== undefined && { topic }),
    ...(limit !== undefined && { limit }),
    ...(sinceSeq !== undefined && { sinceSeq }),
    ...(tail !== undefined && { tail }),
    ...(types !== undefined && { types }),
    ...(follow ? { follow } : undefined),
  }
}

export class CliOptionMetadata {
  static readonly commandMetadata = cliCommandMetadata
  static readonly argsForContext = cliArgsForContext
  static readonly isAddTarget = isCliAddTarget
  static readonly commonArgsToContexts = cliArgsCommonToContexts
}
