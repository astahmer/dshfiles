import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GatewayUnreachable } from '../errors.js'
import { hostState } from './host-status.js'

describe('host row copy', () => {
  it('says a host cannot be reached in plain words, with a next step', () => {
    expect(new GatewayUnreachable({}).message).toBe("Can't reach this host. Check that DSH is running there, then reconnect.")
  })
  it('explains a host that was never set up without naming a runtime', () => {
    expect(hostState(undefined)).toEqual({ tone: 'error', label: 'Not set up yet. Edit this host to set its DSH home.' })
  })
  it('keeps "runtime" and "connector" out of what the Hosts page says', () => {
    const page = readFileSync(new URL('hosts-page.tsx', import.meta.url), 'utf8')
    for (const phrase of ['has no runtime', 'recorded connector', 'Resource data unavailable']) expect(page, phrase).not.toContain(phrase)
    expect(page).toContain('This host is not set up yet. Edit it to set its DSH home, then reconnect.')
  })
})
