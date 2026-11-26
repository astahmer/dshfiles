import { readFileSync } from 'node:fs'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { AccountGroup } from './account-group.js'
import { accountProfileSchema, type AccountProfile } from './api.js'
import { ModelCuration } from './model-curation.js'
import * as Schema from 'effect/Schema'

const account = (instanceId: string, patch: Partial<AccountProfile> = {}): AccountProfile =>
  Schema.decodeUnknownSync(accountProfileSchema)({
    ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
    instanceId,
    displayName: instanceId,
    signedIn: false,
    identity: null,
    plan: null,
    mode: 'direct',
    state: 'unconfigured',
    loginHint: '',
    detail: null,
    ...patch,
  })
const noop = (): void => undefined

describe('account page cards', () => {
  it('retains true provider priority and move actions when search hides earlier accounts', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AccountGroup
          accounts={[account('first'), account('second')]}
          kind="codex"
          onMove={noop}
          onSelect={noop}
          reorderingDisabled={false}
          selectedId="second"
          visibleIds={['second']}
        />
      </TooltipProvider>,
    )
    expect(markup).not.toContain('>first<')
    expect(markup).toContain('data-account-priority="2"')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('aria-label="Actions for second"')
    expect(markup).not.toContain('title=')
  })
  it('draws each row as a selector only: brand tile, name, one health dot (round five P5)', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AccountGroup
          accounts={[account('first'), account('second')]}
          kind="codex"
          onMove={noop}
          onSelect={noop}
          reorderingDisabled={false}
          selectedId="second"
          visibleIds={['first', 'second']}
        />
      </TooltipProvider>,
    )
    expect(markup).toContain('aria-label="Select second"')
    // Show in picker, rename and the Models / Settings / Usage sections live once, in the detail.
    expect(markup).not.toContain('role="switch"')
    expect(markup).not.toContain('aria-label="Rename second"')
    expect(markup).not.toMatch(/sections"/u)
    expect(markup).not.toContain('Activity and subscription quota')
  })
  it('keeps the built-in provider switch out of the rail, where the row selects', () => {
    const source = readFileSync(new URL('native-providers-list.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/props\.onSelect === undefined \? \(\s*<Switch/u)
  })
  it('shows real identity and plan without fabricated metadata', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AccountGroup
          accounts={[account('work', { identity: 'real@example.test', plan: 'business', signedIn: true })]}
          kind="codex"
          onMove={noop}
          onSelect={noop}
          reorderingDisabled={false}
          selectedId={null}
          visibleIds={['work']}
        />
      </TooltipProvider>,
    )
    expect(markup).toContain('real@example.test')
    expect(markup).toContain('Business')
    expect(markup).not.toContain('Last checked')
    expect(markup).not.toContain('Token valid')
  })
})

describe('account page model curation', () => {
  it('preserves curation actions and exposes searchable reasoning without native title or select', () => {
    const draft = { ...AccountDraftModel.toDraft(account('work')), favoriteModelIds: ['gpt-6'], reasoningDefaults: { 'gpt-6': 'high' } }
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ModelCuration
          account={draft}
          catalog={[{ id: 'gpt-6', name: 'GPT Six', efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' }]}
          onChange={noop}
        />
      </TooltipProvider>,
    )
    expect(markup).toContain('aria-label="Search models"')
    expect(markup).toContain('aria-label="Unstar GPT Six"')
    expect(markup).toContain('aria-label="Show GPT Six in the picker"')
    expect(markup).toContain('aria-label="Default reasoning effort for GPT Six"')
    expect(markup).toContain('role="combobox"')
    expect(markup).not.toContain('<select')
    expect(markup).not.toContain('title=')
    expect(markup).toContain('High')
  })
})

describe('account rows lead with a provider glyph (council round 11, A1/D2)', () => {
  it('marks the row glyph as leading, so the selected row draws no marker pill beside it', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AccountGroup
          accounts={[account('first')]}
          kind="codex"
          onMove={noop}
          onSelect={noop}
          reorderingDisabled={false}
          selectedId="first"
          visibleIds={['first']}
        />
      </TooltipProvider>,
    )
    expect(markup).toContain('dshx:selected-marker')
    expect(markup).toMatch(/<span aria-hidden="true" data-leading-glyph=""/u)
  })
})
