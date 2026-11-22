// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectAddFlow } from './project-add-flow.js'

afterEach(() => {
  vi.useRealTimers()
  globalThis.__dshfilesProjectAddIntent = undefined
})

describe('ProjectAddFlow', () => {
  it('hands a requested view to the next flow once, and falls back to browse', () => {
    expect(ProjectAddFlow.take()).toBe('browse')
    ProjectAddFlow.request('create')
    expect(ProjectAddFlow.take()).toBe('create')
    expect(ProjectAddFlow.take()).toBe('browse')
  })

  it('drops a stale request', () => {
    vi.useFakeTimers()
    ProjectAddFlow.request('clone')
    vi.advanceTimersByTime(11_000)
    expect(ProjectAddFlow.take()).toBe('browse')
  })

  it('reports whether an owner opened the flow, and its availability', () => {
    expect(ProjectAddFlow.available()).toBe(false)
    expect(ProjectAddFlow.open('create')).toBe(false)
    const seen: string[] = []
    const off = ProjectAddFlow.handle(view => seen.push(view))
    expect(ProjectAddFlow.available()).toBe(true)
    expect(ProjectAddFlow.open('create')).toBe(true)
    off()
    expect(ProjectAddFlow.available()).toBe(false)
    expect(seen).toEqual(['create'])
  })
})
