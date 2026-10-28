// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sidebarChildren } from './sidebar-contract.js'
import { SidebarContentSeat, SidebarPreviewFallback } from './sidebar-content-seat.js'

afterEach(cleanup)

describe('sidebar content seat', () => {
  it('never mounts a fixed preview while the actual left content slot is overridden', () => {
    const renderSlot = vi.fn<PropsRenderSlots<'sidebar.footer.above'>['renderSlot']>(() => <button>Account preview</button>)
    render(<SidebarPreviewFallback renderSlot={renderSlot} contentOverridden />)
    expect(renderSlot).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Account preview' })).toBeNull()
  })

  it('keeps the genuine preview and its actions only for a standalone sidebar, including override teardown', () => {
    const openAccount = vi.fn()
    const renderSlot = vi.fn<PropsRenderSlots<'sidebar.footer.above'>['renderSlot']>(() => <button onClick={openAccount}>Account preview</button>)
    const view = render(<SidebarPreviewFallback renderSlot={renderSlot} contentOverridden={false} />)
    expect(renderSlot).toHaveBeenCalledWith('sidebar.footer.above', {})
    fireEvent.click(screen.getByRole('button', { name: 'Account preview' }))
    expect(openAccount).toHaveBeenCalledTimes(1)
    view.rerender(<SidebarPreviewFallback renderSlot={renderSlot} contentOverridden />)
    expect(screen.queryByRole('button', { name: 'Account preview' })).toBeNull()
    view.rerender(<SidebarPreviewFallback renderSlot={renderSlot} contentOverridden={false} />)
    expect(screen.getAllByRole('button', { name: 'Account preview' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Account preview' }))
    expect(openAccount).toHaveBeenCalledTimes(2)
  })

  it('declares a real root single slot rather than reparenting plugin DOM', () => {
    expect(sidebarChildren['shell.left']).toEqual({ kind: 'single', scope: 'root' })
  })

  it('delegates only the middle to the tab host and keeps fixed chrome outside its capability', () => {
    const calls = vi.fn()
    const renderSlot: PropsRenderSlots<'shell.left'>['renderSlot'] = (name, owner, options) => {
      calls(name, owner, options)
      return (
        <section aria-label="Left panels">
          <button role="tab">Threads</button>
          <button>Add panel</button>
        </section>
      )
    }
    render(
      <>
        <header>Logo / Back / Forward / Palette</header>
        <SidebarContentSeat renderSlot={renderSlot} collapsed={false}>
          <nav>Legacy navigation</nav>
          <section>Legacy threads</section>
        </SidebarContentSeat>
        <footer>Accounts / Settings</footer>
      </>,
    )
    const seat = screen.getByRole('region', { name: 'Left panels' }).parentElement
    expect(screen.getByRole('tab', { name: 'Threads' })).toBeTruthy()
    expect(screen.queryByText('Legacy navigation')).toBeNull()
    expect(screen.queryByText('Legacy threads')).toBeNull()
    expect(seat?.contains(screen.getByRole('banner'))).toBe(false)
    expect(seat?.contains(screen.getByRole('contentinfo'))).toBe(false)
    expect(calls).toHaveBeenCalledWith('shell.left', { collapsed: false }, { fallback: expect.anything() })
  })

  it('retains genuine navigation and thread slots as the installed renderer fallback', () => {
    const renderSlot: PropsRenderSlots<'shell.left'>['renderSlot'] = (_name, _owner, options) => options?.fallback
    render(
      <SidebarContentSeat renderSlot={renderSlot} collapsed={false}>
        <nav aria-label="Navigation">Plugins</nav>
        <section aria-label="Threads">A real thread</section>
      </SidebarContentSeat>,
    )
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Threads' })).toBeTruthy()
  })

  it('reports collapse without unmounting the docking region', () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    const Panel = ({ collapsed }: { readonly collapsed: boolean }) => {
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return (
        <section aria-label="Left panels" hidden={collapsed}>
          Threads
        </section>
      )
    }
    const renderSlot: PropsRenderSlots<'shell.left'>['renderSlot'] = (_name, owner) => {
      if (!('collapsed' in owner) || typeof owner.collapsed !== 'boolean') throw new Error('Missing collapse owner share')
      return <Panel collapsed={owner.collapsed} />
    }
    const view = render(
      <SidebarContentSeat renderSlot={renderSlot} collapsed={false}>
        Fallback
      </SidebarContentSeat>,
    )
    view.rerender(
      <SidebarContentSeat renderSlot={renderSlot} collapsed>
        Fallback
      </SidebarContentSeat>,
    )
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    view.rerender(
      <SidebarContentSeat renderSlot={renderSlot} collapsed={false}>
        Fallback
      </SidebarContentSeat>,
    )
    expect(screen.getByRole('region', { name: 'Left panels' })).toBeTruthy()
    expect(mounted).toHaveBeenCalledTimes(1)
  })
})
