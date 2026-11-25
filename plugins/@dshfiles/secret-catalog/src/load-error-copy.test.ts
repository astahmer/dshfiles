import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('Secrets when the CLI does not answer', () => {
  it('names the secret CLI and says how to get it working', () => {
    const english = read('locales.ts').split('const zh')[0] ?? ''
    const line = /^ {2}loadFailed:\s*\n?\s*'([^']*)',$/mu.exec(english)?.[1] ?? ''
    expect(line).toContain('`secret`')
    expect(line).toMatch(/install/iu)
    expect(line).toContain('secret unlock --store')
  })

  it('offers one Retry and hides the filters and the header Refresh while the list failed', () => {
    const panel = read('secret-catalog-panel.tsx')
    expect(panel).toContain('actions={listFailed ? [] : [')
    expect(panel).toMatch(/\{listFailed \? null : \(\s*<section aria-label=\{t\('catalogFilters'\)\}/u)
  })

  it('says global aliases are shown in a muted line, not an indigo banner', () => {
    expect(read('secret-catalog-panel.tsx')).not.toMatch(/<Alert role="status" variant="info">\s*<AlertDescription>\{t\('globalOnlyNotice'\)\}/u)
  })
})
