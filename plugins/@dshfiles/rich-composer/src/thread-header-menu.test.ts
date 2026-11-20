import type { MenuActionView, MenuResolution } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { describe, expect, it, vi } from 'vitest'
import { threadHeaderMenuOf } from './thread-header-menu.ts'

const resolutionOf = (initial: readonly MenuActionView[]) => {
  let views = initial
  const listeners = new Set<() => void>()
  const select = vi.fn()
  const dispose = vi.fn()
  const resolution: MenuResolution = {
    source: {
      getSnapshot: () => views,
      subscribe: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    ready: Promise.resolve(),
    select,
    dispose,
  }
  return {
    resolution,
    select,
    dispose,
    update: (next: readonly MenuActionView[]) => {
      views = next
      for (const listener of listeners) listener()
    },
  }
}

describe('the Host header menu as thread-menu rows', () => {
  it('keeps ids, labels, icon keys, images, separators and submenus, and one array per snapshot', () => {
    const host = resolutionOf([
      { id: 'export/copy', label: 'Copy Session as Markdown', icon: { key: 'session-log-download.copy' } },
      {
        id: 'open/openWith',
        label: 'Open in',
        icon: { key: 'open-in-app.application' },
        separatorBefore: true,
        children: [{ id: 'open/openWith/app:zed', label: 'Zed', disabled: true, icon: { key: 'open-in-app.application', src: '/icons/zed' } }],
      },
    ])
    const menu = threadHeaderMenuOf(host.resolution)
    expect(menu.actions()).toEqual([
      { id: 'export/copy', label: 'Copy Session as Markdown', iconKey: 'session-log-download.copy' },
      {
        id: 'open/openWith',
        label: 'Open in',
        iconKey: 'open-in-app.application',
        separatorBefore: true,
        children: [{ id: 'open/openWith/app:zed', label: 'Zed', disabled: true, iconKey: 'open-in-app.application', iconSrc: '/icons/zed' }],
      },
    ])
    expect(menu.actions()).toBe(menu.actions())
  })

  it('follows the Host snapshot, selects by id and disposes the opening', () => {
    const host = resolutionOf([])
    const menu = threadHeaderMenuOf(host.resolution)
    const changed = vi.fn()
    const off = menu.subscribe(changed)
    host.update([{ id: 'feedback/feedback', label: 'Feedback' }])
    expect(changed).toHaveBeenCalledOnce()
    expect(menu.actions().map(action => action.label)).toEqual(['Feedback'])
    menu.select('feedback/feedback')
    expect(host.select).toHaveBeenCalledWith('feedback/feedback')
    off()
    menu.dispose()
    expect(host.dispose).toHaveBeenCalledOnce()
  })
})
