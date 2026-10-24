import { describe, expect, it } from 'vitest'

import { composerLinkLabel } from './composer-link-label.js'

describe('backlog composer link labels', () => {
  it('shows the session title for a selected thread reference', () => {
    expect(composerLinkLabel({ type: 'thread', target: 'session-42' }, [{ id: 'session-42', title: 'Fix project picker' }])).toBe('Fix project picker')
  })

  it('keeps a session id when its title is not available', () => {
    expect(composerLinkLabel({ type: 'thread', target: 'session-42' }, [])).toBe('session-42')
  })

  it('keeps backlog item references labeled by item id', () => {
    expect(composerLinkLabel({ type: 'item', target: '42' }, [])).toBe('b:42')
  })

  it('shows the project folder for an encoded workspace reference', () => {
    expect(composerLinkLabel({ type: 'workspace', target: '%2FUsers%2Fme%2Fdev%2Fbb-plugins' }, [])).toBe('bb-plugins')
  })
})
