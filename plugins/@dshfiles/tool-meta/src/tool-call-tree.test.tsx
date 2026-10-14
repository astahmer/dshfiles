import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installToolCallTreeWrapper, isToolCallTreeWrapped, type ToolMetaComponent } from './tool-call-tree.js'

afterEach(cleanup)

interface Call {
  readonly callId: string
  readonly subCalls?: readonly Call[]
}

interface FakeTreeProps {
  readonly renderSlot: (key: 'tool.call.toolview', owner: Pick<ToolCallOwnerProps, 'callId'>) => ReactNode
  readonly root?: Call
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
