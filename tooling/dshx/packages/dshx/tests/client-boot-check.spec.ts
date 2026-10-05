import { describe, expect, it } from 'vitest'
import { compositionFailures, parseBootText } from '../src/project/client-boot-check.js'
import { slotRenderFailures } from '../src/project/browser-boot.js'

/**
 * The boot card is the only surface that records why a client entry did not
 * activate, so the parser is what turns a browser run into an actionable
 * diagnostic. These texts are copied from the card the Web UI actually renders.
 */
describe('client boot card parsing', () => {
  it('reads the entries the card lists after the summary line', () => {
    const text = [
      'Failed to load plugins',
      '@deepseek-ai/dsh-client-ui-conversation',
      'web boot: 8 entries did not activate',
      '@deepseek-ai/dsh-client-ui-conversation: failed',
      '@deepseek-ai/dsh-client-ui-chat: pending (waiting for service: uiConversation)',
      '@deepseek-ai/dsh-client-ui-goal: pending (waiting for service: uiConversation)',
    ].join('\n')
    expect(parseBootText(text)).toEqual([
      { id: '@deepseek-ai/dsh-client-ui-conversation', state: 'failed' },
      { id: '@deepseek-ai/dsh-client-ui-chat', state: 'pending', detail: '(waiting for service: uiConversation)' },
      { id: '@deepseek-ai/dsh-client-ui-goal', state: 'pending', detail: '(waiting for service: uiConversation)' },
    ])
  })

  it('keeps an import failure detail attached to its entry', () => {
    const text = [
      '@dshfiles/queue-reorder: failed: import failed: client-modules: "@dshfiles/queue-reorder" not loaded because dependency "@deepseek-ai/dsh-client-connection" failed',
    ].join('\n')
    expect(parseBootText(text)).toEqual([
      {
        id: '@dshfiles/queue-reorder',
        state: 'failed',
        detail: 'import failed: client-modules: "@dshfiles/queue-reorder" not loaded because dependency "@deepseek-ai/dsh-client-connection" failed',
      },
    ])
  })

  it('returns nothing for a card that lists only the failed entries', () => {
    const text = [
      'Failed to load plugins',
      '@deepseek-ai/dsh-client-hmr',
      '@deepseek-ai/dsh-client-ui-conversation',
      'web boot: 2 entries did not activate',
    ].join('\n')
    expect(parseBootText(text)).toEqual([])
  })

  it('returns nothing for empty text', () => {
    expect(parseBootText('')).toEqual([])
  })

  it('ignores lines that are not entry states', () => {
    const text = ['Booting DSH', 'ready', 'some: thing'].join('\n')
    expect(parseBootText(text)).toEqual([])
  })
})

/**
 * A Slot that throws while rendering is invisible to the boot audit: its fiber
 * already reached active, so only the renderer's error boundary records it. That
 * is how a sidebar once rendered as <div data-slot-error="sidebar"> with a clean
 * audit and every other check green.
 */
describe('slot render failures', () => {
  it('reports nothing when every Slot rendered its entry', () => {
    expect(slotRenderFailures([])).toEqual([])
  })

  it('reports the Slot named by the boundary marker', () => {
    expect(slotRenderFailures(['sidebar'])).toEqual([{ slot: 'sidebar' }])
  })

  it('reports every failing Slot, not just the first', () => {
    expect(slotRenderFailures(['sidebar', 'conversation.input.overlay'])).toEqual([{ slot: 'sidebar' }, { slot: 'conversation.input.overlay' }])
  })

  it('ignores a marker with no Slot name', () => {
    expect(slotRenderFailures([null, 'sidebar', ''])).toEqual([{ slot: 'sidebar' }])
  })
})

describe('offline composition gate', () => {
  it('names every expected bundle the dump-config document does not compose', () => {
    const dump = ['# == @deepseek-ai/dsh-base', '- id: dshfiles-shortcuts', '  name: "@dshfiles/shortcuts"', '# == @deepseek-ai/dsh-web-app'].join('\n')
    expect(compositionFailures(dump, ['@dshfiles/shortcuts'])).toEqual([])
    expect(compositionFailures(dump, ['@dshfiles/shortcuts', '@dshfiles/ai-accounts'])).toEqual(['@dshfiles/ai-accounts'])
  })
})
