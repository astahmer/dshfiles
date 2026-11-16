import { readdirSync, readFileSync } from 'node:fs'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { AccountDraftModel } from './account-draft.js'
import { AccountGroup } from './account-group.js'
import { accountConnectionStatus, accountStateLine } from './account-connection-status.js'
import { accountProfileSchema, accountsUsageSchema, type AccountProfile } from './api.js'

const account = (patch: Partial<AccountProfile> = {}): AccountProfile =>
  Schema.decodeUnknownSync(accountProfileSchema)({
    ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
    instanceId: 'codex_work',
    displayName: 'Work',
    signedIn: true,
    identity: null,
    plan: null,
    mode: 'direct',
    state: 'healthy',
    loginHint: '',
    detail: null,
    ...patch,
  })
const usage = Schema.decodeUnknownSync(accountsUsageSchema)({
  readAt: Date.UTC(2026, 10, 16, 15, 18),
  hostName: 'synthetic-host',
  cards: [
    {
      instanceId: 'codex_work',
      displayName: 'Work',
      kind: 'codex',
      enabled: true,
      usage: { status: 'ok', identity: null, message: 'Authenticated quota response', windows: [], plan: null, bankedResets: 0, bankedResetExpiries: [] },
    },
  ],
})
const noop = (): void => undefined
const row = (profile: AccountProfile, selectedId: string | null): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <AccountGroup
        accounts={[profile]}
        kind="codex"
        onMove={noop}
        onSelect={noop}
        onToggle={noop}
        reorderingDisabled={false}
        selectedId={selectedId}
        usage={usage}
        visibleIds={[profile.instanceId]}
      />
    </TooltipProvider>,
  )

describe('a healthy accounts page is quiet', () => {
  it('leaves every switch on the kit colour', () => {
    const sources = readdirSync(new URL('.', import.meta.url))
      .filter(name => name.endsWith('.tsx') && !name.includes('.test.'))
      .filter(name => readFileSync(new URL(name, import.meta.url), 'utf8').includes('data-[state=checked]:bg-'))
    expect(sources).toEqual([])
  })
  it('draws no dot, green text or indigo for a connected account', () => {
    const markup = row(account(), null)
    expect(markup).not.toContain('data-slot="status-dot"')
    expect(markup).not.toContain('text-success')
    expect(markup).not.toMatch(/(bg|border|ring|border-l)-info/u)
  })
  it('marks the selected account with the selected-row fill, not a side border', () => {
    const markup = row(account(), 'codex_work')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('dshx:bg-accent')
    expect(markup).not.toContain('border-l-')
    expect(markup).not.toMatch(/(bg|border|ring)-info/u)
  })
  it('keeps colour for a state that blocks routing', () => {
    const markup = row(account({ state: 'cooling' }), null)
    expect(markup).toContain('Rate limited')
    expect(markup).toContain('dshx:text-warning')
  })
})

describe('account state line', () => {
  const time = (at: number): string => `at ${at}`
  it('says when a healthy account was checked, in muted text', () => {
    expect(accountStateLine(accountConnectionStatus(account(), usage), time)).toEqual({ text: `Checked at ${usage.readAt}`, tone: 'muted' })
  })
  it('names a blocking state and keeps its colour', () => {
    expect(accountStateLine(accountConnectionStatus(account({ state: 'cooling' }), usage), time)).toEqual({
      text: `Rate limited · checked at ${usage.readAt}`,
      tone: 'warning',
    })
  })
  it('falls back to the plain state when the provider was never asked', () => {
    expect(accountStateLine(accountConnectionStatus(account({ signedIn: false }), null), time)).toEqual({ text: 'Not signed in', tone: 'muted' })
  })
})
