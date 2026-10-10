import { defineCommand, renderUsage } from 'citty'
import type { ArgsDef, CommandDef, PositionalArgDef } from 'citty'
import { cliArgsCommonToContexts, cliArgsForContext, cliCommandMetadata, type CliArgs, type CliCommand, type CliOptionContext } from './args.js'

interface HelpCommandSpec {
  readonly description: string
  readonly positionals?: ArgsDef
}

type HelpCommandSpecs = Readonly<Record<string, HelpCommandSpec>>
const helpActionCommands = new Map<string, CommandDef>()

const positional = (description: string, required = true): PositionalArgDef => ({
  type: 'positional',
  description,
  required,
})

const optionContext = (
  command: CliCommand | undefined,
  action?: string,
  details: Pick<CliOptionContext, 'inspectTarget' | 'addTarget' | 'boot' | 'fix'> = {
    inspectTarget: undefined,
    addTarget: undefined,
    boot: false,
    fix: false,
  },
): CliOptionContext => ({
  command,
  action,
  ...details,
})

const helpCommand = (name: string, description: string, context: CliOptionContext, positionals: ArgsDef = {}): CommandDef =>
  defineCommand({
    meta: { name, description },
    args: { ...cliArgsForContext(context), ...positionals },
  })

const actionHelpGroup = (command: CliCommand, actions: HelpCommandSpecs): CommandDef => {
  const actionContexts = Object.keys(actions).map(action => optionContext(command, action))
  const subCommands: Record<string, CommandDef> = {}
  for (const [action, spec] of Object.entries(actions)) {
    const actionCommand = helpCommand(action, spec.description, optionContext(command, action), spec.positionals)
    subCommands[action] = actionCommand
    helpActionCommands.set(`${command}:${action}`, actionCommand)
  }
  return defineCommand({
    meta: { name: command, description: cliCommandMetadata[command] },
    args: cliArgsCommonToContexts(actionContexts),
    subCommands,
  })
}

const targetHelpGroup = (
  command: 'inspect' | 'add',
  targets: Readonly<Record<string, { readonly description: string; readonly context: CliOptionContext }>>,
): CommandDef => {
  const contexts = Object.values(targets).map(target => target.context)
  const subCommands: Record<string, CommandDef> = {}
  for (const [target, spec] of Object.entries(targets)) {
    const targetCommand = helpCommand(target, spec.description, spec.context)
    subCommands[target] = targetCommand
    helpActionCommands.set(`${command}:${target}`, targetCommand)
  }
  return defineCommand({
    meta: { name: command, description: cliCommandMetadata[command] },
    args: cliArgsCommonToContexts(contexts),
    subCommands,
  })
}

const sessionsHelp = actionHelpGroup('sessions', {
  list: {
    description: 'List Sessions from the selected execution runtime.',
  },
  search: {
    description: 'Search visible Session content; DSH returns at most 20 snippets.',
    positionals: { 'query...': positional('Text to search for.') },
  },
  show: {
    description: 'Show one Session summary.',
    positionals: { 'session-id': positional('Session identifier.') },
  },
  history: {
    description: "Read bounded Session history through DSH's paging API.",
    positionals: { 'session-id': positional('Session identifier.') },
  },
  create: {
    description: 'Create a Session on the selected execution runtime.',
  },
  fork: {
    description: 'Fork a Session, optionally from a sequence number.',
    positionals: { 'session-id': positional('Session identifier.') },
  },
  cancel: {
    description: "Request cancellation of the Session's active work.",
    positionals: { 'session-id': positional('Session identifier.') },
  },
  rename: {
    description: "Rename a Session through DSH's durable Session API.",
    positionals: {
      'session-id': positional('Session identifier.'),
      'title...': positional('New Session title.'),
    },
  },
  archive: {
    description: "Archive a Session through DSH's reversible Workspace API; active work is not stopped.",
    positionals: { 'session-id': positional('Session identifier.') },
  },
  unarchive: {
    description: "Restore a Session through DSH's reversible Workspace API; active work is not stopped.",
    positionals: { 'session-id': positional('Session identifier.') },
  },
  prompt: {
    description: 'Send text to the Session Agent; defaults to queue. Ctrl-C asks DSH to cancel prompt admission.',
    positionals: {
      'session-id': positional('Session identifier.'),
      'message...': positional('Text to send.'),
    },
  },
  export: {
    description: 'Export Session records as versioned DSHX JSON.',
    positionals: { 'session-id': positional('Session identifier.') },
  },
})

const pluginsHelp = actionHelpGroup('plugins', {
  list: { description: 'List runtime plugin entries and their Loader state.' },
  info: {
    description: 'Show one runtime plugin entry.',
    positionals: { 'entry-id': positional('Plugin entry identifier.') },
  },
  check: {
    description: "Check what DSH's plugin manager can install without installing it.",
    positionals: { 'package-spec': positional('Plugin package specifier.') },
  },
  enable: {
    description: 'Change the Host-owned plugin selection and report application or restart state.',
    positionals: { 'entry-id': positional('Plugin entry identifier.') },
  },
  disable: {
    description: 'Change the Host-owned plugin selection and report application or restart state.',
    positionals: { 'entry-id': positional('Plugin entry identifier.') },
  },
})

const bundlesHelp = actionHelpGroup('bundles', {
  list: { description: 'List bundles and their profile-wide selection and install state.' },
  info: {
    description: 'Show one bundle and its rows.',
    positionals: { name: positional('Bundle name.') },
  },
  install: {
    description: "Install through DSH's bundle manager; Ctrl-C asks DSH to cancel and restore profile files.",
    positionals: { 'package-spec': positional('Bundle package specifier.') },
  },
  remove: {
    description: "Remove a profile-owned bundle through DSH's package manager.",
    positionals: { name: positional('Bundle name.') },
  },
  enable: {
    description: 'Change the Host-owned bundle selection and report application or restart state.',
    positionals: { name: positional('Bundle name.') },
  },
  disable: {
    description: 'Change the Host-owned bundle selection and report application or restart state.',
    positionals: { name: positional('Bundle name.') },
  },
})

const presetsHelp = actionHelpGroup('presets', {
  list: { description: 'List Agent presets declared by the connected DSH Host.' },
  show: {
    description: 'Read one declared Agent preset composition.',
    positionals: { id: positional('Agent preset identifier.') },
  },
})

const modelsHelp = actionHelpGroup('models', {
  list: { description: "List DSH's currently routable provider models and any lookup failures." },
  select: {
    description: 'Select a model for one Session; DSH may persist it as the new default.',
    positionals: {
      provider: positional('Model provider.'),
      model: positional('Model identifier.'),
    },
  },
})

const skillsHelp = actionHelpGroup('skills', {
  list: {
    description: "List user-invocable skills visible in the Session's composition; skill bodies are not returned.",
  },
})

const commandsHelp = actionHelpGroup('commands', {
  list: {
    description: 'List commands available to the Session.',
  },
  info: {
    description: 'Show a command registered for the Session.',
    positionals: { 'command-name': positional('Command name.') },
  },
  run: {
    description: 'Execute a registered Session command without a model turn; Ctrl-C cancels the request.',
    positionals: { 'slash-command': positional('Slash-prefixed command line.', false) },
  },
})

const configHelp = actionHelpGroup('config', {
  list: { description: 'List settings namespaces and their write and revision metadata.' },
  get: {
    description: 'Read Host-redacted settings values.',
    positionals: {
      namespace: positional('Settings namespace.'),
      path: positional('Optional field path.', false),
    },
  },
  set: {
    description: 'Write one schema-validated setting using its current revision; change secret values in DSH Settings.',
    positionals: {
      namespace: positional('Settings namespace.'),
      path: positional('Field path.'),
      'json-value': positional('JSON value.'),
    },
  },
  unset: {
    description: 'Remove one setting using its current revision.',
    positionals: {
      namespace: positional('Settings namespace.'),
      path: positional('Field path.'),
    },
  },
})

const hostHelp = actionHelpGroup('host', {
  list: { description: 'List recorded hosts and their connector targets.' },
  status: {
    description: 'Check every registered runtime on the host and report its Workspaces and Sessions.',
    positionals: { 'host-id': positional('Host identifier.') },
  },
  remove: {
    description: 'Remove the directory record. --directory-only also removes runtime references; remote data stays intact.',
    positionals: { 'host-id': positional('Host identifier.') },
  },
  add: {
    description: 'Record one local or trusted SSH machine.',
    positionals: {
      id: positional('Host identifier.'),
      'display-name...': positional('Host display name.'),
    },
  },
})

const runtimeHelp = actionHelpGroup('runtime', {
  list: {
    description: 'List runtimes registered on one host or across all hosts.',
    positionals: { 'host-id': positional('Optional host identifier.', false) },
  },
  status: {
    description: 'Verify runtime identity before reading native Workspace and Session state.',
    positionals: { 'runtime-id': positional('Runtime identifier.') },
  },
  add: {
    description: 'Pin the DSH runtime identity after an authenticated connection.',
    positionals: {
      'host-id': positional('Host identifier.'),
      'display-name...': positional('Runtime display name.'),
    },
  },
  remove: {
    description: 'Remove only this local directory reference; runtime data remains intact.',
    positionals: { 'runtime-id': positional('Runtime identifier.') },
  },
})

const workspaceHelp = actionHelpGroup('workspace', {
  list: {
    description: 'List native Workspaces from the selected runtime. A host with multiple runtimes is ambiguous.',
    positionals: { 'host-id|runtime-id': positional('Host or runtime identifier.') },
  },
  open: {
    description: 'Create or resolve one Workspace on the selected runtime.',
    positionals: {
      'host-id|runtime-id': positional('Host or runtime identifier.'),
      'absolute-path...': positional('Absolute Workspace path.'),
    },
  },
})

const communicationHelp = actionHelpGroup('comm', {
  agents: { description: 'List live DSH Agents and their Session ids.' },
  topics: { description: 'List topics and subscriber counts.' },
  report: { description: 'Read a bounded, metadata-only communication activity and delivery report.' },
  subscribe: {
    description: 'Subscribe this external CLI principal.',
    positionals: { topic: positional('Topic name.') },
  },
  unsubscribe: {
    description: 'Remove this external CLI principal from a topic.',
    positionals: { topic: positional('Topic name.') },
  },
  publish: {
    description: 'Publish a durable peer message.',
    positionals: {
      topic: positional('Topic name.'),
      'message...': positional('Message text.'),
    },
  },
  send: {
    description: 'Send a direct message to a DSH Agent inbox.',
    positionals: {
      'agent-session-id': positional('Agent Session identifier.'),
      'message...': positional('Message text.'),
    },
  },
  inbox: { description: 'Read unacknowledged messages for this external principal.' },
  ack: {
    description: 'Acknowledge one inbox message.',
    positionals: { 'message-id': positional('Message identifier.') },
  },
  mcp: {
    description: 'Run an MCP stdio server for external agent clients; stdout is reserved for MCP.',
  },
})

const inspectHelp = targetHelpGroup('inspect', {
  slots: {
    description: 'Inspect Client Slots and their available providers.',
    context: optionContext('inspect', undefined, {
      inspectTarget: 'slots',
      addTarget: undefined,
      boot: false,
      fix: false,
    }),
  },
  tools: {
    description: 'Inspect registered DSH Tools.',
    context: optionContext('inspect', undefined, {
      inspectTarget: 'tools',
      addTarget: undefined,
      boot: false,
      fix: false,
    }),
  },
  services: {
    description: 'Inspect Host and Client services.',
    context: optionContext('inspect', undefined, {
      inspectTarget: 'services',
      addTarget: undefined,
      boot: false,
      fix: false,
    }),
  },
  events: {
    description: 'Inspect DSH lifecycle events.',
    context: optionContext('inspect', undefined, {
      inspectTarget: 'events',
      addTarget: undefined,
      boot: false,
      fix: false,
    }),
  },
})

const addHelp = targetHelpGroup('add', {
  ui: {
    description: 'Scaffold a Client UI Slot contribution.',
    context: optionContext('add', undefined, {
      inspectTarget: undefined,
      addTarget: 'ui',
      boot: false,
      fix: false,
    }),
  },
  panel: {
    description: 'Scaffold a Client panel contribution.',
    context: optionContext('add', undefined, {
      inspectTarget: undefined,
      addTarget: 'panel',
      boot: false,
      fix: false,
    }),
  },
  api: {
    description: 'Scaffold a DSH API contribution.',
    context: optionContext('add', undefined, {
      inspectTarget: undefined,
      addTarget: 'api',
      boot: false,
      fix: false,
    }),
  },
  tool: {
    description: 'Scaffold a DSH Tool contribution.',
    context: optionContext('add', undefined, {
      inspectTarget: undefined,
      addTarget: 'tool',
      boot: false,
      fix: false,
    }),
  },
  command: {
    description: 'Scaffold a Session Command contribution.',
    context: optionContext('add', undefined, {
      inspectTarget: undefined,
      addTarget: 'command',
      boot: false,
      fix: false,
    }),
  },
  hook: {
    description: 'Scaffold a DSH lifecycle Hook contribution.',
    context: optionContext('add', undefined, {
      inspectTarget: undefined,
      addTarget: 'hook',
      boot: false,
      fix: false,
    }),
  },
})

const simpleHelpCommand = (command: CliCommand, details: Partial<Pick<CliOptionContext, 'boot' | 'fix'>> = {}): CommandDef =>
  helpCommand(
    command,
    cliCommandMetadata[command],
    optionContext(command, undefined, {
      inspectTarget: undefined,
      addTarget: undefined,
      boot: details.boot ?? false,
      fix: details.fix ?? false,
    }),
  )

const helpCommands: Record<CliCommand, CommandDef> = {
  create: simpleHelpCommand('create'),
  test: simpleHelpCommand('test'),
  package: simpleHelpCommand('package'),
  build: simpleHelpCommand('build'),
  check: simpleHelpCommand('check', { boot: true, fix: true }),
  dev: simpleHelpCommand('dev'),
  inspect: inspectHelp,
  add: addHelp,
  status: simpleHelpCommand('status'),
  info: simpleHelpCommand('info'),
  doctor: simpleHelpCommand('doctor'),
  presets: presetsHelp,
  models: modelsHelp,
  skills: skillsHelp,
  sessions: sessionsHelp,
  plugins: pluginsHelp,
  bundles: bundlesHelp,
  commands: commandsHelp,
  config: configHelp,
  host: hostHelp,
  runtime: runtimeHelp,
  workspace: workspaceHelp,
  comm: communicationHelp,
}

const dshxHelpCommand = defineCommand({
  meta: {
    name: 'dshx',
    description: 'Build DSH plugins and inspect or control a running DSH installation.',
  },
  args: cliArgsForContext(optionContext(undefined)),
  subCommands: helpCommands,
})

const commandByName = (command: CliCommand): CommandDef => helpCommands[command]

const platformActionByName = (command: CliCommand, action: string): CommandDef | undefined => {
  return helpActionCommands.get(`${command}:${action}`)
}

const qualifiedParent = (command: CliCommand): CommandDef => defineCommand({ meta: { name: `dshx ${command}` } })

export const renderCliUsage = async (args: CliArgs): Promise<string> => {
  if (args.command === undefined) return renderUsage(dshxHelpCommand)
  if (args.command === 'inspect' && args.inspectTarget !== undefined) {
    const target = platformActionByName('inspect', args.inspectTarget)
    if (target !== undefined) return renderUsage(target, qualifiedParent('inspect'))
  }
  if (args.command === 'add' && args.addTarget !== undefined) {
    const target = platformActionByName('add', args.addTarget)
    if (target !== undefined) return renderUsage(target, qualifiedParent('add'))
  }
  const action = args.platformArgs?.[0]
  if (action !== undefined) {
    const subCommand = platformActionByName(args.command, action)
    if (subCommand !== undefined) return renderUsage(subCommand, qualifiedParent(args.command))
  }
  return renderUsage(commandByName(args.command), dshxHelpCommand)
}
