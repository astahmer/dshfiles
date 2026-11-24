import { readdirSync, readFileSync } from 'node:fs'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { AccountDraftModel } from './account-draft.js'
import { AccountGroup } from './account-group.js'
import { DetailHeader } from './detail-header.js'
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
const usageWith = (status: 'ok' | 'unauthenticated') => Schema.decodeUnknownSync(accountsUsageSchema)({
  readAt: Date.UTC(2026, 10, 16, 15, 18),
  hostName: 'synthetic-host',
  cards: [
    {
      instanceId: 'codex_work',
      displayName: 'Work',
      kind: 'codex',
      enabled: true,
      usage: { status, identity: null, message: 'Authenticated quota response', windows: [], plan: null, bankedResets: 0, bankedResetExpiries: [] },
    },
  ],
})
const usage = usageWith('ok')
const noop = (): void => undefined
const row = (profile: AccountProfile, selectedId: string | null, reading: typeof usage | null = usage): string =>
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
        usage={reading}
        visibleIds={[profile.instanceId]}
      />
    </TooltipProvider>,
  )

const dots = (markup: string): string[] => [...markup.matchAll(/data-health="([a-z]+)"/gu)].map(match => match[1] ?? '')

describe('a healthy accounts page is quiet', () => {
  it('opens no tooltip faster than the kit default (400 ms)', () => {
    const fast = readdirSync(new URL('.', import.meta.url))
      .filter(name => name.endsWith('.tsx') && !name.includes('.test.'))
      .filter(name => [...readFileSync(new URL(name, new URL('.', import.meta.url)), 'utf8').matchAll(/delayDuration=\{(\d+)\}/gu)].some(match => Number(match[1]) < 400))
    expect(fast).toEqual([])
  })
  it('leaves every switch on the kit colour', () => {
    const sources = readdirSync(new URL('.', import.meta.url))
      .filter(name => name.endsWith('.tsx') && !name.includes('.test.'))
      .filter(name => readFileSync(new URL(name, import.meta.url), 'utf8').includes('data-[state=checked]:bg-'))
    expect(sources).toEqual([])
  })
  it('gives a connected account one green health dot, no green text and no indigo', () => {
    const markup = row(account(), null)
    expect(dots(markup)).toEqual(['ok'])
    expect(markup).toContain('aria-label="Connected"')
    expect(markup).not.toMatch(/text-(success|health-ok)/u)
    expect(markup).not.toMatch(/(bg|border|ring|border-l)-info/u)
  })
  it('marks the selected account with the selected-row fill, not a side border', () => {
    const markup = row(account(), 'codex_work')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('dshx:bg-accent')
    expect(markup).not.toContain('border-l-')
    expect(markup).not.toMatch(/(bg|border|ring)-info/u)
  })
  it('draws a rate-limited account amber, with its label', () => {
    const markup = row(account({ state: 'cooling' }), null)
    expect(dots(markup)).toEqual(['limited'])
    expect(markup).toContain('Rate limited')
    expect(markup).toContain('dshx:text-health-limited')
  })
  it('draws an account whose saved sign-in the provider rejected red', () => {
    const markup = row(account(), null, usageWith('unauthenticated'))
    expect(dots(markup)).toEqual(['down'])
    expect(markup).toContain('Sign-in expired')
    expect(markup).toContain('dshx:text-health-down')
  })
  it('draws an account that was never checked as an off ring', () => {
    expect(dots(row(account({ signedIn: false }), null, null))).toEqual(['off'])
    expect(dots(row(account(), null, null))).toEqual(['off'])
  })
})

describe('account state line', () => {
  const time = (at: number): string => `at ${at}`
  it('names a connected account and when it was checked, beside a green dot', () => {
    expect(accountStateLine(accountConnectionStatus(account(), usage), time)).toEqual({ text: `Connected · checked at ${usage.readAt}`, health: 'ok' })
  })
  it('names a blocking state with its health', () => {
    expect(accountStateLine(accountConnectionStatus(account({ state: 'cooling' }), usage), time)).toEqual({
      text: `Rate limited · checked at ${usage.readAt}`,
      health: 'limited',
    })
  })
  it('falls back to the plain state when the provider was never asked', () => {
    expect(accountStateLine(accountConnectionStatus(account({ signedIn: false }), null), time)).toEqual({ text: 'Not signed in', health: 'off' })
  })
  it('draws the header state as one health dot and muted text while healthy', () => {
    const header = renderToStaticMarkup(<DetailHeader mark={null} state={{ text: 'Connected · checked 08:30', health: 'ok' }} title={<h2>Work</h2>} />)
    expect(dots(header)).toEqual(['ok'])
    expect(header).toContain('dshx:text-muted-foreground')
    expect(header).not.toMatch(/text-(success|health-ok)/u)
  })
})
