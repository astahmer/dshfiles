import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const english = (source: string): string => source.slice(0, source.indexOf('const zh = {'))

test('Traces copy names no package, catalog field or plugin, and confirmations say what happens', () => {
  const locales = english(read('./locales.ts'))
  const alerts = english(read('./alerts/alerts-locale.ts'))
  const settings = read('./settings.ts')
  for (const leak of ['models.dev', 'dshx.cost.usd', 'AI Accounts keeps']) expect(locales).not.toContain(leak)
  expect(settings).not.toContain('This plugin:')
  expect(locales).toContain("sessionEmptyBody: 'Turn, model and tool spans show here within seconds of the work.'")
  expect(locales).toContain("clearTitle: 'Clear all stored traces?'")
  expect(locales).toContain("clearConfirm: 'Clear traces'")
  expect(alerts).toContain("deleteRuleBody: 'The rule stops alerting. Past alerts are kept.'")
})
