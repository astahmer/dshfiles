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
      { id: 'pulls-review', label: 'pulls.review: Reviews', order: 40 },
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

  it('finds the destination that owns an open page', () => {
    const resolved = Destinations.resolve([{ id: 'dshfiles-backlog-panel', label: 'Backlog: Items', order: 3 }])
    expect(Destinations.owning(resolved, 'dshfiles-backlog-panel')?.id).toBe('work')
    expect(Destinations.owning(resolved, 'conversation')).toBeUndefined()
    expect(Destinations.owning(resolved, null)).toBeUndefined()
  })
})
