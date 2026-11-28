import { describe, expect, it } from 'vitest'
import { DESTINATIONS, Destinations, KNOWN_SECTIONS } from './destinations.js'
import { FORMER_NAVIGATION } from './moved-to.generated.js'

describe('Destinations', () => {
  it('keeps the rail at eight labelled entries with Settings at the bottom', () => {
    expect(DESTINATIONS.map(destination => destination.label)).toEqual(['Threads', 'Inbox', 'Land', 'Work', 'Agents', 'Observe', 'Knowledge', 'Settings'])
    expect(DESTINATIONS.filter(destination => destination.bottom === true).map(destination => destination.id)).toEqual(['settings'])
  })

  it('gives every former left-nav entry of the migration map a section', () => {
    const formerLabels = new Set(KNOWN_SECTIONS.flatMap(section => section.formerLabels ?? []))
    expect(FORMER_NAVIGATION.filter(entry => !formerLabels.has(entry.entry)).map(entry => entry.entry)).toEqual([])
  })

  it('shows no plugin name in a section label', () => {
    for (const section of KNOWN_SECTIONS) {
      expect(section.label).not.toContain(':')
      expect(section.label.charAt(0)).toBe(section.label.charAt(0).toUpperCase())
      expect(section.label.slice(1)).not.toMatch(/\b[A-Z][a-z]/u)
    }
  })

  it('places registered pages and leaves pages nobody registered out', () => {
    const resolved = Destinations.resolve([
      { id: 'diffs-review', label: 'pulls.review: Reviews', order: 40 },
      { id: 'dshfiles-usage', label: 'Usage: Analytics', order: 4 },
      { id: 'traces', label: 'Traces: Explorer', order: 4 },
    ])
    const land = resolved.find(destination => destination.id === 'land')
    expect(land?.sections.map(section => section.label)).toEqual(['Review'])
    expect(resolved.find(destination => destination.id === 'observe')?.sections.map(section => section.label)).toEqual(['Usage', 'Traces'])
    expect(resolved.find(destination => destination.id === 'work')?.sections).toEqual([])
  })

  it('lists an unmapped page under Settings without its plugin prefix, and a contribution can re-home it', () => {
    const panels = [{ id: 'new-plugin-page', label: 'New Plugin: Dashboard', order: 3 }]
    const fallback = Destinations.resolve(panels).find(destination => destination.id === 'settings')?.sections[0]
    expect(fallback).toMatchObject({ label: 'Dashboard', unmapped: true, formerLabels: ['New Plugin: Dashboard'] })
    const contributed = Destinations.resolve(panels, [{ panelId: 'new-plugin-page', destination: 'observe', label: 'Dashboard' }])
    expect(contributed.find(destination => destination.id === 'observe')?.sections[0]).toMatchObject({ label: 'Dashboard', unmapped: false })
    expect(contributed.find(destination => destination.id === 'settings')?.sections).toEqual([])
  })

  it('keeps pages for plugin authors out of the user lists: a Developer group at the end of Settings', () => {
    const resolved = Destinations.resolve(
      [
        { id: 'dshfiles-memory-panel', label: 'Memory: Browser', order: 1 },
        { id: 'component-gallery', label: 'Component gallery', order: 90 },
        { id: 'dshfiles-plugin-guide', label: 'Plugin guide', order: 8 },
        { id: 'dshfiles-capabilities-hub', label: 'Capabilities hub', order: 7 },
        { id: 'ai-accounts', label: 'AI Accounts: Accounts', order: 2 },
        { id: 'plugins', label: 'Plugins', order: 0 },
      ],
      // What the two plugins contribute themselves; a contribution wins over the table.
      [
        { panelId: 'dshfiles-plugin-guide', destination: 'settings', label: 'Plugin guide', order: 2, group: 'developer' },
        { panelId: 'dshfiles-capabilities-hub', destination: 'settings', label: 'Capabilities hub', order: 6 },
      ],
    )
    // Component gallery sat under Knowledge between Memory and Whiteboard.
    expect(resolved.find(destination => destination.id === 'knowledge')?.sections.map(section => section.label)).toEqual(['Memory'])
    const settings = resolved.find(destination => destination.id === 'settings')?.sections ?? []
    // Capabilities hub was the first row of Settings; the managers it links to lead now, and developer pages come last.
    expect(settings.map(section => section.label)).toEqual(['AI accounts', 'Plugins', 'Capabilities hub', 'Component gallery', 'Plugin guide'])
    expect(settings.filter(section => section.group === 'developer').map(section => section.label)).toEqual(['Component gallery', 'Plugin guide'])
  })

  it('files a developer page under Settings whatever destination its plugin named', () => {
    const resolved = Destinations.resolve(
      [{ id: 'some-inspector', label: 'Inspector', order: 1 }],
      [{ panelId: 'some-inspector', destination: 'observe', label: 'Inspector', group: 'developer' }],
    )
    expect(resolved.find(destination => destination.id === 'observe')?.sections).toEqual([])
    expect(resolved.find(destination => destination.id === 'settings')?.sections.map(section => section.label)).toEqual(['Inspector'])
  })

  it('gives the Inbox one name and one page: Needs you is a view inside it, and the per-thread page is not a second row', () => {
    const inbox = Destinations.resolve(
      [
        { id: 'attention-inbox', label: 'Activity Timeline: Inbox', order: 1 },
        { id: 'thread-sidebar-waiting', label: 'Waiting threads', order: 3 },
      ],
      // What the sidebar contributes for its own per-thread page.
      [{ panelId: 'thread-sidebar-waiting', destination: 'inbox', label: 'Waiting threads', order: 2, unlisted: true }],
    )
    const destination = inbox.find(candidate => candidate.id === 'inbox')
    expect(destination?.label).toBe('Inbox')
    // The page was labelled "Needs you" under a destination named Inbox, beside a page listing the same threads.
    expect(destination?.sections.map(section => section.label)).toEqual(['Inbox'])
    expect(destination?.description).not.toMatch(/needs you/iu)
    // Unlisted is not "nobody mapped it": the page does not fall into Settings › Other pages either.
    expect(inbox.find(candidate => candidate.id === 'settings')?.sections).toEqual([])
    expect(KNOWN_SECTIONS.find(section => section.panelId === 'attention-inbox')?.formerLabels).toContain('Needs you')
  })

  it('finds the destination that owns an open page', () => {
    const resolved = Destinations.resolve([{ id: 'dshfiles-backlog-panel', label: 'Backlog: Items', order: 3 }])
    expect(Destinations.owning(resolved, 'dshfiles-backlog-panel')?.id).toBe('work')
    expect(Destinations.owning(resolved, 'conversation')).toBeUndefined()
    expect(Destinations.owning(resolved, null)).toBeUndefined()
  })
})
