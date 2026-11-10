import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { runProjectDsh } from '../profile/command.js'
import type { DshCommandRunner } from '../profile/types.js'
import { RegistryBuilder } from '../registry/build.js'
import { RegistryClient } from '../registry/client.js'
import { RegistryError, type RegistryIndexEntry } from '../registry/format.js'
import type { SourceItemPlan } from '../registry/source-items.js'

const HELP = `dshx registry — discover DSH plugins and plugin source, and publish your own registry.

  dshx registry add <alias> <url|path>   Remember a registry index; "dshx add <alias>:<item>" then installs from it.
  dshx registry remove <alias>           Forget an alias. Installed items keep working.
  dshx registry list                     Show configured aliases.
  dshx registry search [term]            Search every alias, or one with --registry <alias|url|path>.
  dshx registry build                    Write registry.json, r/*.json and tarballs/ from dshx.registry.json.

Options:
  --registry <alias|url|path>   search: read only this registry.
  --source <file>               build: source file (default ./dshx.registry.json).
  --out <dir>                   build: output directory (default ./public/registry).
  --home <dir>                  DSH home (default $DSH_HOME or ~/.dsh).
  --json                        Print one JSON envelope: { schemaVersion, command, ok, data | error }.
  -h, --help                    Show this help.

Installing, updating and removing are "dshx add|update|remove"; see docs/registry.md.
Exit codes: 0 ok, 1 failed, 2 usage.`

export interface RegistryCliDependencies {
  readonly runDsh?: DshCommandRunner
}

interface SearchRow extends RegistryIndexEntry {
  readonly registry: string
  readonly address: string
  readonly compatible: boolean | null
}

const humanRows = (rows: readonly SearchRow[]): string =>
  rows
    .map(row => {
      const compatibility = row.compatible === false ? `  needs DSH ${row.engines.dsh ?? ''}` : ''
      return `${row.address}  ${row.version}  ${row.type}${compatibility}${row.description === undefined ? '' : `\n  ${row.description}`}`
    })
    .join('\n')

const readDshVersion = async (runDsh: DshCommandRunner): Promise<string | undefined> => {
  const result = await runDsh(['--version'], { cwd: process.cwd(), env: process.env, timeoutMs: 30_000 }).catch(() => undefined)
  return result === undefined ? undefined : RegistryClient.parseDshVersion(result.stdout)
}

const search = async (term: string, only: string | undefined, dshHome: string, cwd: string, dependencies: RegistryCliDependencies) => {
  const aliases = await RegistryClient.readAliases(dshHome)
  const onlyUrl = only === undefined ? undefined : (aliases[only] ?? RegistryClient.toLocation(only, cwd))
  const targets = onlyUrl === undefined ? Object.entries(aliases) : [[only ?? onlyUrl, onlyUrl] as const]
  if (targets.length === 0) throw new RegistryError('No registries are configured.', 'Run "dshx registry add <alias> <url>", or pass --registry <url>.')
  const running = await readDshVersion(dependencies.runDsh ?? runProjectDsh)
  const needle = term.toLowerCase()
  const rows: SearchRow[] = []
  const warnings: string[] = []
  for (const [alias, url] of targets) {
    try {
      const index = await RegistryClient.readIndex(url)
      for (const entry of index.items) {
        if (![entry.name, entry.title ?? '', entry.description ?? ''].some(field => field.toLowerCase().includes(needle))) continue
        const address = aliases[alias] === undefined ? new URL(entry.url, url).href : `${alias}:${entry.name}`
        rows.push({
          ...entry,
          registry: index.name,
          address,
          compatible: running === undefined ? null : RegistryClient.enginesAllow(entry.engines.dsh, running),
        })
      }
    } catch (error) {
      if (!(error instanceof RegistryError) || targets.length === 1) throw error
      warnings.push(`${alias}: ${error.message}`)
    }
  }
  return { rows, warnings }
}

export const humanSourcePlan = (plan: SourceItemPlan): string => {
  const lines: string[] = []
  for (const required of plan.required) lines.push(humanSourcePlan(required).trimEnd())
  const version =
    plan.versions.before === plan.versions.after ? (plan.versions.after ?? '') : `${plan.versions.before ?? 'none'} → ${plan.versions.after ?? 'none'}`
  lines.push(`${plan.action} ${plan.item} ${version} → project ${plan.project}${plan.dryRun ? ' (dry run)' : ''}`)
  for (const file of plan.files) lines.push(`  ${plan.dryRun ? 'would edit' : 'edited    '} ${file.target} (${file.change})`)
  for (const dependency of plan.dependencies) lines.push(`  dependency ${dependency}; run pnpm install`)
  for (const warning of plan.warnings) lines.push(`  warning    ${warning}`)
  if (plan.files.length === 0 && plan.dependencies.length === 0) lines.push('  up to date')
  if (plan.docs !== null && plan.files.length > 0) lines.push('', plan.docs)
  return `${lines.join('\n')}\n`
}

/** `dshx registry`: aliases, search and the static build. Installation stays in `dshx add`. */
export const runRegistryCli = async (
  argv: readonly string[],
  io: { readonly stdout: Writable; readonly stderr: Writable },
  dependencies: RegistryCliDependencies = {},
): Promise<number> => {
  const json = argv.includes('--json')
  const respond = <Data extends object>(command: string, data: Data, human: string): number => {
    io.stdout.write(json ? `${JSON.stringify({ schemaVersion: 1, command, ok: true, data }, null, 2)}\n` : human)
    return 0
  }
  const fail = (code: 'usage' | 'failed', message: string, hint: string): number => {
    if (json) io.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: 'registry', ok: false, error: { code, message, hint } }, null, 2)}\n`)
    else io.stderr.write(`error: ${message}\n  fix: ${hint}\n`)
    return code === 'usage' ? 2 : 1
  }
  let parsed: ReturnType<typeof parseCommandLine>
  try {
    parsed = parseCommandLine(argv)
  } catch (error) {
    return fail('usage', error instanceof Error ? error.message : String(error), 'Run "dshx registry --help".')
  }
  const { values, positionals } = parsed
  const [action, first, second, ...extra] = positionals
  if (values.help === true || action === undefined) {
    io.stdout.write(`${HELP}\n`)
    return action === undefined && values.help !== true ? 2 : 0
  }
  const dshHome = values.home ?? (process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const cwd = process.cwd()
  const usage = (message: string): number => fail('usage', message, 'Run "dshx registry --help".')
  if (extra.length > 0) return usage('Too many arguments.')
  try {
    switch (action) {
      case 'add': {
        if (first === undefined || second === undefined) return usage('registry add takes <alias> <url|path>.')
        const { url, index } = await RegistryClient.addAlias(dshHome, first, second, cwd)
        return respond(
          'registry add',
          { alias: first, url, name: index.name, items: index.items.length },
          `${first} → ${url} (${index.name}, ${String(index.items.length)} items)\n`,
        )
      }
      case 'remove': {
        if (first === undefined || second !== undefined) return usage('registry remove takes one alias.')
        const removed = await RegistryClient.removeAlias(dshHome, first)
        return respond(
          'registry remove',
          { alias: first, removed },
          removed ? `Removed ${first}; installed items keep working.\n` : `${first} was not configured.\n`,
        )
      }
      case 'list': {
        const registries = await RegistryClient.readAliases(dshHome)
        const lines = Object.entries(registries).map(([alias, url]) => `${alias}  ${url}`)
        return respond('registry list', { registries }, lines.length === 0 ? 'No registries are configured.\n' : `${lines.join('\n')}\n`)
      }
      case 'search': {
        if (second !== undefined) return usage('registry search takes one term.')
        const { rows, warnings } = await search(first ?? '', values.registry, dshHome, cwd, dependencies)
        for (const warning of warnings) io.stderr.write(`warning: ${warning}\n`)
        return respond('registry search', { items: rows, warnings }, rows.length === 0 ? 'No items match.\n' : `${humanRows(rows)}\n`)
      }
      case 'build': {
        if (first !== undefined) return usage('registry build takes no operands; use --source and --out.')
        const result = await RegistryBuilder.build(resolve(cwd, values.source ?? 'dshx.registry.json'), resolve(cwd, values.out ?? 'public/registry'))
        const lines = [
          `Built ${result.name} into ${result.out}`,
          ...result.items.map(item => `  ${item.name} ${item.version} (${item.type})`),
          ...result.warnings.map(warning => `  warning ${warning}`),
        ]
        return respond('registry build', result, `${lines.join('\n')}\n`)
      }
      default:
        return usage(`Unknown registry action "${action}".`)
    }
  } catch (error) {
    if (error instanceof RegistryError) return fail('failed', error.message, error.hint)
    return fail('failed', error instanceof Error ? error.message : String(error), 'Re-run with --json and read the error.')
  }
}

const parseCommandLine = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: true,
    options: {
      registry: { type: 'string' },
      source: { type: 'string' },
      out: { type: 'string' },
      home: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
