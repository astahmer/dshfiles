// @vitest-environment jsdom
import type { ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { THREAD_MENTION_TARGET_ATTRIBUTE } from '@dshfiles/thread-sidebar/thread-mention'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test, vi } from 'vitest'

import { BacklogMentionDrag } from './backlog-mention-drag.js'
import { BacklogMentionDropInput } from './backlog-mention-drop.js'
import { BacklogMentionHandle } from './backlog-mention-handle.js'
import { BacklogMentions } from './backlog-mentions.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const transfer = (write: (sink: { effectAllowed: string; setData: (type: string, value: string) => void }) => void) => {
  const types: string[] = []
  const values = new Map<string, string>()
  const sink = {
    effectAllowed: 'none',
    setData: (type: string, value: string) => {
      types.push(type)
      values.set(type, value)
    },
  }
  write(sink)
  return { types, effectAllowed: sink.effectAllowed, dropEffect: 'none', getData: (type: string) => values.get(type) ?? '' }
}

const itemTransfer = () => transfer(sink => BacklogMentionDrag.write(sink, { id: 7, ref: 'k3f9', title: 'Drag mentions' }))

const dragEvent = (type: string, dataTransfer: ReturnType<typeof transfer>): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

describe('backlog mention drag payload', () => {
  test('writes the plain ref for any text field and the chip payload for a composer', () => {
    const dataTransfer = itemTransfer()
    expect(dataTransfer.types).toEqual([BacklogMentionDrag.MIME, 'text/plain'])
    expect(dataTransfer.getData('text/plain')).toBe('b:k3f9')
    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(BacklogMentionDrag.read(dataTransfer)).toEqual(BacklogMentions.referenceInsert({ ref: 'k3f9', title: 'Drag mentions' }))
  })

  test('a legacy item drags its number', () => {
    const dataTransfer = transfer(sink => BacklogMentionDrag.write(sink, { id: 12, title: 'Old item' }))
    expect(dataTransfer.getData('text/plain')).toBe('b:12')
    expect(BacklogMentionDrag.read(dataTransfer)?.label).toBe('b:12 Old item')
  })

  test('ignores foreign and malformed drags', () => {
    expect(BacklogMentionDrag.has(transfer(sink => sink.setData('text/plain', 'b:k3f9')))).toBe(false)
    expect(BacklogMentionDrag.read(transfer(sink => sink.setData('text/plain', 'b:k3f9')))).toBeNull()
    expect(BacklogMentionDrag.read(transfer(sink => sink.setData(BacklogMentionDrag.MIME, 'not json')))).toBeNull()
    expect(BacklogMentionDrag.read(transfer(sink => sink.setData(BacklogMentionDrag.MIME, JSON.stringify({ ref: 'todo', title: 'x' }))))).toBeNull()
    expect(BacklogMentionDrag.read(null)).toBeNull()
  })
})

describe('backlog mention handle', () => {
  test('every list label drags the item as a mention', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<BacklogMentionHandle item={{ id: 7, ref: 'k3f9', title: 'Drag mentions' }} />))
      const handle = container.querySelector('[data-backlog-mention-handle]')
      expect(handle?.getAttribute('draggable')).toBe('true')
      expect(handle?.textContent).toBe('b:k3f9')
      const dataTransfer = transfer(() => undefined)
      const values = new Map<string, string>()
      const sink = { ...dataTransfer, setData: (type: string, value: string) => values.set(type, value) }
      handle?.dispatchEvent(dragEvent('dragstart', sink))
      expect(values.get('text/plain')).toBe('b:k3f9')
      expect(BacklogMentions.decodeRef(values.get(BacklogMentionDrag.MIME) ?? '')).toEqual({ ref: 'k3f9', title: 'Drag mentions' })
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

describe('backlog mention drops on a composer', () => {
  const mount = async () => {
    const inserted: { reference: ReferenceInsert; span: TokenSpan }[] = []
    let focused = 0
    const span: TokenSpan = { start: 3, end: 3, draftRev: 9 }
    const seat = document.createElement('div')
    seat.setAttribute('data-composer-seat', '')
    const editor = document.createElement('div')
    const other = document.createElement('div')
    other.setAttribute('data-composer-seat', '')
    const host = document.createElement('div')
    seat.append(editor, host)
    document.body.append(seat, other)
    const input = {
      insertReference: (reference: ReferenceInsert, at: TokenSpan) => {
        inserted.push({ reference, span: at })
        return true
      },
      focus: () => {
        focused += 1
      },
    }
    const root = createRoot(host)
    await act(async () => root.render(<BacklogMentionDropInput inputActions={{ captureInsertion: () => span }} input={input} />))
    return {
      seat,
      editor,
      other,
      inserted,
      span,
      focused: () => focused,
      unmount: async () => {
        await act(async () => root.unmount())
        seat.remove()
        other.remove()
      },
    }
  }

  test('a dropped item becomes the mention chip at the caret', async () => {
    const view = await mount()
    try {
      const over = dragEvent('dragover', itemTransfer())
      view.editor.dispatchEvent(over)
      expect(over.defaultPrevented).toBe(true)
      expect(view.seat.hasAttribute(THREAD_MENTION_TARGET_ATTRIBUTE)).toBe(true)
      const drop = dragEvent('drop', itemTransfer())
      view.editor.dispatchEvent(drop)
      expect(drop.defaultPrevented).toBe(true)
      expect(view.inserted).toEqual([{ reference: BacklogMentions.referenceInsert({ ref: 'k3f9', title: 'Drag mentions' }), span: view.span }])
      expect(view.focused()).toBe(1)
      expect(view.seat.hasAttribute(THREAD_MENTION_TARGET_ATTRIBUTE)).toBe(false)
    } finally {
      await view.unmount()
    }
  })

  test('leaves file drops, plain text and other composers alone', async () => {
    const view = await mount()
    try {
      const files = dragEvent(
        'drop',
        transfer(sink => sink.setData('Files', '')),
      )
      view.editor.dispatchEvent(files)
      const text = dragEvent(
        'drop',
        transfer(sink => sink.setData('text/plain', 'b:k3f9')),
      )
      view.editor.dispatchEvent(text)
      const elsewhere = dragEvent('drop', itemTransfer())
      view.other.dispatchEvent(elsewhere)
      expect([files.defaultPrevented, text.defaultPrevented, elsewhere.defaultPrevented]).toEqual([false, false, false])
      expect(view.inserted).toEqual([])
    } finally {
      await view.unmount()
    }
  })
})
