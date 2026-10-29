// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { ChromeCdp } from '../src/chrome-cdp.js'

describe('chrome cdp spans', () => {
  it('records the cdp open span when the socket is refused', async () => {
    using recorder = recordSpans()
    await expect(ChromeCdp.openCdp({ wsUrl: 'ws://127.0.0.1:1', timeoutMs: 2_000 })).rejects.toThrow()
    expect(recorder.span('annotations open cdp')).toBeDefined()
  })

  it('records the cdp list span when the endpoint is refused', async () => {
    using recorder = recordSpans()
    expect(await ChromeCdp.listPages({ endpoint: 'http://127.0.0.1:1' })).toEqual([])
    expect(recorder.span('annotations list cdp pages')).toBeDefined()
  })
})
