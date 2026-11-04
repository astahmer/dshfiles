import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import * as Schema from 'effect/Schema'
import { ScriptJson } from './json.ts'

const lintRoots = ['tooling/dshx/packages', 'plugins', 'scripts']

// Files whose forwarding is the point: each is the target of its package's export map (the public
// surface of that package), a deliberate vendor shim, or the single JSON decode boundary that turns
// text into a value. Everything else imports the defining module directly.
const astGrepBoundaries = [
  'scripts/json.ts',
  'tooling/dshx/packages/dshx/src/json.ts',
  'plugins/@dshfiles/agents/src/contract.ts',
  'plugins/@dshfiles/credential-port/src/index.ts',
  'plugins/@dshfiles/multi-host/src/destination/index.ts',
  'plugins/@dshfiles/optmem-core/src/index.ts',
  'plugins/@dshfiles/plugin-ui/src/machine.ts',
  'plugins/@dshfiles/plugin-ui/src/shiki-slim.ts',
  'plugins/@dshfiles/plugin-ui/src/virtual.ts',
  'plugins/@dshfiles/plugin-ui/src/icons.ts',
  'plugins/@dshfiles/workspace-folder-picker/src/picker/index.ts',
  'plugins/@dshfiles/project-checks/src/api.ts',
  'tooling/dshx/packages/dshx/src/effect/index.ts',
  'plugins/@dshfiles/credential-port/src/effect.ts',
  'plugins/@dshfiles/jj-cli/src/index.ts',
  'plugins/@dshfiles/git-cli/src/index.ts',
  'plugins/@dshfiles/session-source-port/src/index.ts',
  'tooling/dshx/packages/dshx/src/effect/api.ts',
  'tooling/dshx/packages/dshx/src/effect/plugin.ts',
  'tooling/dshx/packages/dshx/src/effect/services.ts',
  'tooling/dshx/packages/dshx/src/effect/child-process-spawner.ts',
  'tooling/dshx/packages/dshx/src/effect/keyed-mutex.ts',
  'tooling/dshx/packages/dshx/src/effect/host-commands.ts',
  'tooling/dshx/packages/dshx/src/effect/host-prompt.ts',
  'tooling/dshx/packages/dshx/src/effect/settings.ts',
  'plugins/@dshfiles/usage/src/api.ts',
  'plugins/@dshfiles/input-trigger/src/client/index.ts',
  'plugins/@dshfiles/main-tabs/src/workbench-tabs.ts',
  'plugins/@dshfiles/rich-composer/src/conversation-contract.ts',
  'tooling/dshx/packages/create-dshx/src/capabilities.ts',
  'tooling/dshx/packages/create-dshx/src/index.ts',
  'tooling/dshx/packages/dshx/client/index.d.ts',
  'tooling/dshx/packages/dshx/src/api/index.ts',
  'tooling/dshx/packages/dshx/src/client/index.ts',
  'tooling/dshx/packages/dshx/src/communication/index.ts',
  'tooling/dshx/packages/dshx/src/config/index.ts',
  'tooling/dshx/packages/dshx/src/conversation/index.ts',
  'tooling/dshx/packages/dshx/src/host/index.ts',
  'tooling/dshx/packages/dshx/src/index.ts',
  'tooling/dshx/packages/dshx/src/platform/index.ts',
  'tooling/dshx/packages/dshx/src/platform/host-api.ts',
  'tooling/dshx/packages/dshx/src/settings/index.ts',
  'tooling/dshx/packages/dshx/src/tooling/index.ts',
  'tooling/dshx/packages/dshx/src/tracing/index.ts',
]

// Vendored upstream source: kept byte-comparable to its pinned revision, so this repository's rules do not apply.
const astGrepVendored = [
  'plugins/@dshfiles/model-selection/src/native/**',
  'plugins/@dshfiles/agent-preset/src/native/**',
  'plugins/@dshfiles/rich-composer/src/native/**',
  'plugins/@dshfiles/chat/src/native/**',
  'plugins/@dshfiles/session-controller/src/native/**',
  'plugins/@dshfiles/subprocess-local/src/native/**',
  'plugins/@dshfiles/goal-tool/src/native/**',
  'plugins/@dshfiles/session-controller/src/host.ts',
  'plugins/@dshfiles/subprocess-local/src/host.ts',
  'plugins/@dshfiles/session-controller/typert/**',
  'plugins/@dshfiles/frame-layout/src/native/**',
  'plugins/@dshfiles/user-questions/src/native/**',
  'plugins/@dshfiles/workspace-nav/src/native/**',
  'plugins/@dshfiles/workspace-nav/src/host.ts',
]

const ruleCapsSchema = Schema.Record(Schema.String, Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)))
const capsSchema = Schema.Struct({ oxlint: ruleCapsSchema, 'ast-grep': ruleCapsSchema })

const oxlintReportSchema = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.optionalKey(Schema.String),
      message: Schema.String,
      severity: Schema.String,
      filename: Schema.String,
      labels: Schema.optionalKey(Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Number, column: Schema.Number }) }))),
    }),
  ),
})

const astGrepMatchSchema = Schema.Struct({
  ruleId: Schema.String,
  message: Schema.String,
  file: Schema.String,
  range: Schema.Struct({ start: Schema.Struct({ line: Schema.Number, column: Schema.Number }) }),
})

type Finding = { readonly rule: string; readonly message: string; readonly location: string }

const tool = Schema.decodeUnknownSync(Schema.Literals(['oxlint', 'ast-grep']))(process.argv[2])
const caps = ScriptJson.decodeJson(capsSchema, readFileSync(new URL('./lint-ratchet.json', import.meta.url), 'utf8'))[tool]

const run = (args: ReadonlyArray<string>): string => {
  const result = spawnSync('pnpm', ['exec', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  return result.stdout
}

const readFindings = (): ReadonlyArray<Finding> => {
  if (tool === 'oxlint') {
    const output = run(['oxlint', ...lintRoots, '--config', '.oxlintrc.json', '--report-unused-disable-directives', '--format', 'json'])
    return ScriptJson.decodeJson(oxlintReportSchema, output).diagnostics.map(diagnostic => {
      const span = diagnostic.labels?.[0]?.span
      return {
        rule: diagnostic.severity === 'error' ? 'error' : (diagnostic.code ?? diagnostic.message),
        message: diagnostic.message,
        location: span ? `${diagnostic.filename}:${span.line}:${span.column}` : diagnostic.filename,
      }
    })
  }
  const output = run(['ast-grep', 'scan', ...lintRoots, '--json=stream', ...[...astGrepBoundaries, ...astGrepVendored].map(path => `--globs=!${path}`)])
  return output
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const match = ScriptJson.decodeJson(astGrepMatchSchema, line)
      return { rule: match.ruleId, message: match.message, location: `${match.file}:${match.range.start.line + 1}:${match.range.start.column + 1}` }
    })
}

const findingsByRule = new Map<string, Array<Finding>>()
for (const finding of readFindings()) findingsByRule.set(finding.rule, [...(findingsByRule.get(finding.rule) ?? []), finding])

let failed = false
for (const rule of [...new Set([...Object.keys(caps), ...findingsByRule.keys()])].sort()) {
  const findings = findingsByRule.get(rule) ?? []
  const cap = caps[rule] ?? 0
  if (findings.length > cap) {
    failed = true
    console.error(`${rule}: ${findings.length} findings, cap ${cap}`)
    for (const finding of findings) console.error(`  ${finding.location} ${finding.message}`)
    continue
  }
  if (findings.length < cap) console.log(`${rule}: ${findings.length} findings, cap ${cap}; lower the cap in scripts/lint-ratchet.json`)
}

const total = [...findingsByRule.values()].reduce((sum, findings) => sum + findings.length, 0)
console.log(`${tool}: ${total} findings across ${findingsByRule.size} rules`)
if (failed) process.exit(1)
