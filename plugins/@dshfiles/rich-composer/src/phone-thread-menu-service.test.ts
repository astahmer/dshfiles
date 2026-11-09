import { describe, expect, it, vi } from 'vitest'
import { createPhoneThreadMenu } from './phone-thread-menu-service.ts'

describe('phone thread menu lifecycle', () => {
  it('toggles only live readers and closes when their occurrence leaves', () => {
    const menu = createPhoneThreadMenu()
    menu.toggle('missing')
    expect(menu.state.get().openReader).toBeNull()
    const remove = menu.registerReader({ id: 'main', sessionId: 'a' })
    menu.toggle('main')
    expect(menu.state.get().openReader).toBe('main')
    menu.toggle('main')
    expect(menu.state.get().openReader).toBeNull()
    menu.toggle('main')
    remove()
    expect(menu.state.get().readers).toEqual([])
    expect(menu.state.get().openReader).toBeNull()
  })

  it('releases the active launcher and menu when the stage leaves', () => {
    const menu = createPhoneThreadMenu()
    menu.registerReader({ id: 'main', sessionId: 'a' })
    const release = menu.attachLauncher('main')
    expect(menu.state.get().launcherReader).toBe('main')
    menu.toggle('main')
    release()
    expect(menu.state.get().launcherReader).toBeNull()
    expect(menu.state.get().openReader).toBeNull()
  })

  it('returns a closing tool to its live opener and never an unrelated or removed reader', () => {
    const menu = createPhoneThreadMenu()
    const focus = vi.fn(() => true)
    const remove = menu.registerReader({ id: 'own', sessionId: 'a' })
    menu.toggle('own', focus)
    expect(menu.returnFocus('other')).toBe(false)
    expect(menu.returnFocus('own')).toBe(true)
    expect(focus).toHaveBeenCalledOnce()
    remove()
    expect(menu.returnFocus('own')).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('opens only a live tool belonging to the open occurrence, even with duplicate labels', () => {
    const menu = createPhoneThreadMenu()
    const open = vi.fn()
    const other = { id: 'other/prompts', readerId: 'other', label: 'Saved prompts', open }
    const own = { id: 'own/prompts', readerId: 'own', label: 'Saved prompts', open }
    menu.registerReader({ id: 'own', sessionId: 'a' })
    menu.registerTool(other)
    const removeTool = menu.registerTool(own)
    menu.toggle('own')
    menu.pick(other)
    expect(open).not.toHaveBeenCalled()
    menu.pick(own)
    expect(open).toHaveBeenCalledOnce()
    expect(menu.state.get().openReader).toBeNull()
    menu.toggle('own')
    removeTool()
    menu.pick(own)
    expect(open).toHaveBeenCalledOnce()
    menu.close()
    expect(menu.state.get().openReader).toBeNull()
  })
})
