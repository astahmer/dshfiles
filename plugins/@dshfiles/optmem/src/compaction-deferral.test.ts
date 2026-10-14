import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { deferPressureCompaction } from './compaction-deferral.ts'

/**
 * compaction-basic's step listener calls `this.compactIfNeeded` on its own engine. The real method reads the session's
 * request header first, so a header read means DSH's compaction ran; a session with no header then ends it as a no-op.
 */
interface ProbeAgent {
  readonly session: {
    readonly id: string
    readonly header: { readonly origin?: 'user' | 'subagent' }
    readonly requestHeader: () => EpochHeader | undefined
  }
  readonly options: Record<never, never>
}

// Method parameters compare bivariantly, so the engine accepts the slice of an Agent this probe supplies.
const engine: { compactIfNeeded(agent: ProbeAgent, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> } =
  BasicCompactionEngine.prototype

const step = async (origin: 'user' | 'subagent', trigger: CompactionTrigger) => {
  let headerReads = 0
  const agent: ProbeAgent = {
    session: {
      id: `session-${origin}`,
      header: { origin },
      requestHeader: () => {
        headerReads++
        return undefined
      },
    },
    options: {},
  }
  const result = await engine.compactIfNeeded(agent, trigger, new AbortController().signal)
  return { result, compacted: headerReads > 0 }
}

const restores: (() => void)[] = []

const defer = (fullMode: { active: boolean }) => {
  const deferred: string[] = []
  restores.push(deferPressureCompaction({ fullModeActive: () => fullMode.active, onDeferred: sessionId => deferred.push(sessionId) }))
  return deferred
}

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

describe('pressure compaction while full mode holds the context', () => {
  it('skips pressure compaction of the stored history', async () => {
    const deferred = defer({ active: true })
    expect(await step('user', 'pressure')).toEqual({ result: null, compacted: false })
    expect(deferred).toEqual(['session-user'])
  })

  it('still recovers from a provider-confirmed overflow', async () => {
    defer({ active: true })
    expect((await step('user', 'context-overflow')).compacted).toBe(true)
  })

  it('the control: compatibility mode and subagents compact as before', async () => {
    const fullMode = { active: false }
    const deferred = defer(fullMode)
    expect((await step('user', 'pressure')).compacted).toBe(true)
    fullMode.active = true
    expect((await step('subagent', 'pressure')).compacted).toBe(true)
    expect(deferred).toEqual([])
  })

  it('restores the engine when OptMem unloads', async () => {
    defer({ active: true })
    for (const restore of restores.splice(0)) restore()
    expect((await step('user', 'pressure')).compacted).toBe(true)
  })
})
