import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ProfilePluginError, type ProfilePluginDependencies } from '../profile/add-plugin.js'
import { PackSelectionError, ProfileInit, type InitProfilePlan, type Pack } from '../profile/init-profile.js'
import { CliOutput } from './common.js'
import type { CliIO } from './run.js'

const HELP = `dshx init --profile <name> [--packs core,versioning,…] — compose a DSH profile from plugin packs.

A pack is a named set of owned plugins (the Getting started page lists the same packs). Core is always
included. Without --packs, a terminal shows a multi-select of the packs; otherwise pass their ids.
The packs' plugins, plus the owned bundles their clients need, are linked with one
scripts/profile-sync.ts --bundle run, the same path as "dshx add" for one plugin. A missing profile is
created with DSH's own files and the web template; an existing profile that holds a different set of
owned plugins is refused unless --extend is passed. Running it twice changes nothing. It never removes
a plugin and never restarts DSH.

Options:
  --profile <name>      Profile to compose (required); "web" only when named explicitly.
  --packs <ids>         Comma-separated pack ids; Core is always added.
  --extend              Add the packs to a profile that already holds other owned plugins; nothing is removed.
  --yes                 Apply without asking; required when stdin is not a terminal and --dry-run is not set.
  --home <dir>          DSH home (default $DSH_HOME or ~/.dsh).
  --dry-run             Print the composed plugin list and the commands; write nothing.
  --json                Print one JSON envelope: { schemaVersion, command, ok, data | error }.
  -h, --help            Show this help.

Exit codes: 0 composed or up to date, 1 failed, 2 usage.`

const valuesSchema = Schema.Struct({
  profile: Schema.optional(Schema.String),
  packs: Schema.optional(Schema.String),
  home: Schema.optional(Schema.String),
  extend: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  yes: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  'dry-run': Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  json: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  help: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
})

const parseCommandLine = (argv: readonly string[]) => {
  const result = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      profile: { type: 'string' },
      packs: { type: 'string' },
      home: { type: 'string' },
      extend: { type: 'boolean' },
      yes: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  return Schema.decodeUnknownSync(valuesSchema)(result.values)
}

const packIds = (value: string): readonly string[] =>
  value
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '')

const humanReport = (plan: InitProfilePlan): string => {
  const lines = [`init profile ${plan.profile}${plan.dryRun ? ' (dry run)' : ''}`]
  lines.push(`  packs      ${plan.packs.map(pack => pack.id).join(', ')}`)
  for (const plugin of plan.plugins) lines.push(`  plugin     ${plugin}${plan.suppliers.includes(plugin) ? ' (needed by a composed client)' : ''}`)
  for (const plugin of plan.kept) lines.push(`  kept       ${plugin} (outside these packs)`)
  for (const command of plan.commands) lines.push(`  run        ${command}`)
  for (const file of plan.files) lines.push(`  ${plan.dryRun ? 'would edit' : 'edited    '} ${file.path} (${file.change})`)
  lines.push(plan.upToDate ? '  up to date; nothing to restart' : `  restart    ${plan.restart ?? ''} to load it (DSH reads the profile once at boot)`)
  return `${lines.join('\n')}\n`
}

const choosePacks = async (io: CliIO, catalog: readonly Pack[]): Promise<readonly string[] | undefined> => {
  const { isCancel, multiselect } = await import('@clack/prompts')
  const answer = await multiselect({
    message: 'Packs to compose (Core is always included)',
    options: catalog.map(pack => ({
      value: pack.id,
      label: pack.core ? `${pack.title} (always included)` : pack.title,
      hint: `${pack.summary} Plugins: ${pack.plugins.join(', ')}.`,
      disabled: pack.core,
    })),
    initialValues: catalog.filter(pack => pack.core).map(pack => pack.id),
    required: false,
    input: io.stdin,
    output: io.stdout,
  })
  return isCancel(answer) ? undefined : answer
}

const confirmApply = async (io: CliIO, plan: InitProfilePlan): Promise<boolean> => {
  const { confirm, isCancel } = await import('@clack/prompts')
  const answer = await confirm({ message: `Link ${String(plan.linked.length)} plugins into profile ${plan.profile}?`, input: io.stdin, output: io.stdout })
  return !isCancel(answer) && answer
}

/** `dshx init`: compose a DSH profile from the onboarding packs. */
export const runInitCli = async (argv: readonly string[], io: CliIO, dependencies: ProfilePluginDependencies = {}): Promise<number> => {
  const command = 'init'
  const json = argv.includes('--json')
  const fail = (code: 'usage' | 'failed' | 'cancelled', message: string, hint: string): number => {
    if (json) CliOutput.emitEnvelope(io.stdout, { command, ok: false, error: { code, message, hint } })
    else io.stderr.write(`error: ${message}\n  fix: ${hint}\n`)
    return code === 'usage' ? 2 : 1
  }
  let values: ReturnType<typeof parseCommandLine>
  try {
    values = parseCommandLine(argv)
  } catch (error) {
    return fail('usage', error instanceof Error ? error.message : String(error), 'Run "dshx init --help".')
  }
  if (values.help) {
    io.stdout.write(`${HELP}\n`)
    return 0
  }
  if (values.profile === undefined) return fail('usage', 'dshx init needs --profile <name>.', 'Pass --profile <name>, e.g. --profile probe.')
  const interactive = io.stdin.isTTY === true && !json
  if (values.packs === undefined && !interactive)
    return fail('usage', 'dshx init needs --packs when it cannot ask.', 'Pass --packs core,versioning,… or run it in a terminal to choose.')
  if (!values['dry-run'] && !values.yes && !interactive)
    return fail('usage', 'dshx init changes a profile and cannot ask for confirmation here.', 'Pass --yes to apply, or --dry-run to preview.')
  const cancelled = (): number => fail('cancelled', 'Cancelled; nothing was written.', 'Run "dshx init" again, or pass --packs and --yes.')
  try {
    const catalog = await ProfileInit.loadPacks()
    const chosen = values.packs === undefined ? await choosePacks(io, catalog) : packIds(values.packs)
    if (chosen === undefined) return cancelled()
    const target = {
      catalog,
      packs: chosen,
      profile: values.profile,
      dshHome: values.home ?? (process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')),
      extend: values.extend,
    }
    if (!values['dry-run'] && !values.yes) {
      const preview = await ProfileInit.apply({ ...target, dryRun: true }, dependencies)
      if (!preview.upToDate) {
        io.stdout.write(humanReport(preview))
        if (!(await confirmApply(io, preview))) return cancelled()
      }
    }
    const plan = await ProfileInit.apply({ ...target, dryRun: values['dry-run'] }, dependencies)
    if (json) CliOutput.emitEnvelope(io.stdout, { command, ok: true, data: plan })
    else io.stdout.write(humanReport(plan))
    return 0
  } catch (error) {
    if (error instanceof PackSelectionError) return fail('usage', error.message, error.hint)
    if (error instanceof ProfilePluginError) return fail('failed', error.message, error.hint)
    if (Schema.isSchemaError(error)) return fail('usage', error.message, 'Run "dshx init --help".')
    return fail('failed', error instanceof Error ? error.message : String(error), 'Re-run with --json and read the error.')
  }
}
