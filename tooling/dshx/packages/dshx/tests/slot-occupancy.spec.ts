import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clientSlotRegistrations, slotOccupancyConflicts } from '../src/compiler/client/slot-occupancy.js'

const temporaryRoots: string[] = []

const project = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-slot-occupancy-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Client slot occupancy', () => {
  it('finds native UI, panel, composer, and aliased defineSlot registrations across imports', async () => {
    const root = await project()
    await writeFile(resolve(root, 'client.ts'), "import './registrations.js'\n")
    await writeFile(
      resolve(root, 'registrations.tsx'),
      [
        "import { defineSlot as makeSlot } from '@dshfiles/dshx/client'",
        "makeSlot('conversation.input.dock', { id: 'todo' })",
        "api.ui.register({ name: 'conversation.input.dock', id: 'queue' }, Queue) ",
        "api.panels.register({ id: 'plugins', title: 'Plugins', component: Panel })",
        "api.composer.registerAction({ id: 'queue-reorder', placement: 'left', order: 80, component: Action })",
        '',
      ].join('\n'),
    )

    const registrations = await clientSlotRegistrations('client.ts', root)
    expect(registrations).toMatchObject([
      { slot: 'conversation.input.dock', id: 'todo', via: 'sdk-define-slot', line: 2 },
      { slot: 'conversation.input.dock', id: 'queue', via: 'sdk-ui', line: 3 },
      { slot: 'main', key: 'plugins', via: 'sdk-panel', line: 4 },
      { slot: 'sidebar.panellist', id: 'plugins', via: 'sdk-panel', line: 4 },
      { slot: 'conversation.input.left', id: 'queue-reorder', order: 80, via: 'sdk-composer', line: 5 },
    ])
    expect(slotOccupancyConflicts(registrations)).toMatchObject([
      { slot: 'conversation.input.dock', id: 'todo', occupant: 'todo', line: 2 },
      { slot: 'conversation.input.dock', id: 'queue', occupant: 'queue', line: 3 },
      { slot: 'sidebar.panellist', id: 'plugins', occupant: 'plugins', line: 4 },
    ])
  })

  it('allows a declared priority to deliberately replace a shipped identity', async () => {
    const root = await project()
    await writeFile(resolve(root, 'client.tsx'), "api.ui.register({ name: 'conversation.input.dock', id: 'queue', priority: 10 }, Queue)\n")

    const registrations = await clientSlotRegistrations('client.tsx', root)
    expect(registrations).toMatchObject([{ slot: 'conversation.input.dock', id: 'queue', priority: 10 }])
    expect(slotOccupancyConflicts(registrations)).toEqual([])
  })

  it('resolves constant registration ids before comparing shipped occupants', async () => {
    const root = await project()
    await writeFile(
      resolve(root, 'client.tsx'),
      ["const PANEL_ID = 'ai-accounts'", "api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID }, Panel)", ''].join('\n'),
    )

    const registrations = await clientSlotRegistrations('client.tsx', root)
    expect(registrations).toMatchObject([{ slot: 'sidebar.panellist', id: 'ai-accounts', via: 'sdk-ui', line: 2 }])
    expect(slotOccupancyConflicts(registrations)).toEqual([])
  })

  it('reports an unkeyed registration that replaces the whole shipped sidebar shell', async () => {
    const root = await project()
    await writeFile(resolve(root, 'client.tsx'), "api.ui.register({ name: 'sidebar' }, Sidebar)\n")

    const registrations = await clientSlotRegistrations('client.tsx', root)
    expect(registrations).toMatchObject([{ slot: 'sidebar', via: 'sdk-ui', line: 1 }])
    expect(slotOccupancyConflicts(registrations)).toMatchObject([{ slot: 'sidebar', occupant: 'ui-sidebar', line: 1 }])
  })
})
