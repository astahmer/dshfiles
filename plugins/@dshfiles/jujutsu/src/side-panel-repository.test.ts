import { describe, expect, it } from 'vitest'
import { containsPath, createSidePanelRepository } from './side-panel-repository.js'

describe('side panel repository', () => {
  it('matches the root and paths inside it, not siblings sharing a prefix', () => {
    expect(containsPath('/dev/dshfiles', '/dev/dshfiles')).toBe(true)
    expect(containsPath('/dev/dshfiles/', '/dev/dshfiles/plugins/jujutsu')).toBe(true)
    expect(containsPath('/dev/dshfiles', '/dev/dshfiles-other')).toBe(false)
    expect(containsPath('', '/dev')).toBe(false)
  })

  it('holds a request until a page mounts, then hands it over once', () => {
    const repository = createSidePanelRepository()
    repository.request('/dev/a')
    expect(repository.takePending()).toBe('/dev/a')
    expect(repository.takePending()).toBeNull()
  })

  it('delivers requests to a mounted page instead of queuing them', () => {
    const repository = createSidePanelRepository()
    const received: string[] = []
    const stop = repository.onRequest(path => received.push(path))
    repository.request('/dev/b')
    stop()
    repository.request('/dev/c')
    expect(received).toEqual(['/dev/b'])
    expect(repository.takePending()).toBe('/dev/c')
  })

  it('reports what the page shows until that page clears it', () => {
    const repository = createSidePanelRepository()
    const clearFirst = repository.show('/dev/a')
    expect(repository.isShowing('/dev/a/src')).toBe(true)
    repository.show('/dev/b')
    clearFirst()
    expect(repository.isShowing('/dev/b')).toBe(true)
    expect(repository.isShowing('/dev/a')).toBe(false)
  })
})
