import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const lintRoots = ['tooling/dshx/packages', 'plugins', 'scripts', 'apps/desktop/src']

// Deliberate public re-export boundaries, exempt from the ast-grep forwarding rules.
const astGrepBoundaries = ['tooling/dshx/packages/dshx/client/index.d.ts', 'plugins/@dshfiles/plugin-ui/src/icons.ts']

const ruleCapsSchema = z.record(z.string(), z.number().int().nonnegative())
const capsSchema = z.object({ oxlint: ruleCapsSchema, 'ast-grep': ruleCapsSchema })

const oxlintReportSchema = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string().optional(),
      message: z.string(),
      severity: z.string(),
      filename: z.string(),
      labels: z.array(z.object({ span: z.object({ line: z.number(), column: z.number() }) })).optional(),
    }),
  ),
})

const astGrepMatchSchema = z.object({
  ruleId: z.string(),
  message: z.string(),
  file: z.string(),
  range: z.object({ start: z.object({ line: z.number(), column: z.number() }) }),
})

const decodeJson = <Output>(schema: z.ZodType<Output>, text: string): Output => schema.parse(JSON.parse(text))

type Finding = { readonly rule: string; readonly message: string; readonly location: string }

const tool = z.enum(['oxlint', 'ast-grep']).parse(process.argv[2])
const caps = decodeJson(capsSchema, readFileSync(new URL('./lint-ratchet.json', import.meta.url), 'utf8'))[tool]

const run = (args: ReadonlyArray<string>): string => {
  const result = spawnSync('pnpm', ['exec', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  return result.stdout
}

const readFindings = (): ReadonlyArray<Finding> => {
  if (tool === 'oxlint') {
    const output = run(['oxlint', ...lintRoots, '--config', '.oxlintrc.json', '--report-unused-disable-directives', '--format', 'json'])
    return decodeJson(oxlintReportSchema, output).diagnostics.map(diagnostic => {
      const span = diagnostic.labels?.[0]?.span
      return {
        rule: diagnostic.severity === 'error' ? 'error' : (diagnostic.code ?? diagnostic.message),
        message: diagnostic.message,
        location: span ? `${diagnostic.filename}:${span.line}:${span.column}` : diagnostic.filename,
      }
    })
  }
  const output = run(['ast-grep', 'scan', ...lintRoots, '--json=stream', ...astGrepBoundaries.map(path => `--globs=!${path}`)])
  return output
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const match = decodeJson(astGrepMatchSchema, line)
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
