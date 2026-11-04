import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import type { buildClient } from '../compiler/client/build.js'
import type { buildHost } from '../compiler/host/build.js'
import type { buildModule } from '../compiler/module/build.js'
import type { resolveDshxConfig } from '../config/resolve.js'
import type { startDevSession } from '../dev/orchestrator.js'
import type { packageProject, testProject } from '../toolchain/index.js'
import type { ProfileOrchestrator } from '../profile/orchestrator.js'
import type { checkMigrationDiagnostics } from '../project/migrations.js'
import type { checkPackageTargets } from '../project/package-targets.js'
import type { checkProjectManifest } from '../project/manifest.js'
import type { ManifestRepairService } from '../project/repair.js'
import type { typecheckProject } from '../project/typecheck.js'
import type { inspectProjectComposition } from '../inspect/provider.js'
import type { inspectBridgeStatus } from '../inspect/bridge.js'
import type { inspectRuntimePlugins } from '../runtime-status.js'
import type { AddPresetOptions, AddPresetResult } from '../scaffold/preset.js'
import type { AddCommandOptions, AddCommandResult } from '../scaffold/command.js'
import type { AddHookOptions, AddHookResult } from '../scaffold/hook.js'
import type { AddToolOptions, AddToolResult } from '../scaffold/tool.js'
import type { AddUiOptions, AddUiResult } from '../scaffold/ui.js'
import type { ConnectDshPlatformClientOptions, DshPlatformClient } from '../platform/client.js'
import type { CommunicationClient, ConnectCommunicationClientOptions } from '../communication/bridge.js'
import { CliOptionMetadata, CliUsageError, parseCliArgs, type CliArgs } from './args.js'
import { renderCliUsage } from './usage.js'
import { CliOutput } from './common.js'

const { defaultIO, write } = CliOutput
const outputOptions = CliOutput.options
const VERSION = CliOutput.version

// Command implementations load at dispatch (see runCli): `dshx --help` must not import the compiler, dev watchers,
// scaffolding or the platform client just to print usage.

export interface CliIO {
  readonly stdin: Readable & {
    isTTY?: boolean
    setRawMode?: (mode: boolean) => void
  }
  readonly stdout: Writable
  readonly stderr: Writable
}

export interface CliRuntime {
  readonly testProject?: typeof testProject
  readonly packageProject?: typeof packageProject
  readonly resolveConfig?: typeof resolveDshxConfig
  readonly checkManifest?: typeof checkProjectManifest
  readonly checkMigrations?: typeof checkMigrationDiagnostics
  readonly checkPackageTargets?: typeof checkPackageTargets
  readonly typecheckProject?: typeof typecheckProject
  readonly resolveDsh?: typeof ProfileOrchestrator.resolveDshInstallation
  readonly inspectProfile?: typeof ProfileOrchestrator.inspectProjectProfile
  readonly ensureProfile?: typeof ProfileOrchestrator.ensureProjectProfile
  readonly buildHost?: typeof buildHost
  readonly buildClient?: typeof buildClient
  readonly buildModule?: typeof buildModule
  readonly startDev?: typeof startDevSession
  readonly inspectComposition?: typeof inspectProjectComposition
  readonly inspectRuntimePlugins?: typeof inspectRuntimePlugins
  readonly inspectBridgeStatus?: typeof inspectBridgeStatus
  readonly createRepairPlan?: typeof ManifestRepairService.createPlan
  readonly applyRepairPlan?: typeof ManifestRepairService.applyPlan
  readonly rollbackRepairPlan?: typeof ManifestRepairService.rollbackPlan
  readonly addUi?: (options: AddUiOptions) => Promise<AddUiResult>
  readonly addTool?: (options: AddToolOptions) => Promise<AddToolResult>
  readonly addCommand?: (options: AddCommandOptions) => Promise<AddCommandResult>
  readonly addHook?: (options: AddHookOptions) => Promise<AddHookResult>
  readonly addPreset?: (options: AddPresetOptions) => Promise<AddPresetResult>
  readonly connectPlatform?: (options?: ConnectDshPlatformClientOptions) => Promise<DshPlatformClient>
  readonly connectCommunication?: (options?: ConnectCommunicationClientOptions) => Promise<CommunicationClient>
}

export interface CliRunOptions {
  readonly io?: CliIO
  readonly runtime?: CliRuntime
  readonly cwd?: string
  readonly version?: string
}

/**
 * Explain a Client slot from the static reference.
 *
 * Answers offline, so the question "can I even use this slot, and what do I have to
 * import to see it" does not require a running Host.
 */
const runSlotExplanation = async (args: CliArgs, io: CliIO): Promise<number> => {
  const { CLIENT_SLOT_REFERENCES } = await import('create-dshx/slot-capabilities')
  const { findClientSlot } = await import('../client/slot-reference.js')
  if (args.json) {
    const slots = args.root === undefined ? CLIENT_SLOT_REFERENCES : CLIENT_SLOT_REFERENCES.filter(slot => slot.name === args.root)
    write(io.stdout, `${JSON.stringify({ slots }, null, 2)}\n`)
    return slots.length === 0 ? 1 : 0
  }
  const requested = args.root
  if (requested === undefined) {
    for (const slot of CLIENT_SLOT_REFERENCES) {
      write(io.stdout, `${slot.name}\n`)
    }
    write(io.stderr, 'Pass --root <slot-name> to see one slot in detail.\n')
    return 0
  }
  const slot = findClientSlot(requested)
  if (slot === undefined) {
    write(io.stderr, `No reference entry for slot "${requested}".\n`)
    return 1
  }
  write(io.stdout, `${slot.name}\n`)
  write(io.stdout, `  purpose    ${slot.purpose}\n`)
  if (slot.ownerProps !== undefined) write(io.stdout, `  ownerProps ${slot.ownerProps}\n`)
  if (slot.declaredBy.length > 0) {
    write(io.stdout, '  declaredBy\n')
    for (const owner of slot.declaredBy) write(io.stdout, `    ${owner}\n`)
    write(io.stdout, '  import these type-only so the slot appears in your typed union:\n')
    for (const owner of slot.declaredBy) write(io.stdout, `    import type {} from '${owner}'\n`)
  }
  if (slot.replaces.length > 0) {
    write(io.stdout, `  reusing id "${slot.replaces[0]}" replaces the shipped occupant instead of adding a second one.\n`)
  }
  return 0
}

const platformGroupsForRun = (): ReadonlySet<string> =>
  new Set([
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

export async function runCli(argv: readonly string[], options: CliRunOptions = {}): Promise<number> {
  const io = options.io ?? defaultIO()
  if (argv[0] === 'create') {
    const { runCreate } = await import('create-dshx')
    const forwarded = argv.slice(1)
    if (options.cwd !== undefined && !forwarded.includes('--cwd')) forwarded.push('--cwd', options.cwd)
    return runCreate(forwarded, io, {
      dshxVersion: `link:${fileURLToPath(new URL('../..', import.meta.url))}`,
    })
  }
  if (argv[0] === 'dev') {
    const { SCRATCH_ACTIONS, runScratchCli } = await import('./scratch.js')
    if (SCRATCH_ACTIONS.has(argv[1] ?? '')) return runScratchCli(argv.slice(1), io)
    if (argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')) return runScratchCli(['', '--help'], io)
  }
  if (argv[0] === 'checkout') return (await import('./checkout.js')).runCheckoutCli(argv.slice(1), io)
  if (argv[0] === 'check' && argv[1] === 'repo') return (await import('./repository-check.js')).runRepositoryCheckCli(argv.slice(2), io)
  const addOperand = argv[0] === 'add' ? argv[1] : undefined
  if (addOperand !== undefined && !addOperand.startsWith('-') && !CliOptionMetadata.isAddTarget(addOperand))
    return (await import('./add-plugin.js')).runProfilePluginCli('add', argv.slice(1), io)
  if (argv[0] === 'update' || argv[0] === 'remove') return (await import('./add-plugin.js')).runProfilePluginCli(argv[0], argv.slice(1), io)
  let args: CliArgs
  try {
    args = parseCliArgs(argv)
  } catch (error) {
    const message = (error instanceof CliUsageError ? error.message : String(error)).replace(/([?&]token=)[^&\s"']*/gi, '$1[redacted]')
    const platformGroups = new Set([
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
    const group = argv.find(token => platformGroups.has(token))
    if (group !== undefined && argv.includes('--json')) {
      const actions = new Set([
        'list',
        'search',
        'show',
        'history',
        'create',
        'fork',
        'cancel',
        'rename',
        'archive',
        'unarchive',
        'prompt',
        'export',
        'digest',
        'tail',
        'info',
        'check',
        'enable',
        'disable',
        'install',
        'remove',
        'run',
        'get',
        'set',
        'unset',
        'select',
        'agents',
        'topics',
        'subscribe',
        'unsubscribe',
        'publish',
        'send',
        'inbox',
        'ack',
        'mcp',
      ])
      const groupIndex = argv.indexOf(group)
      const action = argv.slice(groupIndex + 1).find(token => actions.has(token))
      const command = action === undefined ? group : `${group} ${action}`
      write(io.stdout, `${JSON.stringify({ schemaVersion: 1, command, ok: false, error: { code: 'usage', message } }, null, 2)}\n`)
    } else {
      write(io.stderr, `error: ${message}\n`)
      write(io.stderr, 'Run "dshx --help" for usage.\n')
    }
    return 2
  }
  outputOptions.set(io.stdout, {
    quiet: args.quiet ?? false,
    noColor: args.noColor ?? false,
  })
  outputOptions.set(io.stderr, {
    quiet: false,
    noColor: args.noColor ?? false,
  })
  // The slot reference is static, so it answers before a project is resolved and
  // before a Host is contacted.
  if (args.command === 'inspect' && args.explain) return await runSlotExplanation(args, io)
  if (args.help) {
    write(io.stdout, await renderCliUsage(args))
    return 0
  }
  if (args.version) {
    write(io.stdout, `${options.version ?? VERSION}\n`)
    return 0
  }
  if (args.command === 'inspect' && args.inspectTarget === 'slots' && args.explain) return runSlotExplanation(args, io)
  const runtime = options.runtime ?? {}
  if (args.command !== undefined && platformGroupsForRun().has(args.command)) {
    const { runPlatformCli } = await import('./platform.js')
    return runPlatformCli(args, {
      io,
      dshxVersion: options.version ?? VERSION,
      ...(runtime.connectPlatform !== undefined && { connect: runtime.connectPlatform }),
      ...(runtime.connectCommunication !== undefined && { connectCommunication: runtime.connectCommunication }),
    })
  }
  return (await import('./run-project.js')).runProjectCommand(args, options, io)
}
