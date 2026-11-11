import type { InputActions, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { THREAD_MENTION_TARGET_ATTRIBUTE } from '@dshfiles/thread-sidebar/thread-mention'
import { useEffect, useRef } from 'react'

import { BacklogMentionDrag } from './backlog-mention-drag.js'

/**
 * Mounted in each thread composer: a backlog item dropped on this composer's seat becomes the `@b:` chip at the caret.
 * The seat check keeps a drop on an aside's composer from also reaching the main one.
 */
export const BacklogMentionDropInput = (props: {
  readonly inputActions: Pick<InputActions, 'captureInsertion'>
  readonly input: Pick<SessionInput, 'insertReference' | 'focus'> | undefined
}): JSX.Element => {
  const marker = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const input = props.input
    if (input === undefined) return
    let targetSeat: HTMLElement | null = null
    const clear = (): void => {
      targetSeat?.removeAttribute(THREAD_MENTION_TARGET_ATTRIBUTE)
      targetSeat = null
    }
    const ownSeat = (event: Event): HTMLElement | null => {
      const seat = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-composer-seat]') : null
      return seat !== null && marker.current?.closest('[data-composer-seat]') === seat ? seat : null
    }
    const onDragOver = (event: DragEvent): void => {
      if (!BacklogMentionDrag.has(event.dataTransfer)) return
      const seat = ownSeat(event)
      if (seat === null) {
        clear()
        return
      }
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
      if (targetSeat === seat) return
      clear()
      targetSeat = seat
      seat.setAttribute(THREAD_MENTION_TARGET_ATTRIBUTE, '')
    }
    const onDragLeave = (event: DragEvent): void => {
      if (targetSeat === null || !BacklogMentionDrag.has(event.dataTransfer)) return
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
      if (next === null || !targetSeat.contains(next)) clear()
    }
    const onDrop = (event: DragEvent): void => {
      if (!BacklogMentionDrag.has(event.dataTransfer) || ownSeat(event) === null) return
      event.preventDefault()
      event.stopPropagation()
      clear()
      const reference = BacklogMentionDrag.read(event.dataTransfer)
      if (reference === null) return
      if (input.insertReference(reference, props.inputActions.captureInsertion())) input.focus()
    }
    window.addEventListener('dragend', clear, true)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('dragleave', onDragLeave, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragend', clear, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('dragleave', onDragLeave, true)
      document.removeEventListener('drop', onDrop, true)
      clear()
    }
  }, [props.input, props.inputActions])

  return <span ref={marker} hidden data-backlog-mention-input="" />
}
