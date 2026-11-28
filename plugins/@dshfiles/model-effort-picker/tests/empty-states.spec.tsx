import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListEmptyState } from '../src/empty-state.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const text = (html: string): string => html.replace(/<[^>]+>/gu, '')
const noop = (): void => undefined

describe('empty and loading states say what to do next (council picker N4)', () => {
  it('tells loading, a search with no match and an empty catalog apart', () => {
    const state = (input: Partial<{ status: string; query: string; rowCount: number; catalogEmpty: boolean }>) =>
      ModelPickerModel.emptyState({ status: 'ready', query: '', rowCount: 0, catalogEmpty: false, ...input })
    expect(state({ rowCount: 3 })).toBeNull()
    expect(state({ status: 'loading' })).toBe('loading')
    expect(state({ query: 'zz' })).toBe('no-match')
    expect(state({ catalogEmpty: true })).toBe('no-models')
    expect(state({ query: 'zz', catalogEmpty: true })).toBe('no-models')
  })

  it('offers to clear a search with no match, naming the query', () => {
    const html = renderToStaticMarkup(<ListEmptyState kind="no-match" onClearSearch={noop} query=" zz " />)
    expect(text(html)).toContain('No models match “zz”')
    expect(html).toMatch(/<button[^>]*>Clear search<\/button>/u)
  })

  it('opens AI accounts when no account offers a model', () => {
    const html = renderToStaticMarkup(<ListEmptyState kind="no-models" onClearSearch={noop} onOpenAccounts={noop} query="" />)
    expect(text(html)).toContain('No models available')
    expect(html).toMatch(/<button[^>]*>Open AI accounts<\/button>/u)
    expect(text(html)).not.toMatch(/No matching models/u)
  })

  it('hides the inspector and Select several when there is nothing to inspect or select', () => {
    const picker = source('model-effort-picker.tsx')
    expect(picker).toMatch(/catalogEmpty && 'dshx:hidden'/u)
    expect(picker).toMatch(/\{rows\.length === 0 \? null : \(\s*<div[^>]*\s*className="[^"]*"\s*data-model-picker-fan-out/u)
    expect(source('client.tsx')).toContain("new CustomEvent('dshfiles:open-settings', { detail: { section: 'ai-accounts' }, cancelable: true })")
  })
})
