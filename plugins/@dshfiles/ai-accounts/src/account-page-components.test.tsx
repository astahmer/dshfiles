import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { AccountGroup } from './account-group.js'
import { accountProfileSchema, type AccountProfile } from './api.js'
import { ModelCuration } from './model-curation.js'

const account = (instanceId: string, patch: Partial<AccountProfile> = {}): AccountProfile =>
  accountProfileSchema.parse({
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
          onToggle={noop}
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
    expect(markup).toContain('aria-label="Hide second in the model picker"')
    expect(markup).toMatch(/role="switch"[^>]*data-state="checked"/u)
    expect(markup).not.toContain('title=')
  })
  it('shows real identity and plan without fabricated metadata', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AccountGroup
          accounts={[account('work', { identity: 'real@example.test', plan: 'business', signedIn: true })]}
          kind="codex"
          onMove={noop}
          onSelect={noop}
          onToggle={noop}
          reorderingDisabled={false}
          selectedId={null}
          visibleIds={['work']}
        />
      </TooltipProvider>,
    )
    expect(markup).toContain('real@example.test')
    expect(markup).toContain('business')
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
