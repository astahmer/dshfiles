import { describe, expect, it } from 'vitest'

import type { OptmemProvider } from './api.ts'
import { OptmemSettingsDraft } from './settings-draft.ts'

const providers: readonly OptmemProvider[] = [
  { id: 'codex-emialex', name: 'Codex', kind: 'codex', models: ['gpt-6-sol', 'gpt-6-luna'] },
  { id: 'claude_work', name: 'Claude', kind: 'claude', models: ['claude-opus-5-5', 'claude-haiku-5-1'] },
  { id: 'work-cursor', name: 'Cursor', kind: null, models: ['auto'] },
]

describe('settings decoding', () => {
  it('fills every field an old Host does not serve with its default', () => {
    const decoded = OptmemSettingsDraft.decode({ enabled: false, injectRefreshBytes: 2_048 })
    expect(decoded.enabled).toBe(false)
    expect(decoded.injectRefreshBytes).toBe(2_048)
    expect(decoded.summarizerPaused).toBe(false)
    expect(decoded.cheapModels.map(entry => entry.kind)).toEqual(['codex', 'claude', 'opencode-go', 'commandcode', 'deepseek'])
    expect(decoded.cheapModels[0]).toEqual({ kind: 'codex', models: ['gpt-6-luna'], effort: 'low' })
    expect(decoded.summarizerFallbacks).toEqual([])
  })

  it('keeps the valid fields when one stored field no longer decodes', () => {
    const decoded = OptmemSettingsDraft.decode({ mode: 'turbo', barrierMs: 9_000, summarizerFallbacks: [{ provider: 'x' }] })
    expect(decoded.mode).toBe('compat')
    expect(decoded.barrierMs).toBe(9_000)
    expect(decoded.summarizerFallbacks).toEqual([])
  })

  it('never throws on a missing or non-object value', () => {
    expect(OptmemSettingsDraft.decode(undefined)).toEqual(OptmemSettingsDraft.defaults)
    expect(OptmemSettingsDraft.decode('nope')).toEqual(OptmemSettingsDraft.defaults)
  })
})

describe('draft edits', () => {
  const base = OptmemSettingsDraft.defaults

  it('writes only the fields that differ from the Host value', () => {
    const edits = { enabled: true, barrierMs: 7_000, cheapModels: base.cheapModels.map(entry => ({ ...entry })) }
    expect(OptmemSettingsDraft.changedKeys(base, edits)).toEqual(['barrierMs'])
  })

  it('reports the schema error for an out-of-range number', () => {
    expect(OptmemSettingsDraft.validationError({ ...base, injectUpperBytes: 10 })).toBeTypeOf('string')
    expect(OptmemSettingsDraft.validationError(base)).toBeUndefined()
  })

  it('reorders a list and ignores moves past either end', () => {
    expect(OptmemSettingsDraft.move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(OptmemSettingsDraft.move(['a', 'b'], 0, 2)).toEqual(['a', 'b'])
  })
})

describe('route warnings', () => {
  const base = OptmemSettingsDraft.defaults

  it('checks an override and fallbacks against the models their provider offers', () => {
    const warnings = OptmemSettingsDraft.routeWarnings(
      {
        ...base,
        summarizerProvider: 'claude_work',
        summarizerModel: 'gpt-6-luna',
        summarizerFallbacks: [
          { provider: 'codex-emialex', model: 'gpt-6-luna', effort: 'low' },
          { provider: 'gone', model: 'x', effort: '' },
          { provider: '', model: 'claude-haiku-*', effort: '' },
          { provider: '', model: 'nowhere-model', effort: '' },
        ],
      },
      providers,
    )
    expect(warnings).toEqual([
      { field: 'override', message: 'claude_work does not offer gpt-6-luna.' },
      { field: 'summarizerFallbacks.1', message: 'Provider gone is not configured in DSH.' },
      { field: 'summarizerFallbacks.3', message: "No configured provider offers nowhere-model; threads whose provider lacks it skip this route." },
    ])
  })

  it("flags a cheap-model entry none of whose models its providers offer", () => {
    const warnings = OptmemSettingsDraft.routeWarnings(
      { ...base, cheapModels: [{ kind: 'codex', models: ['gpt-9-mini'], effort: 'low' }, { kind: 'claude', models: ['claude-haiku-*'], effort: 'low' }] },
      providers,
    )
    expect(warnings).toEqual([{ field: 'cheapModels.0', message: 'codex-emialex offers none of these models; its summaries go to the fallbacks.' }])
  })

  it('says nothing before the provider list has loaded', () => {
    expect(OptmemSettingsDraft.routeWarnings({ ...base, summarizerModel: 'anything' }, [])).toEqual([])
  })
})
