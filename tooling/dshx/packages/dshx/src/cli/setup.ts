import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ProfilePluginError } from '../profile/add-plugin.js'
import { PackSelectionError, ProfileInit, type Pack } from '../profile/init-profile.js'
import { DSHFILES_ROOT } from '../project/local-bundles.js'
import { SetupChecks, type SetupCheck } from '../setup/setup-checks.js'
import { SetupPlan, type SetupContext, type SetupPlanResult, type SetupRequest, type SetupStep } from '../setup/setup-plan.js'
import { SetupHttp, type SetupApi } from '../setup/setup-server.js'
import { CliOutput } from './common.js'
import type { CliIO } from './run.js'

const HELP = `dshx setup [--profile main] [--preset daily] — set up a DSH profile from a local web page.

Starts a page on 127.0.0.1 that checks this machine (Node, pnpm, the checkout, dsh, the DSH home,
gh, jj and git), offers presets of plugin packs, shows the exact plan, then composes the profile the
same way "dshx init" does. The link carries a one-time token; the page stops when you close it from
Done, on Ctrl-C, or after 30 minutes without a request. It never starts DSH, never stores a
credential and never writes the "web" profile, which follows the repository.

With --yes it runs the same plan without a browser: the preset's packs (or --packs), then prints
the command that starts DSH. "dshx init --ui" is an alias.

Options:
  --profile <name>      Profile to compose (default main).
  --preset <id>         essentials, daily (default), team or everything.
  --packs <ids>         Comma-separated pack ids instead of a preset; Core is always added.
  --extend              Keep the other owned plugins of an existing profile; nothing is removed.
  --home <dir>          DSH home (default $DSH_HOME or ~/.dsh).
  --port <n>            Port for the page (default: a free one).
  --no-open             Print the link without opening a browser.
  --yes                 No browser: apply the preset's plan and exit.
  --json                With --yes, print one JSON envelope: { schemaVersion, command, ok, data | error }.
  -h, --help            Show this help.

Exit codes: 0 done or stopped, 1 failed, 2 usage.`

const valuesSchema = Schema.Struct({
  profile: Schema.String.pipe(Schema.withDecodingDefaultType(Effect.succeed(SetupPlan.defaultProfile))),
  preset: Schema.String.pipe(Schema.withDecodingDefaultType(Effect.succeed(SetupPlan.defaultPreset))),
  packs: Schema.optional(Schema.String),
  home: Schema.optional(Schema.String),
  port: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 65_535 }))),
  extend: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  open: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(true))),
  yes: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  json: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  help: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
})

const parseCommandLine = (argv: readonly string[]) => {
  const result = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    allowNegative: true,
    options: {
      profile: { type: 'string' },
      preset: { type: 'string' },
      packs: { type: 'string' },
      home: { type: 'string' },
      port: { type: 'string' },
      extend: { type: 'boolean' },
      open: { type: 'boolean' },
      yes: { type: 'boolean' },
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

/** The built page: next to this file once dshx is built, else the setup-ui package's own build output. */
const staticRoot = (): string => {
  const copied = resolve(dirname(fileURLToPath(import.meta.url)), '../setup-ui')
  return existsSync(join(copied, 'index.html')) ? copied : join(DSHFILES_ROOT, 'tooling/dshx/packages/setup-ui/dist')
}

const contextOf = async (dshHome: string): Promise<SetupContext> => {
  const probe = await SetupChecks.probe({ dshHome })
  return { root: probe.root, dshHome, env: probe.env, runningHosts: probe.runningHosts }
}

const packView = (pack: Pack) => ({ id: pack.id, title: pack.title, summary: pack.summary, core: pack.core, plugins: pack.plugins })

/** The JSON API the page calls; every write goes through `SetupPlan.apply`. */
const apiOf = (input: {
  readonly dshHome: string
  readonly defaults: { readonly profile: string; readonly preset: string; readonly packs: readonly string[] | undefined }
}): SetupApi => ({
  state: async () => {
    const probe = await SetupChecks.probe({ dshHome: input.dshHome })
    const { checks, profiles } = await SetupChecks.inspect(probe)
    const catalog = await ProfileInit.loadPacks()
    return {
      checks,
      blocking: SetupChecks.blocking(checks),
      packs: catalog.map(packView),
      presets: SetupPlan.presets(catalog),
      profiles,
      dshHome: input.dshHome,
      defaults: input.defaults,
    }
  },
  plan: async request => SetupPlan.plan(await contextOf(input.dshHome), request),
  apply: async (body, emit) => {
    try {
      const context = await contextOf(input.dshHome)
      const { checks } = await SetupChecks.inspect(await SetupChecks.probe({ dshHome: input.dshHome }))
      if (SetupChecks.blocking(checks)) throw new ProfilePluginError('A check fails, so nothing was written.', 'Go back to Check and follow its fix.')
      const result = await SetupPlan.apply(context, { request: body.request, hash: body.hash, onStep: step => emit({ type: 'step', step }) })
      emit({ type: 'done', result })
    } catch (error) {
      const hint = error instanceof ProfilePluginError || error instanceof PackSelectionError ? error.hint : 'Check the terminal running dshx setup.'
      emit({ type: 'error', error: { message: error instanceof Error ? error.message : String(error), hint } })
    }
  },
})

const openBrowser = async (url: string): Promise<void> => {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  await execa(command, [url], { reject: false, stdio: 'ignore', detached: true })
}

const describeCheck = (check: SetupCheck): string =>
  `  ${check.state.padEnd(4)}  ${check.label}: ${check.detail}${check.fix === null ? '' : `\n        fix: ${check.fix}`}`

const describeResult = (result: SetupPlanResult): string => {
  const plan = result.plan
  const lines = plan === null ? [] : [`setup profile ${plan.profile}`, `  packs      ${plan.packs.map(pack => pack.id).join(', ')}`]
  if (plan !== null) for (const file of plan.files) lines.push(`  edited     ${file.path} (${file.change})`)
  if (result.marker !== null) lines.push(`  recorded   ${result.marker.path}`)
  if (plan?.upToDate === true && result.marker === null) lines.push('  up to date')
  if (result.buildCommand !== null) lines.push(`  build      ${result.buildCommand}`)
  lines.push(`  start      ${result.startCommand}`)
  return `${lines.join('\n')}\n`
}

/** `--yes`: the page's plan and apply, without a browser. */
const runHeadless = async (input: {
  readonly io: CliIO
  readonly json: boolean
  readonly dshHome: string
  readonly request: SetupRequest
  readonly fail: (code: 'usage' | 'failed', message: string, hint: string) => number
}): Promise<number> => {
  const probe = await SetupChecks.probe({ dshHome: input.dshHome })
  const { checks } = await SetupChecks.inspect(probe)
  if (SetupChecks.blocking(checks)) {
    if (!input.json)
      input.io.stderr.write(
        `${checks
          .filter(check => check.state === 'fail')
          .map(describeCheck)
          .join('\n')}\n`,
      )
    return input.fail('failed', 'A check fails, so nothing was written.', 'Follow the printed fix, then run dshx setup again.')
  }
  const context: SetupContext = { root: probe.root, dshHome: input.dshHome, env: probe.env, runningHosts: probe.runningHosts }
  const reviewed = await SetupPlan.plan(context, input.request)
  if (reviewed.problem !== null) return input.fail('failed', reviewed.problem.message, reviewed.problem.hint)
  const onStep = (step: SetupStep): void => {
    if (!input.json && step.status !== 'running') input.io.stdout.write(`  ${step.status.padEnd(6)} ${step.label}\n`)
  }
  const result = await SetupPlan.apply(context, { request: input.request, hash: reviewed.hash, onStep })
  if (input.json) CliOutput.emitEnvelope(input.io.stdout, { command: 'setup', ok: true, data: { checks, ...result } })
  else input.io.stdout.write(describeResult(result))
  return 0
}

/** `dshx setup` (and `dshx init --ui`): a local web page, or `--yes` for the same plan without one. */
export const runSetupCli = async (argv: readonly string[], io: CliIO): Promise<number> => {
  const json = argv.includes('--json')
  const fail = (code: 'usage' | 'failed', message: string, hint: string): number => {
    if (json) CliOutput.emitEnvelope(io.stdout, { command: 'setup', ok: false, error: { code, message, hint } })
    else io.stderr.write(`error: ${message}\n  fix: ${hint}\n`)
    return code === 'usage' ? 2 : 1
  }
  let values: ReturnType<typeof parseCommandLine>
  try {
    values = parseCommandLine(argv)
  } catch (error) {
    return fail('usage', error instanceof Error ? error.message : String(error), 'Run "dshx setup --help".')
  }
  if (values.help) {
    io.stdout.write(`${HELP}\n`)
    return 0
  }
  if (values.json && !values.yes) return fail('usage', '--json needs --yes: the page itself has no terminal output.', 'Pass --yes, or drop --json.')
  const dshHome = resolve(values.home ?? (process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')))
  try {
    const catalog = await ProfileInit.loadPacks()
    const preset = SetupPlan.presets(catalog).find(candidate => candidate.id === values.preset)
    if (preset === undefined && values.packs === undefined)
      return fail(
        'usage',
        `Unknown preset: ${values.preset}.`,
        `Pass --preset with one of: ${SetupPlan.presets(catalog)
          .map(candidate => candidate.id)
          .join(', ')}.`,
      )
    const packs = values.packs === undefined ? (preset?.packs ?? []) : packIds(values.packs)
    const request = Schema.decodeUnknownSync(SetupPlan.requestSchema)({ profile: values.profile, packs, extend: values.extend })
    if (values.yes) return await runHeadless({ io, json, dshHome, request, fail })

    const server = await SetupHttp.start({
      api: apiOf({ dshHome, defaults: { profile: values.profile, preset: preset?.id ?? '', packs: values.packs === undefined ? undefined : packs } }),
      staticRoot: staticRoot(),
      port: values.port ?? 0,
    })
    const stopOnSignal = (): void => void server.close()
    process.once('SIGINT', stopOnSignal)
    process.once('SIGTERM', stopOnSignal)
    io.stdout.write(`dshx setup is running for ${dshHome}\n  open  ${server.url}\n  stop  Ctrl-C, or Done on the page\n`)
    if (values.open) await openBrowser(server.url)
    await server.closed
    process.off('SIGINT', stopOnSignal)
    process.off('SIGTERM', stopOnSignal)
    io.stdout.write('dshx setup stopped\n')
    return 0
  } catch (error) {
    if (error instanceof PackSelectionError) return fail('usage', error.message, error.hint)
    if (error instanceof ProfilePluginError) return fail('failed', error.message, error.hint)
    if (Schema.isSchemaError(error)) return fail('usage', error.message, 'Run "dshx setup --help".')
    return fail('failed', error instanceof Error ? error.message : String(error), 'Re-run with --yes --json and read the error.')
  }
}
