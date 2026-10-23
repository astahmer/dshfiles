import { describe, expect, it } from 'vitest'
import { threadViewCreateSchema, threadViewDeleteSchema, threadViewUpdateSchema } from './thread-views-api.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, MAX_THREAD_VIEWS, type ThreadViewSettings } from './thread-view-preferences.js'
import { ThreadViewsController, type ThreadViewsSettingsPort } from './thread-views-host.js'

class MemorySettings implements ThreadViewsSettingsPort {
  value = { threadViews: structuredClone(DEFAULT_THREAD_VIEW_SETTINGS), unrelated: 'keep' }
  revision = 0
  conflictNext = false
  failNext = false

  describe = () => [{ ns: 'thread-sidebar', value: structuredClone(this.value), revision: this.revision }]

  update = async (namespace: string, patch: { readonly threadViews: ThreadViewSettings }, expectedRevision?: number) => {
    expect(namespace).toBe('thread-sidebar')
    if (this.conflictNext) {
      this.conflictNext = false
      this.value = { ...this.value, unrelated: 'concurrent edit' }
      this.revision += 1
    }
    if (expectedRevision !== this.revision) throw new Error('SETTINGS_CONFLICT')
    if (this.failNext) {
      this.failNext = false
      throw new Error('Persistence failed')
    }
    this.value = { ...this.value, ...patch }
    this.revision += 1
  }
}

const custom = (id = 'custom') => ({ id, name: id, enabled: true, groupBy: 'status' as const, statusFilters: [], sourceFilter: 'all' as const })
const fixture = () => {
  const settings = new MemorySettings()
  return { settings, controller: new ThreadViewsController(settings) }
}

describe('Host saved thread views', () => {
  it('uses the settings provider for list, create, get, update, move, select, visibility and deletion', async () => {
    const { settings, controller } = fixture()
    expect(controller.list().settings).toEqual(DEFAULT_THREAD_VIEW_SETTINGS)
    await controller.create(custom())
    expect(controller.get({ id: 'custom' }).view.name).toBe('custom')
    await controller.update({ id: 'custom', name: 'Renamed', groupBy: 'project', statusFilters: ['working'], sourceFilter: 'main' })
    expect(controller.get({ id: 'custom' }).view).toMatchObject({ name: 'Renamed', groupBy: 'project', statusFilters: ['working'], sourceFilter: 'main' })
    await controller.move({ id: 'custom', direction: 'earlier' })
    expect(controller.list().settings.views.at(-2)?.id).toBe('custom')
    await controller.select({ id: 'custom', showFilterControl: false, showGroupControl: false })
    expect(controller.list().settings).toMatchObject({ activeViewId: 'custom', showFilterControl: false, showGroupControl: false })
    await controller.update({ id: 'custom', enabled: false })
    expect(controller.list().settings.activeViewId).not.toBe('custom')
    await controller.delete({ id: 'custom', confirm: true })
    expect(() => controller.get({ id: 'custom' })).toThrow('does not exist')
    expect(settings.value.unrelated).toBe('keep')
    expect(new ThreadViewsController(settings).list()).toEqual(controller.list())
  })

  it('fails missing targets explicitly for every targeted operation', async () => {
    const { controller } = fixture()
    expect(() => controller.get({ id: 'missing' })).toThrow('does not exist')
    await expect(controller.update({ id: 'missing', enabled: true })).rejects.toThrow('does not exist')
    await expect(controller.delete({ id: 'missing', confirm: true })).rejects.toThrow('does not exist')
    await expect(controller.move({ id: 'missing', direction: 'later' })).rejects.toThrow('does not exist')
    await expect(controller.select({ id: 'missing' })).rejects.toThrow('does not exist')
  })

  it('rejects duplicates, invalid names, last enabled changes and view limits', async () => {
    const { controller } = fixture()
    await controller.create(custom())
    await expect(controller.create(custom())).rejects.toThrow('already exists')
    await expect(controller.create({ ...custom('other'), name: 'CUSTOM' })).rejects.toThrow('unique')
    await expect(controller.create({ ...custom('unnamed'), name: null })).rejects.toThrow('need a name')
    for (const view of controller.list().settings.views.filter(view => view.id !== 'custom')) await controller.update({ id: view.id, enabled: false })
    await expect(controller.update({ id: 'custom', enabled: false })).rejects.toThrow('remain enabled')
    await expect(controller.delete({ id: 'custom', confirm: true })).rejects.toThrow('remain enabled')
    await expect(controller.select({ id: DEFAULT_THREAD_VIEW_SETTINGS.views[0]?.id })).rejects.toThrow('disabled')
    while (controller.list().settings.views.length < MAX_THREAD_VIEWS) await controller.create(custom(`view-${controller.list().settings.views.length}`))
    await expect(controller.create(custom('overflow'))).rejects.toThrow()
  })

  it('keeps boundary moves stable and rejects duplicate renames without writing', async () => {
    const { settings, controller } = fixture()
    const first = controller.list().settings.views[0]
    if (first === undefined) throw new Error('Expected a default view')
    await controller.move({ id: first.id, direction: 'earlier' })
    expect(controller.list().settings.views[0]?.id).toBe(first.id)
    await controller.create(custom('one'))
    await controller.create({ ...custom('two'), enabled: false })
    const revision = settings.revision
    await expect(controller.update({ id: 'two', name: 'ONE' })).rejects.toThrow('unique')
    expect(settings.revision).toBe(revision)
    await expect(controller.select({ id: 'two' })).rejects.toThrow('disabled')
    await controller.delete({ id: 'two', confirm: true })
    expect(controller.list().settings.activeViewId).toBe(DEFAULT_THREAD_VIEW_SETTINGS.activeViewId)
    await controller.select({ showFilterControl: false })
    expect(controller.list().settings.showFilterControl).toBe(false)
    expect(controller.list().settings.activeViewId).toBe(DEFAULT_THREAD_VIEW_SETTINGS.activeViewId)
  })

  it('rejects invalid commands rather than applying migration coercion', () => {
    expect(threadViewCreateSchema.safeParse({ ...custom(), id: '../bad' }).success).toBe(false)
    expect(threadViewCreateSchema.safeParse({ ...custom(), statusFilters: ['bogus'] }).success).toBe(false)
    expect(threadViewCreateSchema.safeParse({ ...custom(), statusFilters: ['all'] }).success).toBe(false)
    expect(threadViewCreateSchema.safeParse({ ...custom(), statusFilters: ['working', 'working'] }).success).toBe(false)
    expect(threadViewCreateSchema.safeParse({ ...custom(), statusFilters: ['not-working'] }).success).toBe(false)
    expect(threadViewCreateSchema.safeParse({ ...custom(), name: ' ' }).success).toBe(false)
    expect(threadViewCreateSchema.safeParse({ ...custom(), name: 'a'.repeat(33) }).success).toBe(false)
    expect(threadViewCreateSchema.safeParse({ ...custom(), id: 'a'.repeat(65) }).success).toBe(false)
    expect(threadViewUpdateSchema.safeParse({ id: 'custom' }).success).toBe(false)
    expect(threadViewUpdateSchema.safeParse({ id: 'custom', unknown: true }).success).toBe(false)
    expect(threadViewDeleteSchema.safeParse({ id: 'custom' }).success).toBe(false)
    expect(threadViewDeleteSchema.safeParse({ id: 'custom', confirm: false }).success).toBe(false)
  })

  it('serializes its updates and refuses concurrent external edits without losing data', async () => {
    const { settings, controller } = fixture()
    await Promise.all([controller.create(custom('one')), controller.create(custom('two'))])
    expect(controller.get({ id: 'one' }).view.id).toBe('one')
    expect(controller.get({ id: 'two' }).view.id).toBe('two')
    settings.conflictNext = true
    await expect(controller.update({ id: 'one', name: 'changed' })).rejects.toThrow('SETTINGS_CONFLICT')
    expect(controller.get({ id: 'one' }).view.name).toBe('one')
    expect(settings.value.unrelated).toBe('concurrent edit')
    settings.failNext = true
    await expect(controller.delete({ id: 'one', confirm: true })).rejects.toThrow('Persistence failed')
    expect(controller.get({ id: 'one' }).view.id).toBe('one')
    await controller.update({ id: 'one', name: 'recovered' })
    expect(controller.get({ id: 'one' }).view.name).toBe('recovered')
  })

  it('refuses an unavailable namespace and invalid persisted documents', () => {
    const { settings, controller } = fixture()
    expect(() => new ThreadViewsController({ describe: () => [], update: settings.update }).list()).toThrow('unavailable')
    settings.value.threadViews = { ...settings.value.threadViews, views: [] }
    expect(() => controller.list()).toThrow()
  })
})
