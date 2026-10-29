import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { AddPluginError, addPluginToProfile, type AddPluginDependencies, type AddPluginPlan } from '../profile/add-plugin.js'

const HELP = `dshx add <package|path> — install one plugin into a DSH profile in one step.

An owned bundle (@dshfiles/<name> or a path under plugins/@dshfiles) is linked and installed with
scripts/profile-sync.ts --bundle; a registry package goes through "dsh plugin --profile <name> add".
Each --option merges into the plugin's Loader row config in the profile's cordis.patch.yml (a new
override starts from the bundle's own row config) and is validated against the plugin's exported
Config schema when its Host entry loads. Running it twice changes nothing. It never restarts DSH.

Options:
  --profile <name>      Target profile (default "probe"; "web" only when named explicitly).
  --option key=value    Row config value, parsed as a YAML scalar; repeatable.
  --home <dir>          DSH home (default $DSH_HOME or ~/.dsh).
  --dry-run             Print the plan and commands; write nothing.
  --json                Print one JSON envelope: { schemaVersion, command, ok, data | error }.
  -h, --help            Show this help.

Exit codes: 0 installed or up to date, 1 failed, 2 usage.`

const valuesSchema = z.object({
  profile: z.string().default('probe'),
  option: z.array(z.string()).default([]),
  home: z.string().optional(),
  'dry-run': z.boolean().default(false),
  json: z.boolean().default(false),
  help: z.boolean().default(false),
})

const parseCommandLine = (argv: readonly string[]) => {
  const result = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: true,
    options: {
      profile: { type: 'string' },
      option: { type: 'string', multiple: true },
      home: { type: 'string' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  return { values: valuesSchema.parse(result.values), positionals: result.positionals }
}

const humanReport = (plan: AddPluginPlan): string => {
  const lines = [`${plan.packageName} → profile ${plan.profile}${plan.dryRun ? ' (dry run)' : ''}`]
  lines.push(`  source     ${plan.source === 'owned' ? 'owned bundle' : 'registry package'}`)
  lines.push(`  row        ${plan.rowId}`)
  for (const command of plan.commands) lines.push(`  run        ${command}`)
  for (const file of plan.files) lines.push(`  ${plan.dryRun ? 'would edit' : 'edited    '} ${file.path} (${file.change})`)
  if (plan.config !== null) lines.push(`  config     ${JSON.stringify(plan.config)}`)
  if (plan.clientInject.length > 0) lines.push(`  inject     ${plan.clientInject.join(', ')} (from the bundle's dsh.client.inject)`)
  for (const warning of plan.warnings) lines.push(`  warning    ${warning}`)
  lines.push(
    plan.files.length === 0 ? '  up to date; nothing to restart' : `  restart    ${plan.restart ?? ''} to load it (DSH reads the profile once at boot)`,
  )
  return `${lines.join('\n')}\n`
}

export const runAddPluginCli = async (
  argv: readonly string[],
  io: { readonly stdout: Writable; readonly stderr: Writable },
  dependencies: AddPluginDependencies = {},
): Promise<number> => {
  const json = argv.includes('--json')
  const fail = (code: 'usage' | 'failed', message: string, hint: string): number => {
    if (json) io.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: 'add', ok: false, error: { code, message, hint } }, null, 2)}\n`)
    else io.stderr.write(`error: ${message}\n  fix: ${hint}\n`)
    return code === 'usage' ? 2 : 1
  }
  let parsed: ReturnType<typeof parseCommandLine>
  try {
    parsed = parseCommandLine(argv)
  } catch (error) {
    return fail('usage', error instanceof Error ? error.message : String(error), 'Run "dshx add --help".')
  }
  if (parsed.values.help) {
    io.stdout.write(`${HELP}\n`)
    return 0
  }
  const [packageSpec, ...extra] = parsed.positionals
  if (packageSpec === undefined || extra.length > 0) return fail('usage', 'dshx add takes exactly one package or path.', 'Run "dshx add --help".')
  try {
    const plan = await addPluginToProfile(
      {
        packageSpec,
        profile: parsed.values.profile,
        dshHome: parsed.values.home ?? (process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')),
        options: parsed.values.option,
        dryRun: parsed.values['dry-run'],
      },
      dependencies,
    )
    io.stdout.write(json ? `${JSON.stringify({ schemaVersion: 1, command: 'add', ok: true, data: plan }, null, 2)}\n` : humanReport(plan))
    return 0
  } catch (error) {
    if (error instanceof AddPluginError) return fail('failed', error.message, error.hint)
    if (error instanceof z.ZodError) return fail('usage', z.prettifyError(error), 'Run "dshx add --help".')
    return fail('failed', error instanceof Error ? error.message : String(error), 'Re-run with --json and read the error.')
  }
}
