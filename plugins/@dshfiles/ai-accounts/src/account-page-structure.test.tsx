import { readFileSync } from 'node:fs'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { AccountDraftModel } from './account-draft.js'
import { AccountNameEditor } from './account-name-editor.js'
import { accountProfileSchema } from './api.js'
import { DetailHeader } from './detail-header.js'
import { ModelCuration } from './model-curation.js'
import { ProviderGlyph } from './panel-primitives.js'

const noop = (): void => undefined
const source = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('account detail anatomy', () => {
  it('draws each provider on its brand colour, so accounts are told apart at a glance', () => {
    const markup = renderToStaticMarkup(<ProviderGlyph kind="commandcode" />)
    expect(markup).toMatch(/background-color:/u)
    expect(markup).toContain('dshx:rounded-lg')
    expect(renderToStaticMarkup(<ProviderGlyph kind="claude" />)).not.toEqual(markup)
  })
  it('sets the account name at section-title size, under the page title', () => {
    const markup = renderToStaticMarkup(<AccountNameEditor disabled={false} editing={false} name="Command Code 1" onChange={noop} onEditingChange={noop} />)
    expect(markup).toMatch(/<h2[^>]*dshx:text-sm[^>]*>Command Code 1<\/h2>/u)
    expect(markup).not.toContain('text-2xl')
  })
  it('keeps the header to one row and says nothing when the provider reports no identity', () => {
    const header = (detail: string): string =>
      renderToStaticMarkup(
        <DetailHeader detail={detail} mark={<ProviderGlyph kind="codex" />} state={{ text: 'Checked 03:18 PM', tone: 'muted' }} title={<h2>Work</h2>}>
          <button type="button">Sign out</button>
        </DetailHeader>,
      )
    expect(header('')).not.toContain('not reported')
    expect(header('')).toContain('Checked 03:18 PM')
    expect(header('business · real@example.test')).toContain('business · real@example.test')
  })
  it('renders Models as a page section with no card or framed table', () => {
    const draft = AccountDraftModel.toDraft(
      Schema.decodeUnknownSync(accountProfileSchema)({
        ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
        instanceId: 'work',
        displayName: 'Work',
        signedIn: true,
        identity: null,
        plan: null,
        mode: 'direct',
        state: 'healthy',
        loginHint: '',
        detail: null,
      }),
    )
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ModelCuration account={draft} catalog={[{ id: 'gpt-6', name: 'GPT Six', efforts: [], defaultEffort: null }]} onChange={noop} />
      </TooltipProvider>,
    )
    expect(markup).toContain('data-slot="page-section"')
    expect(markup).toMatch(/<h2[^>]*>Models<\/h2>/u)
    // Controls keep their own border; the section and its table draw none around themselves.
    expect(markup).toContain('dshx:overflow-x-auto dshx:border-y')
    expect(markup).not.toContain('dshx:rounded-lg dshx:border dshx:bg-background')
  })
  it('has one card: the detail pane. Its sections separate by hairlines', () => {
    for (const file of ['account-detail.tsx', 'account-settings.tsx', 'model-curation.tsx', 'native-provider-detail.tsx']) {
      expect(source(file), file).not.toContain('dshx:bg-card')
      expect(source(file), file).not.toMatch(/dshx:rounded-(md|lg|xl) dshx:border/u)
    }
  })
})

describe('account detail sections (council round 3, D3)', () => {
  it('keeps the Models tab to the models table, with a link to the defaults on the Settings tab', () => {
    const detail = source('account-detail.tsx')
    const models = detail.slice(detail.indexOf('value="models">'), detail.indexOf('value="settings">'))
    expect(models).not.toContain('AccountInlineSettings')
    expect(models).toMatch(/onClick=\{\(\) => props\.onSectionChange\('settings'\)\}/u)
    expect(models).toContain('Model defaults')
    expect(source('account-settings.tsx')).toMatch(/<AccountModelDefaults\s/u)
  })

  it('draws a model\'s reasoning effort as quiet text with a chevron, not a boxed field', () => {
    const draft = AccountDraftModel.toDraft(
      Schema.decodeUnknownSync(accountProfileSchema)({
        ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
        instanceId: 'work',
        displayName: 'Work',
        signedIn: true,
        identity: null,
        plan: null,
        mode: 'direct',
        state: 'healthy',
        loginHint: '',
        detail: null,
      }),
    )
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ModelCuration
          account={draft}
          catalog={[{ id: 'gpt-6', name: 'GPT Six', efforts: [{ id: 'low', name: 'Low' }], defaultEffort: null }]}
          onChange={noop}
        />
      </TooltipProvider>,
    )
    const trigger = /<button[^>]*aria-label="Default reasoning effort for GPT Six"[^>]*>/u.exec(markup)?.[0] ?? /<button(?:(?!<button).)*?aria-label="Default reasoning effort for GPT Six"/su.exec(markup)?.[0] ?? ''
    expect(trigger).toContain('dshx:border-transparent')
    expect(trigger).toContain('dshx:bg-transparent')
    expect(trigger).toContain('dshx:shadow-none')
  })
})
