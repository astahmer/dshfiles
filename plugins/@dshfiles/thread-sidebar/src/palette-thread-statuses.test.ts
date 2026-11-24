import { describe, expect, it } from 'vitest'
import { PaletteThreadStatusesModel } from './palette-thread-statuses.js'
import { ThreadWorkStatusModel } from './thread-status-client.js'

describe('palette thread statuses', () => {
  it("gives the palette the list's status and word, rebuilt only when the projection changes", () => {
    const store = ThreadWorkStatusModel.createStore()
    const source = PaletteThreadStatusesModel.sourceOf(store, status => (status === 'needs-you' ? 'Needs you' : status))
    expect(source.getSnapshot()).toBeNull()
    store.publish(new Map([['asks', { status: 'needs-you', detail: undefined }]]))
    const first = source.getSnapshot()
    expect(first?.get('asks')).toEqual({ status: 'needs-you', label: 'Needs you' })
    expect(source.getSnapshot()).toBe(first)
  })
})
