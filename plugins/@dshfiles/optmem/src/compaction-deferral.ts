import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

/**
 * Full mode sends the memory view and the current turn, but DSH's token meter keeps pricing the stored history,
 * so compaction-basic would summarize that history every step once it crosses its threshold — LLM calls whose result
 * full mode never sends. While full mode holds a conversation's context, its pressure compaction is skipped;
 * provider-confirmed overflow recovery still runs, since that is about the request actually sent.
 *
 * Agent presets isolate `compaction`, so each preset owns an engine the Host context cannot reach. Every engine's step
 * listener dispatches `this.compactIfNeeded` dynamically, so the override sits on the shared prototype.
 */
export const deferPressureCompaction = ({
  fullModeActive,
  onDeferred,
}: {
  readonly fullModeActive: () => boolean
  readonly onDeferred: (sessionId: string) => void
}): (() => void) => {
  const prototype = BasicCompactionEngine.prototype
  const descriptor = Reflect.getOwnPropertyDescriptor(prototype, 'compactIfNeeded')
  const compactIfNeeded = prototype.compactIfNeeded
  const deferred: BasicCompactionEngine['compactIfNeeded'] = function (this: BasicCompactionEngine, agent, trigger, signal) {
    if (trigger !== 'pressure' || !fullModeActive() || agent.session.header.origin === 'subagent') return compactIfNeeded.call(this, agent, trigger, signal)
    onDeferred(agent.session.id)
    return Promise.resolve(null)
  }
  Reflect.defineProperty(prototype, 'compactIfNeeded', { value: deferred, configurable: true, writable: true })
  return () => {
    if (descriptor !== undefined) Reflect.defineProperty(prototype, 'compactIfNeeded', descriptor)
  }
}
