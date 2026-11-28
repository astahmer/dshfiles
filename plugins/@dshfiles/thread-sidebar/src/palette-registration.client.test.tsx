// @vitest-environment jsdom
import type { PaletteAction, PaletteActionContext } from '@dshfiles/command-palette/palette-contract'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePaletteActions } from './palette-registration.js'

afterEach(cleanup)

/** Rows built afresh on every render, as the sidebar's memo rebuilt them on a thread switch. */
const rows = (input: { readonly selected: string; readonly label?: string; readonly extra?: boolean; readonly onRun: (id: string, selected: string) => void }): PaletteAction[] => [
  {
    id: 'a/header/threads',
    group: 'destination',
    label: input.label ?? 'Threads',
    aliases: ['list'],
    icon: <svg data-icon="threads" width={16} />,
    run: () => input.onRun('threads', input.selected),
  },
  { id: 'a/action/back', group: 'action', label: () => `Back from ${input.selected}`, isAvailable: () => input.selected !== 'none', run: () => input.onRun('back', input.selected) },
  ...(input.extra === true ? [{ id: 'a/action/extra', label: 'Extra', run: () => input.onRun('extra', input.selected) }] : []),
]

// Performance P1 (round 34): every thread click withdrew and re-added each sidebar row, and each add or remove
// republished the palette's whole list.
describe('the sidebar registers its palette rows by content (performance P1)', () => {
  const Probe = (props: { readonly actions: readonly PaletteAction[]; readonly add: (actions: readonly PaletteAction[]) => () => void }): null => {
    usePaletteActions(props.actions, props.add)
    return null
  }

  it('publishes nothing on a thread switch that leaves the rows\' content equal, and runs the latest callbacks', () => {
    const dispose = vi.fn()
    const add = vi.fn((_actions: readonly PaletteAction[]) => dispose)
    const onRun = vi.fn()
    const view = render(<Probe actions={rows({ selected: 'thread-1', onRun })} add={add} />)
    expect(add).toHaveBeenCalledOnce()
    // Five thread switches: new arrays, closures and icon elements, the same content.
    for (const selected of ['thread-2', 'thread-3', 'thread-4', 'thread-5', 'thread-6']) view.rerender(<Probe actions={rows({ selected, onRun })} add={add} />)
    expect(add).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
    // The registered rows act on the latest render's state.
    const registered = add.mock.calls[0]?.[0] ?? []
    const context: PaletteActionContext = { thread: null, workspace: null, workspaces: [], themePreference: 'system' }
    void registered.find(action => action.id === 'a/header/threads')?.run(context)
    expect(onRun).toHaveBeenLastCalledWith('threads', 'thread-6')
    const back = registered.find(action => action.id === 'a/action/back')
    expect(typeof back?.label === 'function' ? back.label() : back?.label).toBe('Back from thread-6')
  })

  it('registers again, once, when a row\'s content changes, a row comes or goes, and withdraws on unmount', () => {
    const dispose = vi.fn()
    const add = vi.fn((_actions: readonly PaletteAction[]) => dispose)
    const onRun = vi.fn()
    const view = render(<Probe actions={rows({ selected: 'thread-1', onRun })} add={add} />)
    view.rerender(<Probe actions={rows({ selected: 'thread-1', label: 'Threads (renamed)', onRun })} add={add} />)
    expect(add).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(1)
    view.rerender(<Probe actions={rows({ selected: 'thread-1', label: 'Threads (renamed)', extra: true, onRun })} add={add} />)
    expect(add).toHaveBeenCalledTimes(3)
    expect(add.mock.calls[2]?.[0].map(action => action.id)).toContain('a/action/extra')
    view.unmount()
    expect(dispose).toHaveBeenCalledTimes(3)
  })

  it('wires the sidebar shell through it, not an effect keyed on the rows\' identity', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const shell = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sidebar-shell.tsx'), 'utf8')
    expect(shell).toContain('usePaletteActions(paletteActions, PaletteBridge.addActions)')
    expect(shell).not.toContain('useEffect(() => PaletteBridge.addActions(paletteActions), [paletteActions])')
  })
})
