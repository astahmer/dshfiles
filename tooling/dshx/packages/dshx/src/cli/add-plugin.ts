import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { ProfilePluginError, ProfilePlugins, type ProfilePluginDependencies, type ProfilePluginPlan } from '../profile/add-plugin.js'

const SHARED_OPTIONS = `  --profile <name>      Target profile (default "probe"; "web" only when named explicitly).
  --home <dir>          DSH home (default $DSH_HOME or ~/.dsh).
  --dry-run             Print the plan and commands; write nothing.
  --json                Print one JSON envelope: { schemaVersion, command, ok, data | error }.
  -h, --help            Show this help.`

const HELP = {
  add: `dshx add <package[@version]|path> — install one plugin into a DSH profile in one step.

One package carries every half: its Host entry, its Client entry and its contract modules install together.
An owned bundle (@dshfiles/<name> or a path under plugins/@dshfiles) is linked and installed with
scripts/profile-sync.ts --bundle; any other plugin directory goes through "dsh plugin add link:<path>"; a
registry package, optionally pinned (name@1.2.0, name@^1), goes through "dsh plugin --profile <name> add".
Each --option merges into the plugin's Loader row config in the profile's cordis.patch.yml (a new
override starts from the bundle's own row config) and is validated against the plugin's exported
Config schema when its Host entry loads. Running it twice changes nothing. It never restarts DSH.

Options:
  --option key=value    Row config value, parsed as a YAML scalar; repeatable.
${SHARED_OPTIONS}

Exit codes: 0 installed or up to date, 1 failed, 2 usage.`,
  update: `dshx update <package[@version]> — move one installed plugin to a newer version.

A registry package moves within its declared range ("dsh plugin update"), to its latest release with
--latest, or to the version you name ("dsh plugin add name@version", which DSH checks for compatibility
first). An owned bundle is relinked to this checkout with profile-sync; a plugin linked from another
directory is read from there, so it has nothing to update. It never restarts DSH.

Options:
  --latest              Move past the declared range to the latest release.
${SHARED_OPTIONS}

Exit codes: 0 updated or up to date, 1 failed, 2 usage.`,
  remove: `dshx remove <package> — uninstall one plugin from a DSH profile.

Runs "dsh plugin --profile <name> remove <package>", which drops the dependency and its bundle entry,
then removes the plugin's row override from the profile's cordis.patch.yml. Running it twice changes
nothing. It never restarts DSH.

Options:
${SHARED_OPTIONS}

Exit codes: 0 removed or not installed, 1 failed, 2 usage.`,
} as const

type ProfilePluginCommand = keyof typeof HELP

const valuesSchema = z.object({
  profile: z.string().default('probe'),
  option: z.array(z.string()).default([]),
  home: z.string().optional(),
  latest: z.boolean().default(false),
  'dry-run': z.boolean().default(false),
  json: z.boolean().default(false),
  help: z.boolean().default(false),
})

const parseCommandLine = (command: ProfilePluginCommand, argv: readonly string[]) => {
  const result = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: true,
    options: {
      profile: { type: 'string' },
      home: { type: 'string' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      ...(command === 'add' && { option: { type: 'string', multiple: true } }),
      ...(command === 'update' && { latest: { type: 'boolean' } }),
    },
  })
  return { values: valuesSchema.parse(result.values), positionals: result.positionals }
}

const humanReport = (plan: ProfilePluginPlan): string => {
  const requested = plan.requested === null ? '' : `@${plan.requested}`
  const lines = [`${plan.action} ${plan.packageName}${requested} → profile ${plan.profile}${plan.dryRun ? ' (dry run)' : ''}`]
  lines.push(`  source     ${plan.source === 'owned' ? 'owned bundle' : plan.source === 'local' ? 'local package' : 'registry package'}`)
  lines.push(`  row        ${plan.rowId}`)
  if (plan.parts !== null) {
    const parts = [...(plan.parts.host ? ['host'] : []), ...(plan.parts.client ? ['client'] : []), ...plan.parts.modules]
    lines.push(`  parts      ${parts.length === 0 ? 'none' : parts.join(', ')}`)
  }
  if (plan.versions.before !== plan.versions.after) lines.push(`  version    ${plan.versions.before ?? 'none'} → ${plan.versions.after ?? 'none'}`)
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

/** `dshx add <package>`, `dshx update` and `dshx remove`: one plugin's lifecycle in one DSH profile. */
export const runProfilePluginCli = async (
  command: ProfilePluginCommand,
  argv: readonly string[],
  io: { readonly stdout: Writable; readonly stderr: Writable },
  dependencies: ProfilePluginDependencies = {},
): Promise<number> => {
  const json = argv.includes('--json')
  const fail = (code: 'usage' | 'failed', message: string, hint: string): number => {
    if (json) io.stdout.write(`${JSON.stringify({ schemaVersion: 1, command, ok: false, error: { code, message, hint } }, null, 2)}\n`)
    else io.stderr.write(`error: ${message}\n  fix: ${hint}\n`)
    return code === 'usage' ? 2 : 1
  }
  let parsed: ReturnType<typeof parseCommandLine>
  try {
    parsed = parseCommandLine(command, argv)
  } catch (error) {
    return fail('usage', error instanceof Error ? error.message : String(error), `Run "dshx ${command} --help".`)
  }
  if (parsed.values.help) {
    io.stdout.write(`${HELP[command]}\n`)
    return 0
  }
  const [packageSpec, ...extra] = parsed.positionals
  if (packageSpec === undefined || extra.length > 0) return fail('usage', `dshx ${command} takes exactly one package or path.`, `Run "dshx ${command} --help".`)
  const target = {
    packageSpec,
    profile: parsed.values.profile,
    dshHome: parsed.values.home ?? (process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')),
    dryRun: parsed.values['dry-run'],
  }
  try {
    const plan =
      command === 'add'
        ? await ProfilePlugins.add({ ...target, options: parsed.values.option }, dependencies)
        : command === 'update'
          ? await ProfilePlugins.update({ ...target, latest: parsed.values.latest }, dependencies)
          : await ProfilePlugins.remove(target, dependencies)
    io.stdout.write(json ? `${JSON.stringify({ schemaVersion: 1, command, ok: true, data: plan }, null, 2)}\n` : humanReport(plan))
    return 0
  } catch (error) {
    if (error instanceof ProfilePluginError) return fail('failed', error.message, error.hint)
    if (error instanceof z.ZodError) return fail('usage', z.prettifyError(error), `Run "dshx ${command} --help".`)
    return fail('failed', error instanceof Error ? error.message : String(error), 'Re-run with --json and read the error.')
  }
}
