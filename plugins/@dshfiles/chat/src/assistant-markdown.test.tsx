// @vitest-environment jsdom
import { MarkdownLinks } from '@dshfiles/dshx/client'
import { cleanup, render } from '@testing-library/react'
import { memo } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMarkdownProps } from './native/chat/AssistantMarkdown.tsx'
import { AssistantMarkdown } from './native/chat/AssistantMarkdown.tsx'

// Native primitives eagerly import an unavailable simple-icons peer in this fixture.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const MarkdownText = memo((props: { readonly text: string }) => <p>{props.text}</p>)
  const named: Record<string, unknown> = { MarkdownText, useMarkdownDelegate: () => ({}) }
  return new Proxy(
    named,
    {
      has: () => true,
      get: (target, key) => (typeof key === 'string' && key in target ? target[key] : typeof key === 'string' && /^[A-Z]/u.test(key) ? () => null : undefined),
    },
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const props = (blocks: AssistantMarkdownProps['blocks']): AssistantMarkdownProps => ({
  blocks,
  reasoningTimings: [],
  streaming: true,
  useDisclosure: () => ({ expanded: false, setExpanded: () => {}, toggle: () => {} }),
  useGroupAction: () => ({ current: null }),
  usePresentation: () => {
    throw new Error('Text blocks never read the reasoning presentation')
  },
  renderSlot: () => null,
  loadImage: async () => '',
  t: key => key,
})

describe('AssistantMarkdown', () => {
  it('rewrites links only for text blocks that changed since the last chunk', () => {
    const rewrite = vi.spyOn(MarkdownLinks, 'rewrite')
    const frozen = { kind: 'text', text: 'first paragraph' } as const
    const view = render(<AssistantMarkdown {...props([frozen, { kind: 'text', text: 'grow' }])} />)
    expect(rewrite).toHaveBeenCalledTimes(2)
    rewrite.mockClear()
    view.rerender(<AssistantMarkdown {...props([frozen, { kind: 'text', text: 'growing' }])} />)
    expect(rewrite).toHaveBeenCalledTimes(1)
    expect(rewrite).toHaveBeenCalledWith('growing', [])
  })
})
