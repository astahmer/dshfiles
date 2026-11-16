import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')
const english = (): string => {
  const locales = source('locales.ts')
  return locales.slice(locales.indexOf('const en = {'), locales.indexOf('const zh'))
}

describe('MCP servers page', () => {
  it('has one name, the one the navigation uses', () => {
    expect(english()).not.toContain('Global MCP servers')
    expect(source('manager-view.tsx')).toContain("heading={t('title')}")
  })
  it('describes what the page is for in at most 72 characters', () => {
    expect(english()).toContain("subtitle: 'Tool servers your agents can call.'")
  })
  it('opens the add form from the header primary action, in a dialog', () => {
    const view = source('manager-view.tsx')
    expect(view).toMatch(/primaryAction=\{\{\s*id: 'add-server'/u)
    expect(view).not.toMatch(/<ServerEditor\s/u)
  })
  it('keeps the page to one primary button: saving preferences is secondary', () => {
    const form = source('preferences-form.tsx')
    expect(form).not.toContain('<form.SubmitButton>')
    expect(form).toMatch(/type="submit" variant="outline"/u)
  })
  it('uses the kit inputs as they are and a plain OAuth label', () => {
    expect(source('server-editor.tsx')).not.toMatch(/bg-muted|filledControls/u)
    expect(english()).toContain("useOAuth: 'Sign in with OAuth',")
  })
})
