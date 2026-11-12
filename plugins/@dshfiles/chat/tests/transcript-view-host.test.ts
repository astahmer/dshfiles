import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { readTranscriptView, writeTranscriptView } from '../src/host.ts'
import { transcriptViewApi } from '../src/transcript-view-api.ts'

/** The Host settings service as Chat's view-mode tools use it: one namespace whose writes bump its revision. */
const fakeContext = (initial: Readonly<Record<string, string>>) => {
  let value = initial
  let revision = 3
  const writes: unknown[] = []
  const settings = {
    describe: () => [{ ns: 'dshfiles-chat', value, revision }],
    update: async (ns: string, patch: Readonly<Record<string, string>>, expected?: number) => {
      writes.push({ ns, patch, expected })
      value = { ...value, ...patch }
      revision += 1
    },
    mutate: async (ns: string, ops: readonly unknown[], expected?: number) => {
      writes.push({ ns, ops, expected })
      value = {}
      revision += 1
    },
  }
  // SAFETY: the tools read only ctx.get('settings'); the rest of the Cordis context is never touched.
  const ctx = { get: (name: string) => (name === 'settings' ? settings : undefined) } as unknown as Context
  return { ctx, writes }
}

describe('Chat view-mode tools', () => {
  it('reads the saved mode, saves another at the revision it read, and clears it back to the device default', async () => {
    const { ctx, writes } = fakeContext({ transcriptView: 'normal' })
    expect(readTranscriptView(ctx).saved).toBe('detailed')
    expect(await writeTranscriptView(ctx, 'verbose')).toEqual({ saved: 'verbose' })
    expect(readTranscriptView(ctx).saved).toBe('verbose')
    expect(await writeTranscriptView(ctx, 'device-default')).toEqual({ saved: null })
    expect(readTranscriptView(ctx).saved).toBeNull()
    expect(writes).toEqual([
      { ns: 'dshfiles-chat', patch: { transcriptView: 'verbose' }, expected: 3 },
      { ns: 'dshfiles-chat', ops: [{ op: 'unset', path: ['transcriptView'] }], expected: 4 },
    ])
  })

  it('binds a read-only get tool and a set tool that runs only on request', () => {
    const tools = Object.values(transcriptViewApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => [tool.name, tool.readOnly === true])).toEqual([
      ['transcript_view_get', true],
      ['transcript_view_set', false],
    ])
    expect(transcriptViewApi.methods.set.description).toMatch(/only when the user asked/)
  })
})
