import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const lintRoots = ['tooling/dshx/packages', 'plugins', 'scripts', 'apps/desktop/src']

const capsSchema = z.object({ oxlint: z.record(z.string(), z.number().int().nonnegative()) })

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

const caps = capsSchema.parse(JSON.parse(readFileSync(new URL('./lint-ratchet.json', import.meta.url), 'utf8'))).oxlint

const result = spawnSync('pnpm', ['exec', 'oxlint', ...lintRoots, '--config', '.oxlintrc.json', '--report-unused-disable-directives', '--format', 'json'], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
})
if (result.error) throw result.error

const diagnostics = oxlintReportSchema.parse(JSON.parse(result.stdout)).diagnostics

const location = (diagnostic: (typeof diagnostics)[number]): string => {
  const span = diagnostic.labels?.[0]?.span
  return span ? `${diagnostic.filename}:${span.line}:${span.column}` : diagnostic.filename
}

const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error')
const warningsByRule = new Map<string, typeof diagnostics>()
for (const diagnostic of diagnostics) {
  if (diagnostic.severity === 'error') continue
  const rule = diagnostic.code ?? diagnostic.message
  warningsByRule.set(rule, [...(warningsByRule.get(rule) ?? []), diagnostic])
}

let failed = errors.length > 0
for (const error of errors) console.error(`error ${location(error)} ${error.code ?? ''} ${error.message}`)

const rules = [...new Set([...Object.keys(caps), ...warningsByRule.keys()])].sort()
for (const rule of rules) {
  const sites = warningsByRule.get(rule) ?? []
  const cap = caps[rule] ?? 0
  if (sites.length > cap) {
    failed = true
    console.error(`${rule}: ${sites.length} warnings, cap ${cap}`)
    for (const site of sites) console.error(`  ${location(site)}`)
    continue
  }
  if (sites.length < cap) console.log(`${rule}: ${sites.length} warnings, cap ${cap}; lower the cap in scripts/lint-ratchet.json`)
}

const total = [...warningsByRule.values()].reduce((sum, sites) => sum + sites.length, 0)
console.log(`lint: ${errors.length} errors, ${total} warnings across ${warningsByRule.size} rules`)
if (failed) process.exit(1)
