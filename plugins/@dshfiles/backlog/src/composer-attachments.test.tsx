// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test, vi } from 'vitest'

import { ThreadMentionDrag } from '@dshfiles/thread-sidebar/thread-mention'

import { useFileDrop } from './composer-attachments.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const transfer = (sessionId: string) => {
  const types: string[] = []
  const values = new Map<string, string>()
  const drag = {
    effectAllowed: 'none',
    setData: (type: string, value: string) => {
      types.push(type)
      values.set(type, value)
    },
  }
  ThreadMentionDrag.write(drag, sessionId)
  return { types, getData: (type: string) => values.get(type) ?? '' }
}

const dragEvent = (type: string, dataTransfer: ReturnType<typeof transfer>): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

describe('backlog thread mention drops', () => {
  test('accepts a dragged session in the file-drop surface', async () => {
    const sessions: string[] = []
    const files: File[][] = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const Harness = (): JSX.Element => {
      const drop = useFileDrop({ onFiles: added => files.push([...added]), onThreadMention: sessionId => sessions.push(sessionId) })
      return <div {...drop.dragProps} data-dragging={drop.dragging} />
    }

    try {
      await act(async () => root.render(<Harness />))
      const surface = container.firstElementChild
      expect(surface).not.toBeNull()
      await act(async () => {
        surface?.dispatchEvent(dragEvent('dragover', transfer('session-42')))
        surface?.dispatchEvent(dragEvent('drop', transfer('session-42')))
      })
      expect(sessions).toEqual(['session-42'])
      expect(files).toEqual([])
      expect(surface?.getAttribute('data-dragging')).toBe('false')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
