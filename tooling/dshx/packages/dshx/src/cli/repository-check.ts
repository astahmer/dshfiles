import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { decodeJson } from '../json.js'
import { BundleFreshness } from '../repository/bundle-freshness.js'
import { PluginBoundaries } from '../repository/plugin-boundaries.js'
import { RepositoryWorkspace, type WorkspacePackage } from '../repository/workspace.js'

const HELP = `dshx check repo — repository health checks for a dshx monorepo or a standalone plugin repository.

Checks:
  cycles          Workspace packages that depend on each other, peer and optional dependencies included.
  boundaries      A plugin importing another plugin's dist/ by relative path, or a contract module
                  (a dshx.config.ts modules entry calling defineContract/defineRegistry) importing the plugin that fills it.
  stale-bundles   Built plugin bundles older than a source their last build read, compared by content hash.
                  Packages that were never built are counted, not reported.

Options:
  --only <check>  Run one check: cycles, boundaries or stale-bundles (default: all).
  --cwd <dir>     Any directory inside the repository (default: the current directory).
  --json          Print one JSON envelope: { schemaVersion, command, ok, data | error: { code, message, hint } }.
  -h, --help      Show this help.

Exit codes: 0 no findings, 1 findings or error, 2 usage.`

const checkNames = ['cycles', 'boundaries', 'stale-bundles'] as const
type CheckName = (typeof checkNames)[number]

interface Finding {
  readonly rule: string
  readonly message: string
  /** Repository-relative path, or null when the finding has no single file. */
  readonly file: string | null
  readonly line: number | null
  readonly hint: string
}

interface CheckResult {
  readonly name: CheckName
  readonly ok: boolean
  /** Packages (cycles), plugins (boundaries) or built bundles (stale-bundles) looked at. */
  readonly inspected: number
  readonly findings: readonly Finding[]
}

const isCheckName = (value: string): value is CheckName => checkNames.some(name => name === value)

const lineOf = (path: string, needle: string): number | null => {
  const index = readFileSync(path, 'utf8')
    .split('\n')
    .findIndex(line => line.includes(needle))
  return index === -1 ? null : index + 1
}

const runCheck = (name: CheckName, root: string, packages: readonly WorkspacePackage[]): CheckResult => {
  const repositoryPath = (path: string): string => relative(root, path)
  if (name === 'cycles') {
    const findings = RepositoryWorkspace.cycles(packages).map(cycle => {
      const first = packages.find(item => item.name === cycle[0])
      const edge = first === undefined ? undefined : RepositoryWorkspace.dependencies(first, packages).find(dependency => cycle.includes(dependency))
      const manifestPath = first === undefined ? undefined : join(first.directory, 'package.json')
      return {
        rule: 'workspace-cycle',
        message: `workspace dependency cycle: ${cycle.join(' ⇄ ')}`,
        file: manifestPath === undefined ? null : repositoryPath(manifestPath),
        line: manifestPath === undefined || edge === undefined ? null : lineOf(manifestPath, `"${edge}"`),
        hint: 'Break it with a contract or registry owned by the lower plugin (docs/plugin-boundaries.md); never with an optional peer dependency.',
      }
    })
    return { name, ok: findings.length === 0, inspected: packages.length, findings }
  }
  if (name === 'boundaries') {
    const findings = PluginBoundaries.check(packages).map(violation => ({
      rule: violation.rule,
      message: violation.message,
      file: repositoryPath(violation.file),
      line: violation.line,
      hint: violation.hint,
    }))
    return { name, ok: findings.length === 0, inspected: packages.length, findings }
  }
  const reports = packages.map(item => ({ item, report: BundleFreshness.inspect({ directory: item.directory, decodeJson }) }))
  const findings = reports.flatMap(({ item, report }) => {
    if (report.status !== 'stale') return []
    const subject = report.source === null ? `dist/${report.bundle} is missing` : `dist/${report.bundle} is older than ${report.source}`
    return [
      {
        rule: report.reason,
        message: `${item.name}: ${subject}${report.reason === 'source-missing' ? ', which no longer exists' : ''}`,
        file: repositoryPath(report.source === null ? join(item.directory, 'dist', report.bundle) : join(item.directory, report.source)),
        line: null,
        hint: `Rebuild ${item.name} (dshx build in ${repositoryPath(item.directory) || '.'}); DSH loads the old bundle until then.`,
      },
    ]
  })
  return { name, ok: findings.length === 0, inspected: reports.filter(({ report }) => report.status === 'stale' || report.status === 'fresh').length, findings }
}

const inspectedLabel = { cycles: 'packages', boundaries: 'packages', 'stale-bundles': 'built packages' } satisfies Record<CheckName, string>

const humanReport = (checks: readonly CheckResult[]): string =>
  `${checks
    .flatMap(check => [
      `${check.name.padEnd(14)} ${check.ok ? 'ok' : `${String(check.findings.length)} finding${check.findings.length === 1 ? '' : 's'}`} (${String(check.inspected)} ${inspectedLabel[check.name]})`,
      ...check.findings.flatMap(finding => [
        `  ${finding.file === null ? '' : `${finding.file}${finding.line === null ? '' : `:${String(finding.line)}`}  `}${finding.message} [${finding.rule}]`,
        `    fix: ${finding.hint}`,
      ]),
    ])
    .join('\n')}\n`

export const runRepositoryCheckCli = (argv: readonly string[], io: { readonly stdout: Writable; readonly stderr: Writable }): number => {
  const command = 'check repo'
  const json = argv.includes('--json')
  const fail = (error: { readonly code: string; readonly message: string; readonly hint: string }): number => {
    if (json) io.stdout.write(`${JSON.stringify({ schemaVersion: 1, command, ok: false, error }, null, 2)}\n`)
    else io.stderr.write(`error: ${error.message}\n  fix: ${error.hint}\n`)
    return error.code === 'usage' ? 2 : 1
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout.write(`${HELP}\n`)
    return 0
  }
  const parse = () =>
    parseArgs({ args: [...argv], strict: true, options: { only: { type: 'string' }, cwd: { type: 'string' }, json: { type: 'boolean' } } }).values
  let values: ReturnType<typeof parse>
  try {
    values = parse()
  } catch (error) {
    return fail({ code: 'usage', message: error instanceof Error ? error.message : String(error), hint: 'Run "dshx check repo --help".' })
  }
  const only = values.only
  if (only !== undefined && !isCheckName(only))
    return fail({ code: 'usage', message: `Unknown check "${only}".`, hint: `Pass --only ${checkNames.join(', --only ')}.` })
  try {
    const root = RepositoryWorkspace.root(values.cwd ?? process.cwd())
    const packages = RepositoryWorkspace.packages({ root, decodeJson })
    const checks = (only === undefined ? checkNames : [only]).map(name => runCheck(name, root, packages))
    const ok = checks.every(check => check.ok)
    io.stdout.write(json ? `${JSON.stringify({ schemaVersion: 1, command, ok, data: { root, checks } }, null, 2)}\n` : humanReport(checks))
    return ok ? 0 : 1
  } catch (error) {
    return fail({ code: 'failed', message: error instanceof Error ? error.message : String(error), hint: 'Run from inside a dshx repository, or pass --cwd.' })
  }
}
