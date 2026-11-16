import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANCHORED_ATTRIBUTE,
  installToolCallTreeWrapper,
  isToolCallTreeWrapped,
  RESERVE_PROPERTY,
  RESERVED_ROW_ATTRIBUTE,
  type ToolMetaComponent,
} from './tool-call-tree.js'

afterEach(cleanup)

interface Call {
  readonly callId: string
  readonly subCalls?: readonly Call[]
}

interface FakeTreeProps {
  readonly renderSlot: (key: 'tool.call.toolview', owner: Pick<ToolCallOwnerProps, 'callId'>) => ReactNode
  readonly root?: Call
  readonly sessionId?: string
}

/** Stands in for the native tree: every call, nested ones included, goes through renderSlot('tool.call.toolview'). */
const NativeTree = (props: FakeTreeProps) => {
  const branch = (call: Call): ReactNode => (
    <div key={call.callId} data-chat-call-id={call.callId}>
      {props.renderSlot('tool.call.toolview', { callId: call.callId })}
      {call.subCalls?.map(branch)}
    </div>
  )
  return props.root === undefined ? null : <>{branch(props.root)}</>
}
const SilentTree = (_props: FakeTreeProps) => <div>no dispatch</div>

const nativeRenderSlot: FakeTreeProps['renderSlot'] = (_key, owner) => <span>card {owner.callId}</span>
const Meta: ToolMetaComponent = ({ owner }) => <span role="note">meta {owner.callId}</span>

const ledger = (entries: StoredEntry[]) => {
  const listeners = new Set<() => void>()
  return {
    entries,
    entriesOfSlot: () => entries,
    subscribe: (_key: string, listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify: () => {
      for (const listener of listeners) listener()
    },
  }
}

const toolCallEntry = (component: ComponentType<FakeTreeProps>): StoredEntry => ({ component, options: { key: 'tool-call' } })

/** The fake tree speaks a subset of ToolTreeProps; the wrapper only forwards and frames renderSlot. */
const renderWrapped = (entry: StoredEntry, props: FakeTreeProps): void => {
  // SAFETY: installToolCallTreeWrapper stored its wrapper component in the entry; the fake props cover what it reads.
  const Wrapped = entry.component as ComponentType<FakeTreeProps>
  render(<Wrapped {...props} />)
}

describe('installToolCallTreeWrapper', () => {
  it('renders contributed sections under each card, nested calls included', () => {
    const entry = toolCallEntry(NativeTree)
    const Sections = ({ owner, sessionId }: { readonly owner: Pick<ToolCallOwnerProps, 'callId'>; readonly sessionId: string }) => (
      <span role="status">
        {sessionId} section {owner.callId}
      </span>
    )
    const dispose = installToolCallTreeWrapper({ slots: ledger([entry]), Meta, Sections })
    renderWrapped(entry, { sessionId: 'thread-1', renderSlot: nativeRenderSlot, root: { callId: 'parent', subCalls: [{ callId: 'child' }] } })
    expect(screen.getAllByRole('status').map(section => section.textContent)).toEqual(['thread-1 section parent', 'thread-1 section child'])
    dispose()
  })

  it('adds a meta line under every dispatched tool card, nested calls included', () => {
    const entry = toolCallEntry(NativeTree)
    installToolCallTreeWrapper({ slots: ledger([entry]), Meta })
    renderWrapped(entry, { renderSlot: nativeRenderSlot, root: { callId: 'root', subCalls: [{ callId: 'child' }] } })
    expect(screen.getByText('card root')).toBeTruthy()
    expect(screen.getAllByRole('note').map(note => note.textContent)).toEqual(['meta root', 'meta child'])
  })

  it('wraps a renderer registered later and puts every original back on dispose', () => {
    const slots = ledger([])
    const dispose = installToolCallTreeWrapper({ slots, Meta })
    expect(isToolCallTreeWrapped(slots)).toBe(false)
    const entry = toolCallEntry(NativeTree)
    slots.entries.push(entry)
    slots.notify()
    expect(isToolCallTreeWrapped(slots)).toBe(true)
    const wrapped = entry.component
    slots.notify()
    expect(entry.component).toBe(wrapped)
    dispose()
    expect(entry.component).toBe(NativeTree)
  })

  describe('reserving the label width in the card header', () => {
    /** The label width the layout reports; 0 stands for a label the narrow tier hides. */
    let labelWidth = 0
    beforeEach(() => {
      labelWidth = 92.4
      // jsdom has no layout: the label reports `labelWidth`, and the observer reports once on observe like a real one.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const width = this.hasAttribute('data-dshfiles-tool-meta-label') ? labelWidth : 0
        return { width, height: 28, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 28, toJSON: () => ({}) }
      })
      vi.stubGlobal(
        'ResizeObserver',
        class implements ResizeObserver {
          constructor(private readonly onResize: ResizeObserverCallback) {}
          observe(target: Element): void {
            // SAFETY: the frame's callback reads only `target` from an entry.
            this.onResize([{ target } as ResizeObserverEntry], this)
          }
          unobserve(): void {}
          disconnect(): void {}
        },
      )
    })
    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    interface NestingOwner {
      readonly callId: string
      readonly nested?: () => ReactNode
    }
    /** The real tree renders a child call inside its parent card's body, through the same renderSlot. */
    const NestingTree = (props: { readonly renderSlot: (key: 'tool.call.toolview', owner: NestingOwner) => ReactNode }) =>
      props.renderSlot('tool.call.toolview', { callId: 'parent', nested: () => props.renderSlot('tool.call.toolview', { callId: 'child' }) })
    /** A native disclosure card: header > expandable row, then a body holding its own disclosure and any nested call. */
    const disclosureCard = (_key: 'tool.call.toolview', owner: NestingOwner): ReactNode => (
      <div data-slot="tool.call.toolview" style={{ display: 'contents' }}>
        <div data-testid={`card-${owner.callId}`}>
          <div data-disclosure-header="" data-testid={`header-${owner.callId}`}>
            <div data-disclosure-row="" data-expandable="" role="button">
              read · Showing 2 lines
            </div>
          </div>
          <div>
            <div data-disclosure-header="" data-testid={`body-${owner.callId}`}>
              <div data-disclosure-row="" data-expandable="" role="button">
                hunk
              </div>
            </div>
            {owner.nested?.()}
          </div>
        </div>
      </div>
    )
    const renderNesting = (): void => {
      const entry: StoredEntry = { component: NestingTree, options: { key: 'tool-call' } }
      installToolCallTreeWrapper({ slots: ledger([entry]), Meta })
      // SAFETY: the wrapper stored its component in the entry; NestingTree reads only renderSlot.
      const Wrapped = entry.component as ComponentType<{ readonly renderSlot: typeof disclosureCard }>
      render(<Wrapped renderSlot={disclosureCard} />)
    }

    it("pads each card's own header by its label width, never a row deeper in the body", () => {
      renderNesting()
      expect(screen.getByTestId('header-parent').hasAttribute(RESERVED_ROW_ATTRIBUTE)).toBe(true)
      expect(screen.getByTestId('header-child').hasAttribute(RESERVED_ROW_ATTRIBUTE)).toBe(true)
      expect(screen.getByTestId('body-parent').hasAttribute(RESERVED_ROW_ATTRIBUTE)).toBe(false)
      expect(screen.getByTestId('body-child').hasAttribute(RESERVED_ROW_ATTRIBUTE)).toBe(false)
      const frames = document.querySelectorAll<HTMLElement>('[data-dshfiles-tool-meta-frame]')
      expect([...frames].map(frame => frame.style.getPropertyValue(RESERVE_PROPERTY))).toEqual(['93px', '93px'])
      expect(frames[0]?.className).toContain('dshx:[&_[data-dshfiles-tool-meta-row]]:pe-[calc(var(--dshfiles-tool-meta-reserve)+0.25rem)]!')
    })

    it('reserves nothing while the label is hidden', () => {
      labelWidth = 0
      renderNesting()
      expect(document.querySelectorAll(`[${RESERVED_ROW_ATTRIBUTE}]`)).toHaveLength(0)
    })

    const renderCard = (card: ReactNode): HTMLElement => {
      const entry: StoredEntry = { component: NestingTree, options: { key: 'tool-call' } }
      installToolCallTreeWrapper({ slots: ledger([entry]), Meta })
      // SAFETY: the wrapper stored its component in the entry; NestingTree reads only renderSlot.
      const Wrapped = entry.component as ComponentType<{ readonly renderSlot: () => ReactNode }>
      render(<Wrapped renderSlot={() => card} />)
      const label = document.querySelector<HTMLElement>('[data-dshfiles-tool-meta-label]')
      if (label === null) throw new Error('no timing label rendered')
      return label
    }

    it('shows the label only over a row that makes room for it', () => {
      renderNesting()
      const labels = [...document.querySelectorAll<HTMLElement>('[data-dshfiles-tool-meta-label]')]
      expect(labels.map(label => label.hasAttribute(ANCHORED_ATTRIBUTE))).toEqual([true, true])
      // Hidden until anchored: the class pair is what keeps an unanchored label off a card's own header.
      expect(labels[0]?.className).toContain('dshx:invisible')
      expect(labels[0]?.className).toContain('dshx:data-[dshfiles-tool-meta-anchored]:visible')
    })

    it('keeps the label hidden on a card that draws its own header', () => {
      const label = renderCard(
        <section>
          <header>
            Sales dashboard <button type="button">Copy HTML</button>
          </header>
        </section>,
      )
      expect(label.hasAttribute(ANCHORED_ATTRIBUTE)).toBe(false)
      expect(document.querySelectorAll(`[${RESERVED_ROW_ATTRIBUTE}]`)).toHaveLength(0)
    })

    it('keeps the label hidden on a card that prints its own duration', () => {
      const label = renderCard(
        <div data-tool-card-timing="own">
          <div data-disclosure-row="" data-expandable="" role="button">
            Ran tests · 1.2s
          </div>
        </div>,
      )
      expect(label.hasAttribute(ANCHORED_ATTRIBUTE)).toBe(false)
      expect(document.querySelectorAll(`[${RESERVED_ROW_ATTRIBUTE}]`)).toHaveLength(0)
    })
  })

  it('warns once when the renderer stops dispatching through renderSlot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entry = toolCallEntry(SilentTree)
    installToolCallTreeWrapper({ slots: ledger([entry]), Meta })
    renderWrapped(entry, { renderSlot: nativeRenderSlot })
    renderWrapped(entry, { renderSlot: nativeRenderSlot })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/without dispatching tool\.call\.toolview/)
    warn.mockRestore()
  })
})
