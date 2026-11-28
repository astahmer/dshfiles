import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Destinations } from './destinations.js'
import { HOST_TOGGLE_SIDEBAR_COMMAND, SIDEBAR_VERB_GROUP, SidebarPaletteRows } from './sidebar-palette-rows.js'

const source = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')

describe('the sidebar palette rows', () => {
  const destinations = Destinations.resolve([
    { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 },
    { id: 'dshfiles-usage', label: 'Usage: Analytics', order: 4 },
    { id: 'traces', label: 'Traces: Explorer', order: 4 },
  ])

  it('lists one row for a destination that is a single page', () => {
    // "Go to Inbox" sat beside "Inbox › Needs you": two rows that open the same page.
    const goTo = SidebarPaletteRows.destinationsWithGoTo({ destinations, listedPageIds: new Set(['attention-inbox', 'dshfiles-usage', 'traces']) })
    expect(goTo.has('inbox')).toBe(false)
    // A destination with several pages, or none listed, keeps its row; so do Threads and Settings.
    expect([...goTo].sort()).toEqual(['agents', 'knowledge', 'land', 'observe', 'settings', 'threads', 'work'])
    // Without the page's own row the destination row is the only way in.
    expect(SidebarPaletteRows.destinationsWithGoTo({ destinations, listedPageIds: new Set() }).has('inbox')).toBe(true)
  })

  it('does not write a page named like its destination twice', () => {
    expect(SidebarPaletteRows.pageLabel('Inbox', 'Inbox')).toBe('Inbox')
    expect(SidebarPaletteRows.pageLabel('Observe', 'Usage')).toBe('Observe › Usage')
  })

  it('files verbs as commands, and leaves filing a panel in a folder to the folder', () => {
    expect(SIDEBAR_VERB_GROUP).toBe('command')
    const shell = source('./sidebar-shell.tsx')
    for (const verb of ['toggle-sidebar', 'focus-composer', 'customize-sidebar', 'restart-dsh', 'pair-phone', 'copy-dsh-url']) {
      const at = shell.indexOf(`id: '@dshfiles/thread-sidebar/action/${verb}'`)
      expect(at, verb).toBeGreaterThan(-1)
      // Each was filed with `group: 'destination'`, so the palette listed verbs among pages.
      expect(shell.slice(at, at + 120), verb).toContain('group: SIDEBAR_VERB_GROUP')
    }
    // The built-in "Toggle left sidebar" does what Toggle sidebar does: it is not listed as a second row.
    expect(shell).toMatch(/SELF_COMMAND_IDS = new Set\(\['commandPalette\.open', HOST_TOGGLE_SIDEBAR_COMMAND\]\)/u)
    expect(HOST_TOGGLE_SIDEBAR_COMMAND).toBe('sidebar.left.toggle')
    // One row per folder and panel pair ("Add X to Y") grew with every folder; the folder's own Add panel does it.
    expect(shell).not.toContain('/sidebar-add/')
    // The board has one row, its page row; the dedicated "Thread board" action repeated it.
    expect(source('./client-entry.tsx')).not.toContain("'@dshfiles/thread-sidebar/open-board'")
  })
})
