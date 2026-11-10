import { describe, expect, test } from 'vitest'
import { CheckoutSyncView } from './checkout-sync-view.js'

describe('checkout sync view', () => {
  test('recent checkouts lead the suggestions, without repeats', () => {
    const recent = CheckoutSyncView.rememberCheckout({ recent: { box: ['/a', '/b'] }, sshTarget: 'box', path: '/b' })
    expect(recent.box).toEqual(['/b', '/a'])
    expect(CheckoutSyncView.suggestedCheckouts({ recent: recent.box ?? [], threadFolders: ['/a', '/c'] })).toEqual(['/b', '/a', '/c'])
  })

  test('remembers each host apart and keeps the list short', () => {
    const recent = CheckoutSyncView.rememberCheckout({ recent: { box: ['/1', '/2', '/3', '/4', '/5', '/6'], other: ['/x'] }, sshTarget: 'box', path: '/7' })
    expect(recent.box).toHaveLength(6)
    expect(recent.box?.[0]).toBe('/7')
    expect(recent.other).toEqual(['/x'])
  })

  test('a failure and an older Host answer read as a message, never as a report', () => {
    expect(CheckoutSyncView.reportOf(undefined)).toEqual({ report: undefined, problem: undefined })
    expect(CheckoutSyncView.reportOf({ ok: false, code: 'ssh-unreachable', message: 'The host did not answer.' })).toEqual({
      report: undefined,
      problem: 'The host did not answer.',
    })
    // @ts-expect-error The shape a Host from before this version still answers with.
    expect(CheckoutSyncView.reportOf({ ok: true, applied: false, detail: 'would fetch', plan: {}, stdout: '', stderr: '' }).problem).toContain('Restart')
  })
})
