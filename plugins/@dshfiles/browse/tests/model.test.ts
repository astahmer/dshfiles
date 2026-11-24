import { readFileSync } from 'node:fs'
import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { HandoffAttention } from '../src/handoff-attention.js'
import { BrowseOutput, IDLE_PAIRING, type BrowseStatus } from '../src/model.js'

/** Captured from `browse status --json` / `browse pair --list` (browse 0.1.5), home path and ids redacted. */
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const parse = (name: string): BrowseStatus => {
  const parsed = BrowseOutput.parseStatus({ stdout: fixture(name), command: 'browse', pairing: IDLE_PAIRING })
  if (Option.isNone(parsed)) throw new Error(`${name} did not parse`)
  return parsed.value
}

describe('browse status --json', () => {
  it('reads a running relay with a connected browser and no tabs', () => {
    const status = parse('status-running.json')
    expect(status).toMatchObject({
      kind: 'ready',
      version: '0.1.5',
      setupInstalled: true,
      relay: { running: true, endpoint: 'http://127.0.0.1:19988', version: '0.1.5' },
      extension: { connected: true, pairingState: 'connected', nextStep: null },
      browsers: [{ id: 'brave-clements-macbook-pro', name: 'Brave on Clements-MacBook-Pro', connected: true, isDefault: true, tabs: 0 }],
      tabs: [],
      waiting: 0,
    })
  })

  it('reads a stopped relay without inventing browsers or tabs', () => {
    expect(parse('status-stopped.json')).toMatchObject({
      kind: 'ready',
      relay: { running: false, endpoint: 'http://127.0.0.1:19988', version: null },
      extension: { connected: false, pairingState: null },
      browsers: [],
      tabs: [],
      waiting: 0,
    })
  })

  it('reports tabs waiting on the user with their handoff message and start', () => {
    const status = parse('status-handoff.json')
    if (status.kind !== 'ready') throw new Error('expected ready')
    expect(status.waiting).toBe(1)
    expect(status.tabs).toEqual([
      {
        tab: 7,
        id: 'work-gh',
        url: 'https://github.com/login',
        title: 'Sign in to GitHub',
        browser: 'brave-clements-macbook-pro',
        busy: true,
        lent: false,
        handoff: { message: 'Sign in to GitHub, then click Continue.', startedAt: '2026-11-24T15:30:02.000Z' },
      },
      {
        tab: 8,
        id: null,
        url: 'https://example.com/',
        title: 'Example Domain',
        browser: 'brave-clements-macbook-pro',
        busy: false,
        lent: false,
        handoff: null,
      },
    ])
  })

  it('refuses output that is not the status JSON', () => {
    expect(Option.isNone(BrowseOutput.parseStatus({ stdout: 'Setup: installed', command: 'browse', pairing: IDLE_PAIRING }))).toBe(true)
  })
})

describe('handoff inbox items', () => {
  it('turns each waiting tab into one blocking item about its page', () => {
    expect(HandoffAttention.draftsOf(parse('status-handoff.json'))).toEqual([
      {
        dedupeKey: 'tab:7:2026-11-24T15:30:02.000Z',
        subject: { kind: 'url', id: 'https://github.com/login', label: 'Sign in to GitHub' },
        reason: 'A browser tab waits for you: Sign in to GitHub, then click Continue.',
        detail:
          'Tab 7 (https://github.com/login) shows a card with this message. Do it in the browser, then click Continue on that card or the browse toolbar button; the agent resumes by itself.',
        severity: 'blocking',
        verbs: ['Done', 'Snooze', 'MuteSource'],
      },
    ])
    expect(HandoffAttention.draftsOf(parse('status-running.json'))).toEqual([])
  })
})

describe('browse pair output', () => {
  it('reads the code, the instructions and the paired browser', () => {
    expect(BrowseOutput.parsePairingCode('Pairing code: K7QD-M2XP')).toEqual(Option.some('K7QD-M2XP'))
    expect(BrowseOutput.parsePairingCode('Waiting up to 600s for that browser.')).toEqual(Option.none())
    expect(
      Option.isSome(
        BrowseOutput.parsePairingInstructions(
          'Open the Extensions menu → browse → Options, expand advanced (or click Pair with a code), enter K7QD-M2XP as the pairing code, then click Connect. It works once, within 10 minutes.',
        ),
      ),
    ).toBe(true)
    expect(BrowseOutput.parsePairedLine('✓ Paired Brave on Clements-MacBook-Pro.')).toEqual(Option.some('Brave on Clements-MacBook-Pro'))
  })

  it('lists paired browsers from browse pair --list', () => {
    expect(BrowseOutput.parsePairList(fixture('pair-list.txt'))).toEqual({
      browsers: [
        {
          id: 'brave-clements-macbook-pro',
          name: 'Brave on Clements-MacBook-Pro',
          profile: '11111111-2222-3333-4444-555555555555',
          paired: '14 days ago',
          lastSeen: '12 min ago',
        },
      ],
      legacyCode: false,
    })
    expect(BrowseOutput.parsePairList('No paired browsers. Run `browse pair` for a code.\n')).toEqual({ browsers: [], legacyCode: false })
    expect(
      BrowseOutput.parsePairList(
        '(not connected yet)\n  profile    abc\n  paired     just now\n  last seen  never\n\nThe shared pairing code of an earlier version is still accepted.\n',
      ),
    ).toEqual({ browsers: [{ id: null, name: null, profile: 'abc', paired: 'just now', lastSeen: 'never' }], legacyCode: true })
  })
})
