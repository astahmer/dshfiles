import { describe, expect, it, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createMainSurfaceSeat, MainSurfaceRendering } from './main-surface.js'
import { createLayoutStore } from './native/client/stores.js'
import { LayoutController } from './native/client/service.js'

const openSeat = () => {
  const instance = createLayoutStore().create()
  return { instance, seat: createMainSurfaceSeat(instance) }
}

describe('main surface seat', () => {
  it('reports repeated navigation requests even when the selected key does not change', () => {
    const instance = createLayoutStore().create()
    const requested = vi.fn()
    const layout = new LayoutController(
      instance.actions,
      () => true,
      {
        getSnapshot: () => instance.getSnapshot().panelInfo,
        subscribe: listener => instance.subscribe(listener),
      },
      requested,
    )
    layout.selectPanel(null)
    layout.selectPanel(null)
    expect(requested.mock.calls).toEqual([[null], [null]])
    layout.dispose()
  })

  it('defaults to native and observes reversible mode changes only', () => {
    const { instance, seat } = openSeat()
    const changes: string[] = []
    const unsubscribe = seat.subscribe(() => changes.push(seat.mode()))

    expect(seat.mode()).toBe('native')
    instance.actions.setSidebar(360)
    seat.setMode('native')
    expect(changes).toEqual([])
    seat.setMode('workbench')
    expect(instance.getSnapshot().layoutInfo.mainSurfaceMode).toBe('workbench')
    seat.setMode('workbench')
    seat.setMode('native')
    expect(changes).toEqual(['workbench', 'native'])

    unsubscribe()
    seat.setMode('workbench')
    expect(changes).toEqual(['workbench', 'native'])
    expect(openSeat().seat.mode()).toBe('native')
  })

  it('does not mount the shell seat in native mode', () => {
    const shellCalls = vi.fn()
    const renderShell: PropsRenderSlots<'shell.main'>['renderSlot'] = (...args) => {
      shellCalls(...args)
      return null
    }
    const renderMain = vi.fn()
    expect(MainSurfaceRendering.render('native', renderShell, renderMain, 'native panel')).toBe('native panel')
    expect(shellCalls).not.toHaveBeenCalled()
    expect(renderMain).not.toHaveBeenCalled()
  })

  it('passes the native fallback and authorized renderer to the shell occupant', () => {
    const shellCalls = vi.fn()
    const renderShell: PropsRenderSlots<'shell.main'>['renderSlot'] = (slot, owner, options) => {
      shellCalls(slot, owner, options)
      return options?.fallback
    }
    const renderMain = vi.fn()
    expect(MainSurfaceRendering.render('workbench', renderShell, renderMain, 'native panel')).toBe('native panel')
    expect(shellCalls).toHaveBeenCalledExactlyOnceWith('shell.main', { renderMain }, { fallback: 'native panel' })
    expect(renderMain).not.toHaveBeenCalled()
  })

  it('uses the occupied shell surface instead of rendering the native fallback', () => {
    const renderShell: PropsRenderSlots<'shell.main'>['renderSlot'] = () => 'workbench surface'
    expect(MainSurfaceRendering.render('workbench', renderShell, vi.fn(), 'native panel')).toBe('workbench surface')
  })

  it('delegates keyed main rendering but stops the legacy workbench recursion boundary', () => {
    const authorizedRenderer = vi.fn<PropsRenderSlots<'main'>['renderSlot']>((_slot, _owner, options) => options?.entryKey)
    const renderMain = MainSurfaceRendering.createRenderer(authorizedRenderer)
    expect(renderMain('conversation')).toBe('conversation')
    expect(renderMain('dshfiles-backlog')).toBe('dshfiles-backlog')
    expect(renderMain('dshfiles-workbench')).toBeNull()
    expect(authorizedRenderer.mock.calls).toEqual([
      ['main', {}, { entryKey: 'conversation' }],
      ['main', {}, { entryKey: 'dshfiles-backlog' }],
    ])
  })
})
