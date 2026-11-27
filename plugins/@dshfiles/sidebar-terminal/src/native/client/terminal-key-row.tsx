/** Keys a phone keyboard cannot send: one row above the terminal, like Blink's (plan phone P20). */
import { useEffect, useState, type ReactNode } from 'react'

export interface TerminalKeyRowKey {
  /** Stable row id; also the sequence's name in tests. */
  readonly id: 'esc' | 'tab' | 'ctrl-c' | 'up' | 'down' | 'left' | 'right'
  /** The keycap text; key names are not translated (they name the key, not an action). */
  readonly label: string
  /** The bytes xterm sends for that key. */
  readonly sequence: string
}

/** Esc, Tab, Ctrl+C and the arrows, in thumb order. */
export const TERMINAL_KEY_ROW_KEYS: readonly TerminalKeyRowKey[] = [
  { id: 'esc', label: 'Esc', sequence: '\x1b' },
  { id: 'tab', label: 'Tab', sequence: '\t' },
  { id: 'ctrl-c', label: 'Ctrl+C', sequence: '\x03' },
  { id: 'up', label: '↑', sequence: '\x1b[A' },
  { id: 'down', label: '↓', sequence: '\x1b[B' },
  { id: 'left', label: '←', sequence: '\x1b[D' },
  { id: 'right', label: '→', sequence: '\x1b[C' },
]

const COARSE_POINTER = '(pointer: coarse)'

/**
 * The key row exists only where the platform keyboard lacks those keys, and only while the terminal accepts input. Each
 * press keeps focus in the emulator so the browser keyboard stays up.
 */
export const TerminalKeyRow = (props: {
  readonly disabled: boolean
  readonly onKey: (sequence: string) => void
  readonly css: Record<string, string>
}): ReactNode => {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(COARSE_POINTER).matches : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(COARSE_POINTER)
    const listener = (): void => setCoarse(query.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])
  if (!coarse) return null
  return (
    <div className={props.css.keyRow} data-terminal-key-row="" role="toolbar" aria-label="Terminal keys">
      {TERMINAL_KEY_ROW_KEYS.map(key => (
        <button
          key={key.id}
          type="button"
          className={props.css.keyButton}
          data-terminal-key={key.id}
          disabled={props.disabled}
          // Keep the emulator focused: a press must not dismiss the software keyboard.
          onMouseDown={event => event.preventDefault()}
          onClick={() => props.onKey(key.sequence)}
        >
          {key.label}
        </button>
      ))}
    </div>
  )
}
