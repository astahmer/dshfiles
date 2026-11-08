import { describe, expect, it } from 'vitest'
import { decodeFrame } from './frames.js'

describe('HMR event frames', () => {
  it('decodes the module graph frame the stock transport syncs', () => {
    expect(decodeFrame('{"type":"graph","graph":{"server":{"modules":[]}}}')).toEqual({ type: 'graph', graph: { server: { modules: [] } } })
  })

  it('decodes a rebuilt module frame', () => {
    expect(decodeFrame('{"type":"rebuilt","id":"@dshfiles/hmr-gate","rev":"abc123"}')).toEqual({ type: 'rebuilt', id: '@dshfiles/hmr-gate', rev: 'abc123' })
  })

  it('decodes a deferred frame and keeps the package list', () => {
    expect(decodeFrame('{"type":"deferred","packages":[{"id":"@dshfiles/hmr-gate","reason":"host half changed"}]}')).toEqual({
      type: 'deferred',
      packages: [{ id: '@dshfiles/hmr-gate', reason: 'host half changed' }],
    })
  })

  it('ignores an unknown frame type', () => {
    expect(decodeFrame('{"type":"connected"}')).toBeUndefined()
  })

  it('ignores malformed JSON and non-object frames', () => {
    expect(decodeFrame('{"type":')).toBeUndefined()
    expect(decodeFrame('"deferred"')).toBeUndefined()
    expect(decodeFrame('null')).toBeUndefined()
  })

  it('ignores a frame missing a required field or carrying an empty one', () => {
    expect(decodeFrame('{"type":"rebuilt","id":"","rev":"abc123"}')).toBeUndefined()
    expect(decodeFrame('{"type":"deferred"}')).toBeUndefined()
    expect(decodeFrame('{"type":"deferred","packages":[{"id":"@dshfiles/hmr-gate"}]}')).toBeUndefined()
  })

  it('ignores a deferred list past the 64-package cap', () => {
    const packages = Array.from({ length: 65 }, (_entry, index) => ({ id: `@dshfiles/plugin-${String(index)}`, reason: 'host half changed' }))
    expect(decodeFrame(JSON.stringify({ type: 'deferred', packages }))).toBeUndefined()
    expect(decodeFrame(JSON.stringify({ type: 'deferred', packages: packages.slice(0, 64) }))).toMatchObject({ type: 'deferred' })
  })
})
