// @vitest-environment jsdom
import { SlotCore, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ConversationHeaderSurface, registerConversationHeaderSurface } from './conversation-header.js'
import { ConversationHeader } from './native/skeleton/ConversationHeader.tsx'

const Empty = () => null
const Main = (_props: PropsRenderSlots<'main.conversation'>) => null
const DuplicateHeader = (_props: PropsRenderSlots<'conversation.header'>) => null

describe('producer-owned reusable conversation header', () => {
  it('declares the original header once through the real public SlotCore', () => {
    const slots = new SlotCore()
    slots.register({ name: 'root', children: { 'main.conversation': { kind: 'single', scope: 'session-maybe' } } }, Main)
    // The native main entry no longer claims the header; both callers use the Factory.
    slots.register({ name: 'main.conversation' }, Empty)
    const release = registerConversationHeaderSurface(slots)
    slots.register(
      {
        name: 'conversation.header',
        children: {
          'conversation.header.leading': { kind: 'single', scope: 'root' },
          'conversation.session.header': { kind: 'single', scope: 'session' },
        },
      },
      ConversationHeader,
    )
    expect(slots.snapshot('factory:dshfiles.workbench.conversation-header')).toMatchObject([
      {
        type: 'factory',
        scope: 'session-maybe',
        children: [
          {
            name: 'conversation.header',
            scope: 'session-maybe',
            children: [
              { name: 'conversation.header.leading', scope: 'root' },
              { name: 'conversation.session.header', scope: 'session' },
            ],
          },
        ],
      },
    ])
    expect(() =>
      slots.register(
        {
          name: 'main.conversation',
          priority: -1,
          children: { 'conversation.header': { kind: 'single', scope: 'session-maybe' } },
        },
        DuplicateHeader,
      ),
    ).toThrow(/already declared/iu)
    release()
    expect(slots.specDynamic('conversation.header')).toBeUndefined()
    expect(slots.specDynamic('conversation.session.header')).toBeUndefined()
    expect(slots.factory('dshfiles.workbench.conversation-header')).toBeUndefined()
    expect(() => registerConversationHeaderSurface(slots)).not.toThrow()
  })

  it('reserves only the host recovery corner while keeping native callers and original header actions unchanged', async () => {
    const original = <button>Original thread actions</button>
    const renderSlot = vi.fn(() => original)
    expect(ConversationHeaderSurface({ renderSlot })).toBe(original)
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ConversationHeaderSurface renderSlot={renderSlot} reserveHostCorner />))
      expect(container.querySelector('button')?.textContent).toBe('Original thread actions')
      expect(container.firstElementChild?.className).toContain('dshx:pr-8')
      // Round five B8: the reserved wrapper draws the header's rule across the whole pane, so it no longer stops 32px
      // short of the right edge; the header inside draws none (ConversationRoot.module.css).
      expect(container.firstElementChild?.hasAttribute('data-conversation-header-reserved')).toBe(true)
      const { readFileSync } = await import('node:fs')
      const { dirname, resolve } = await import('node:path')
      const { fileURLToPath } = await import('node:url')
      const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/skeleton/ConversationRoot.module.css'), 'utf8')
      expect(css).toMatch(/:global\(\[data-conversation-header-reserved\]\) \.header \{\s*border-bottom: none;/u)
      // Only a header that draws a rule hands it over: the blank New thread header has none, and the phone shell hides
      // the header row, so neither gets one from the wrapper.
      expect(css).toMatch(
        /:global\(\[data-conversation-header-reserved\]\):has\(\.header:not\(\.headerBlank\)\) \{\s*border-bottom: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l3\)\);/u,
      )
      expect(css).toMatch(/:global\(html\[data-shell-phone-nav\]\) :global\(\[data-conversation-header-reserved\]\):has\(\.header\) \{\s*border-bottom: none;/u)
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('delegates only to its authorized original header, without selecting a Session', () => {
    const renderSlot = vi.fn(() => null)
    expect(ConversationHeaderSurface({ renderSlot })).toBeNull()
    expect(renderSlot).toHaveBeenCalledExactlyOnceWith('conversation.header', {})
  })
})
