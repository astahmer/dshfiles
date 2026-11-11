import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { loadedFrom } from './client-modules-promise.js'

/** Shaped like DSH's ClientModuleRegistry: its methods read private fields through `this`. */
class FieldBackedRegistry {
  private readonly composed = { entries: [{ id: '@dshfiles/example', rev: 'r1' }] }
  private readonly table = new Map([['@dshfiles/example', '/plugins/example/dist/client.js']])
  graph() {
    return this.composed
  }
  clientPath(id: string) {
    return this.table.get(id)
  }
}

describe('client module registry surface', () => {
  it('calls the registry methods on the registry, so a field-backed native registry answers', () => {
    const loaded = Option.getOrThrow(loadedFrom(new FieldBackedRegistry()))
    expect(loaded.registry.ids()).toEqual(['@dshfiles/example'])
    expect(loaded.registry.clientPath('@dshfiles/example')).toBe('/plugins/example/dist/client.js')
    expect(loaded.served()).toEqual([{ id: '@dshfiles/example', rev: 'r1' }])
  })
})
