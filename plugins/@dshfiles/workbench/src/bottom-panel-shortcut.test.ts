import { CommandChords } from '@dshfiles/dshx/client'
import { describe, expect, it, vi } from 'vitest'
import { BOTTOM_PANEL_CHORD, BOTTOM_PANEL_COMMAND_ID, bottomPanelCommand } from './bottom-panel-shortcut.js'

describe('bottom panel command', () => {
  it('maps its id to the Host shortcut row Settings › Shortcuts edits', () => {
    expect(CommandChords.shortcutId(BOTTOM_PANEL_COMMAND_ID)).toBe('dshfiles-workbench.toggleBottomPanel')
  })

  it('binds the platform primary chord in the command palette and in the capture listener', () => {
    const command = bottomPanelCommand({ title: 'Toggle the bottom panel', toggle: () => {} })
    expect(command.keys).toEqual([BOTTOM_PANEL_CHORD])
    expect(CommandChords.toBinding(BOTTOM_PANEL_CHORD)).toEqual({ code: 'KeyJ', modifiers: ['primary'] })
  })

  it('keeps the terminal key for the shell it feeds', () => {
    const command = bottomPanelCommand({ title: 'Toggle the bottom panel', toggle: () => {} })
    expect(command.allowInTerminal).toBe(false)
    // Editable keeps the chord working from the composer, where focus usually is.
    expect(command.editable).toBe(true)
    expect(command.scope).toBeUndefined()
  })

  it('toggles the panel without ever declining the key', () => {
    const toggle = vi.fn()
    const result = bottomPanelCommand({ title: 'Toggle the bottom panel', toggle }).run()
    expect(toggle).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })
})
