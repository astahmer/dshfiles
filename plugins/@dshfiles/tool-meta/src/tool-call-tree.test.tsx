import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANCHORED_ATTRIBUTE,
  DISCLOSURE_ANCHOR_ATTRIBUTE,
  FIT_ATTRIBUTE,
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
      expect(frames[0]?.className).toContain('dshx:[&_[data-dshfiles-tool-meta-row]]:pe-[calc(var(--dshfiles-tool-meta-reserve)+0.5rem)]!')
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

    it('takes the 24 px height of a disclosure header, so the time sits on its centre line (council round 22, item 9)', () => {
      renderNesting()
      const labels = [...document.querySelectorAll<HTMLElement>('[data-dshfiles-tool-meta-label]')]
      // The 28 px box centred a 16 px time 2 px under a 24 px row.
      expect(labels.map(label => label.hasAttribute(DISCLOSURE_ANCHOR_ATTRIBUTE))).toEqual([true, true])
      expect(labels[0]?.className).toContain('dshx:h-7')
      expect(labels[0]?.className).toContain('dshx:data-[dshfiles-tool-meta-disclosure]:h-6')
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

    /** The bash and file rows' shape: a card holding one disclosure header, and nothing under it while collapsed. */
    const loneRow = (expanded: boolean): ReactNode => (
      <div data-slot="tool.call.toolview" style={{ display: 'contents' }}>
        <div>
          <div data-disclosure-header="">
            <div aria-expanded={expanded} data-disclosure-row="" data-expandable="" role="button">
              Bash · Wait three seconds
            </div>
          </div>
        </div>
      </div>
    )
    const frameOf = (label: HTMLElement): HTMLElement => {
      const frame = label.closest<HTMLElement>('[data-dshfiles-tool-meta-frame]')
      if (frame === null) throw new Error('the label has no frame')
      return frame
    }

    it('fits a lone collapsed row to its content, capped at the prose measure, so the timing follows its label', () => {
      const frame = frameOf(renderCard(loneRow(false)))
      expect(frame.hasAttribute(FIT_ATTRIBUTE)).toBe(true)
      expect(frame.className).toContain('dshx:data-[dshfiles-tool-meta-fit]:not-has-[[aria-expanded=true]]:w-fit')
      expect(frame.className).toContain(
        'dshx:data-[dshfiles-tool-meta-fit]:not-has-[[aria-expanded=true]]:max-w-[min(100%,var(--dsh-chat-prose-measure,100%))]',
      )
      // A size container takes no width from its content, so a fitted frame must not be one.
      expect(frame.className).toContain('dshx:data-[dshfiles-tool-meta-fit]:not-has-[[aria-expanded=true]]:[container-type:normal]')
      // The label hides in a narrow pane only on a full-width card: it asks for its own frame by name, which a fitted
      // frame no longer answers, so a fitted row keeps its duration beside its label in a split or on a phone.
      expect(frame.className).toContain('dshx:@container/tool-frame')
      expect(frame.querySelector('[data-dshfiles-tool-meta-label]')?.className).toContain('dshx:@max-pane-narrow/tool-frame:hidden')
    })

    it('keeps the message column for an expanded row, a card with a body and a card with its own header', () => {
      expect(frameOf(renderCard(loneRow(true))).hasAttribute(FIT_ATTRIBUTE)).toBe(false)
      cleanup()
      renderNesting()
      expect([...document.querySelectorAll('[data-dshfiles-tool-meta-frame]')].map(frame => frame.hasAttribute(FIT_ATTRIBUTE))).toEqual([false, false])
      cleanup()
      const page = renderCard(
        <section>
          <header>Sales dashboard</header>
          <div data-html-render-viewport="">page</div>
        </section>,
      )
      expect(frameOf(page).hasAttribute(FIT_ATTRIBUTE)).toBe(false)
    })

    it('keeps the message column for a card that prints its own duration or measures itself', () => {
      const ownTiming = renderCard(
        <div data-disclosure-header="">
          <div data-disclosure-row="" role="button">
            Ran tests · 2 passed <span data-tool-card-timing="own">3.1s</span>
          </div>
        </div>,
      )
      expect(frameOf(ownTiming).hasAttribute(FIT_ATTRIBUTE)).toBe(false)
      cleanup()
      // A size container's width cannot come from its content: fitted, it would draw at 0px.
      const container = renderCard(
        <div className="dshx:@container">
          <div data-disclosure-header="">
            <div data-disclosure-row="" role="button">
              Background job
            </div>
          </div>
        </div>,
      )
      expect(frameOf(container).hasAttribute(FIT_ATTRIBUTE)).toBe(false)
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
