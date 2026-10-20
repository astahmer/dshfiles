import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils.js'
import { Input } from './input.js'

/** Props of one click-to-edit title input. */
export interface InlineTitleEditorProps {
  readonly value: string
  readonly label: string
  readonly className?: string
  readonly maxLength?: number
  readonly onCommit: (title: string) => void
  readonly onCancel: () => void
}

/**
 * Edits one short title in place: Enter or blur commits, Escape cancels, and
 * an unchanged or blank draft cancels without a Host round-trip.
 * @param props - Current title, accessible name, and the commit/cancel sinks.
 * @returns The focused title input.
 */
export const InlineTitleEditor = ({ value, label, className, maxLength = 200, onCommit, onCancel }: InlineTitleEditorProps): JSX.Element => {
  const [draft, setDraft] = useState(value)
  const settled = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const focusGuardUntil = useRef(0)
  useEffect(() => {
    focusGuardUntil.current = Date.now() + 150
    input.current?.focus()
    input.current?.select()
  }, [])
  const settle = (mode: 'commit' | 'cancel'): void => {
    if (settled.current) return
    settled.current = true
    const next = draft.trim()
    if (mode === 'cancel' || next === '' || next === value.trim()) {
      onCancel()
      return
    }
    onCommit(next)
  }
  return (
    <Input
      ref={input}
      aria-label={label}
      className={cn('dshx:h-7 dshx:px-1.5 dshx:py-0 dshx:text-sm', className)}
      draggable={false}
      maxLength={maxLength}
      spellCheck={false}
      value={draft}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={() => {
        // A context menu restores focus to its trigger right after this input
        // mounts; that is not the user leaving the field.
        if (Date.now() < focusGuardUntil.current) return
        settle('commit')
      }}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          settle('commit')
        } else if (event.key === 'Escape') {
          event.preventDefault()
          settle('cancel')
        }
      }}
    />
  )
}
