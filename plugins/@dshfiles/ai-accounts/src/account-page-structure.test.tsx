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
import { AccountGroup } from './account-group.js'
import { AccountConnection } from './account-connection-status.js'
import { formatClockTime } from '@dshfiles/plugin-ui/lib/format-clock-time'

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
  it('sets the Checked time under the account name, not beside it (council round 10, D2)', () => {
    const markup = renderToStaticMarkup(<DetailHeader detail="Checked 03:18 PM" mark={<ProviderGlyph kind="codex" />} title={<h2>Work</h2>} />)
    // The name and its detail line share one column beside the mark.
    expect(markup).toMatch(/<div class="[^"]*dshx:flex-col[^"]*"><h2>Work<\/h2><span[^>]*data-detail-header-detail[^>]*>Checked 03:18 PM<\/span><\/div>/u)
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
    // The Models tab already names the section: its heading stays for assistive tech only (council round 4, D2).
    const section = /<section[^>]*data-slot="page-section"[^>]*class="([^"]*)"/u.exec(markup)?.[1]?.replaceAll('&amp;', '&').replaceAll('&gt;', '>')
    expect(section).toContain('dshx:[&>div:first-child]:sr-only')
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

describe('account detail header and tabs (council round 4, D2)', () => {
  const detail = source('account-detail.tsx')
  it('switches sections with underline tabs and no icons', () => {
    expect(detail).toMatch(/<TabsList variant="line" aria-label="Account sections"/u)
    const tabs = detail.slice(detail.indexOf('<TabsList'), detail.indexOf('</TabsList>'))
    expect(tabs).not.toContain('Icon')
  })
  it('labels the enable switch with visible text', () => {
    const header = detail.slice(detail.indexOf('<DetailHeader'), detail.indexOf('</DetailHeader>'))
    // "Show this account" names what the switch does, as the table's "Show model" does per row (council round 9, D3).
    expect(header).toMatch(/<Label[^>]*>\s*\{AccountLabels\.routedKind\(draft\.kind\) \? 'Show this account' : 'Track quota'\}\s*<Switch/u)
    expect(header).not.toContain("'In model picker'")
    // A hairline parts the health word from the switch label, so "Connected" and "Show this account" read as two things.
    expect(header).toMatch(/<Label className="[^"]*dshx:border-l[^"]*dshx:pl-3/u)
  })
  it('keeps Sign out in the account actions menu, not as a header button', () => {
    const menu = detail.slice(detail.indexOf('<DropdownMenuContent'), detail.indexOf('</DropdownMenuContent>'))
    expect(menu).toMatch(/onSelect=\{\(\) => setSignOutOpen\(true\)\}/u)
    expect(menu).toContain('Sign out…')
    expect(detail).toMatch(/<AccountSignOut[^>]*open=\{signOutOpen\}[^>]*onOpenChange=\{setSignOutOpen\}/u)
  })
  it('moves the last check into the detail line; the state keeps the dot and its word', () => {
    expect(detail).toMatch(/detail=\{\[[^\]]*AccountConnection\.checkedLabel\(status\)\]/u)
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

  it("draws a model's reasoning effort in the one field look the table's other controls use (council round 5, D2)", () => {
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
    const classOf = (label: string): string => new RegExp(`<button[^>]*aria-label="${label}"[^>]*class="([^"]*)"`, 'u').exec(markup)?.[1] ?? ''
    const effort = classOf('Default reasoning effort for GPT Six')
    const mode = classOf('Model settings mode')
    for (const look of ['dshx:border-field-border', 'dshx:bg-background', 'dshx:h-(--dshx-control-h)']) {
      expect(effort).toContain(look)
      expect(mode).toContain(look)
    }
    expect(effort).not.toContain('dshx:border-transparent')
    // A1's control height owns every field's height: no per-control override, the account search included.
    expect(source('model-curation.tsx')).not.toContain('dshx:h-8')
    expect(source('accounts-toolbar.tsx')).not.toContain('dshx:h-10')
  })
})

describe('AI accounts page (council round 5, D2)', () => {
  const profile = (instanceId: string, displayName: string) =>
    Schema.decodeUnknownSync(accountProfileSchema)({
      ...AccountDraftModel.newAccountDraft({ kind: 'commandcode', existing: [] }),
      instanceId,
      displayName,
      signedIn: true,
      identity: null,
      plan: null,
      mode: 'direct',
      state: 'healthy',
      loginHint: '',
      detail: null,
    })
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <AccountGroup
        kind="commandcode"
        accounts={[profile('one', 'Command Code 1'), profile('two', 'Command Code 2')]}
        visibleIds={['one', 'two']}
        selectedId="one"
        onSelect={noop}
        onMove={noop}
        reorderingDisabled={false}
      />
    </TooltipProvider>,
  )
  const row = (name: string): string => new RegExp(`<div class="([^"]*)"><button aria-current="[^"]*" aria-label="Select ${name}"`, 'u').exec(markup)?.[1] ?? ''
  const unselectedRow = /<div class="([^"]*)"><button aria-label="Select Command Code 2"/u.exec(markup)?.[1] ?? ''
  const title = (name: string): string => new RegExp(`<strong class="([^"]*)">${name}</strong>`, 'u').exec(markup)?.[1] ?? ''

  it('marks the selected account row with the kit selection marker and a 550 label', () => {
    expect(row('Command Code 1')).toContain('dshx:bg-selected-wash')
    expect(row('Command Code 1')).toContain('dshx:selected-marker')
    expect(unselectedRow).not.toContain('dshx:selected-marker')
    expect(title('Command Code 1')).toContain('dshx:font-selected')
    expect(title('Command Code 2')).toContain('dshx:font-medium')
  })

  it('draws the list marks at 28 px; the detail header keeps 32', () => {
    expect(markup).toMatch(/<span aria-hidden="true" class="[^"]*dshx:size-7[^"]*"/u)
    expect(renderToStaticMarkup(<ProviderGlyph kind="commandcode" />)).toContain('dshx:size-8')
    expect(source('native-providers-list.tsx')).toContain('<NativeProviderMark label={provider.label} size="list" />')
  })

  it('opens Quota recovery with the kit disclosure, never the native marker', () => {
    expect(source('accounts-panel.tsx')).toMatch(/<details className="[^"]*dshx:disclosure[^"]*">/u)
  })

  it('prints the last check with the kit clock formatter, so it agrees with the transcript', () => {
    const at = Date.UTC(2026, 10, 25, 20, 42)
    const status = { ...AccountConnection.status(profile('one', 'Command Code 1'), null), checkedAt: at }
    expect(AccountConnection.checkedLabel(status)).toBe(`Checked ${formatClockTime(at)}`)
  })

  it('sits on the wide data frame, on the stage surface', () => {
    const panel = source('accounts-panel.tsx')
    expect(panel).toMatch(/<Page\s+data-account-dashboard\s+scroll\s+width="wide"/u)
    expect(panel).toContain('dshx:surface-stage')
    expect(panel).not.toContain('max-w-[1680px]')
  })
})

describe('AI accounts page title mark (council round 8, D4)', () => {
  it('marks the page, loading or loaded, with its own Settings leaf glyph: the violet people mark of Models & accounts', () => {
    const panel = source('accounts-panel.tsx')
    const pages = panel
      .split('<Page')
      .slice(1)
      .map(part => part.slice(0, part.indexOf('heading="AI accounts"')))
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      expect(page).toContain('mark={ACCOUNTS_MARK}')
      // An identity tone is not a nav tone: the glyph carries it, and the kit's muted default stays unused.
      expect(page).not.toContain('markTone=')
    }
    expect(panel).toContain('const ACCOUNTS_MARK = <UsersRoundIcon className="dshx:text-identity-2" strokeWidth={1.5} />')
  })
})
