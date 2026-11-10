import { CommandChords } from '@dshfiles/dshx/client'
import { describe, expect, it, vi } from 'vitest'
import { BOTTOM_PANEL_CHORD, BOTTOM_PANEL_COMMAND_ID, bottomPanelCommand } from './bottom-panel-shortcut.js'

const TITLE = 'Toggle the bottom panel'
const MAC = true
const NOT_MAC = false

describe('bottom panel command', () => {
  it('maps its id to the Host shortcut row Settings › Shortcuts edits', () => {
    expect(CommandChords.shortcutId(BOTTOM_PANEL_COMMAND_ID)).toBe('dshfiles-workbench.toggleBottomPanel')
  })

  it('binds the platform primary chord in the command palette and in the capture listener', () => {
    const command = bottomPanelCommand({ title: TITLE, toggle: () => {}, mac: MAC })
    expect(command.keys).toEqual([BOTTOM_PANEL_CHORD])
    expect(CommandChords.toBinding(BOTTOM_PANEL_CHORD)).toEqual({ code: 'KeyJ', modifiers: ['primary'] })
  })

  it('keeps the terminal key for the shell it feeds outside macOS', () => {
    const command = bottomPanelCommand({ title: TITLE, toggle: () => {}, mac: NOT_MAC })
    expect(command.allowInTerminal).toBe(false)
    // Editable keeps the chord working from the composer, where focus usually is.
    expect(command.editable).toBe(true)
    expect(command.scope).toBeUndefined()
  })

  it('keeps Cmd+J live in the terminal on macOS, where the shell never receives it', () => {
    expect(bottomPanelCommand({ title: TITLE, toggle: () => {}, mac: MAC }).allowInTerminal).toBe(true)
  })

  it('toggles the panel without ever declining the key', () => {
    const toggle = vi.fn()
    const result = bottomPanelCommand({ title: TITLE, toggle, mac: NOT_MAC }).run()
    expect(toggle).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })
})
