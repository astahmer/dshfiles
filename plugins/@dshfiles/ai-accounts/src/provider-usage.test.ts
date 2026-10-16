import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudeAccountModel } from './claude-account.js'
import { parseCommandCodeUsage } from './commandcode-usage.js'
import { CursorAccountModel } from './cursor-account.js'
import { ProviderUsageModel } from './usage.js'

const noCredits = { available: 0, resets: [] }
const jwt = (payload: Record<string, unknown>): string => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`

describe('Codex usage', () => {
  it('labels windows by their span, so a weekly-only plan is not shown as a session', () => {
    const card = ProviderUsageModel.parseCodexUsage(
      { rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 604_800, reset_at: 1_900_000_000 } } },
      noCredits,
      0,
    )
    expect(card.windows).toEqual([{ label: 'Weekly limit', percentRemaining: 70, resetsAt: 1_900_000_000_000 }])
  })

  it('reads both windows, millisecond resets, relative resets and banked credits', () => {
    const card = ProviderUsageModel.parseCodexUsage(
      {
        plan_type: 'pro',
        rate_limit: {
          primary_window: { used_percent: 12.34, limit_window_seconds: 18_000, reset_after_seconds: 60 },
          secondary_window: { used_percent: 100, limit_window_seconds: 604_800, reset_at: 1_900_000_000_000 },
        },
      },
      { available: 2, resets: [{ expiresAt: 5 }, { expiresAt: undefined }] },
      1_000,
    )
    expect(card.plan).toBe('pro')
    expect(card.windows).toEqual([
      { label: 'Current session', percentRemaining: 87.7, resetsAt: 61_000 },
      { label: 'Weekly limit', percentRemaining: 0, resetsAt: 1_900_000_000_000 },
    ])
    expect(card.bankedResets).toBe(2)
    expect(card.bankedResetExpiries).toEqual([5, null])
  })
})

describe('OpenCode Go usage', () => {
  it('reports percent left, not the percent used the API returns', () => {
    const card = ProviderUsageModel.parseOpenCodeUsage({
      usage: {
        rolling: { status: 'ok', percent: 25, resetsAt: '2026-10-08T12:00:00.000Z' },
        weekly: { status: 'rate-limited', percent: 100 },
        monthly: { status: 'ok', percent: 0 },
      },
    })
    expect(card.windows.map(window => [window.label, window.percentRemaining])).toEqual([
      ['Current session', 75],
      ['Weekly limit', 0],
      ['Monthly limit', 100],
    ])
    expect(card.windows[0]?.resetsAt).toBe(Date.parse('2026-10-08T12:00:00.000Z'))
  })
})

describe('Claude usage', () => {
  it('maps utilization to percent left and drops unmetered windows', () => {
    const card = ClaudeAccountModel.parseClaudeUsage(
      {
        five_hour: { utilization: 31, resets_at: '2026-10-08T15:00:00Z' },
        seven_day: { utilization: 58.5, resets_at: null },
        seven_day_opus: null,
        seven_day_sonnet: { utilization: 2, resets_at: '2026-10-12T00:00:00Z' },
      },
      'max',
    )
    expect(card.plan).toBe('max')
    expect(card.windows).toEqual([
      { label: 'Current session', percentRemaining: 69, resetsAt: Date.parse('2026-10-08T15:00:00Z') },
      { label: 'Weekly limit', percentRemaining: 41.5, resetsAt: null },
      { label: 'Weekly Sonnet', percentRemaining: 98, resetsAt: Date.parse('2026-10-12T00:00:00Z') },
    ])
  })

  it('finds the login of a non-default config dir under its hashed keychain item', () => {
    expect(ClaudeAccountModel.resolveClaudeConfigDir('')).toBe(join(homedir(), '.claude'))
    expect(ClaudeAccountModel.claudeKeychainService(ClaudeAccountModel.resolveClaudeConfigDir('~/.claude'))).toBe('Claude Code-credentials')
    expect(ClaudeAccountModel.claudeKeychainService(ClaudeAccountModel.resolveClaudeConfigDir('~/.claude-work'))).toMatch(
      /^Claude Code-credentials-[0-9a-f]{8}$/,
    )
  })
})

describe('Command Code usage', () => {
  it('reads the five-hour and weekly windows as used/cap with millisecond resets', () => {
    const card = parseCommandCodeUsage({
      credits: {
        windowLimits: { fiveHour: { used: 0.75, cap: 3, resetAt: 1_900_000_000_000 }, weekly: { used: 10, cap: 10, exceeded: true, resetAt: 0 } },
        credits: { planId: 'go' },
      },
      whoami: { user: { userName: 'alex' } },
      subscription: undefined,
    })
    expect(card.status).toBe('ok')
    expect(card.identity).toBe('alex')
    expect(card.plan).toBe('go')
    expect(card.windows).toEqual([
      { label: 'Current session', percentRemaining: 75, resetsAt: 1_900_000_000_000 },
      { label: 'Weekly limit', percentRemaining: 0, resetsAt: null },
    ])
  })

  it('says when a plan reports no window limits instead of inventing one', () => {
    const card = parseCommandCodeUsage({ credits: { credits: { planId: 'payg' } }, whoami: undefined, subscription: { data: { planId: 'payg' } } })
    expect(card.status).toBe('unsupported')
    expect(card.windows).toEqual([])
  })
})

describe('Cursor usage', () => {
  it('builds the dashboard cookie from the token subject', () => {
    const token = jwt({ sub: 'auth0|user_123' })
    expect(CursorAccountModel.cursorSessionCookie(token)).toBe(`WorkosCursorSessionToken=${encodeURIComponent(`user_123::${token}`)}`)
    expect(CursorAccountModel.cursorSessionCookie('not-a-jwt')).toBeUndefined()
  })

  it('reads included usage for the billing cycle, and reports an unknown shape as unsupported', () => {
    const card = CursorAccountModel.parseCursorUsage({
      billingCycleEnd: '2026-11-01T00:00:00Z',
      membershipType: 'pro',
      individualUsage: { plan: { used: 500, limit: 2000 } },
    })
    expect(card.windows).toEqual([{ label: 'Monthly limit', percentRemaining: 75, resetsAt: Date.parse('2026-11-01T00:00:00Z') }])
    expect(CursorAccountModel.parseCursorUsage({ individualUsage: { plan: {} } }).status).toBe('unsupported')
    expect(CursorAccountModel.parseCursorUsage('nope').status).toBe('unsupported')
  })
})
