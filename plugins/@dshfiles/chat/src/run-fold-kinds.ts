import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RunFoldCall, RunFoldKind } from './run-folds.ts'

/** The fold kinds TranscriptRunFolds providers registered, read synchronously while Chat lays out a row list. */
let kinds: readonly RunFoldKind[] = []
const listeners = new Set<() => void>()

const sorted = (entries: readonly RunFoldKind[]): readonly RunFoldKind[] =>
  entries
    .map((kind, index) => ({ kind, index }))
    .sort((left, right) => (left.kind.order ?? 0) - (right.kind.order ?? 0) || left.index - right.index)
    .map(entry => entry.kind)

const set = (next: readonly RunFoldKind[]): void => {
  const ordered = sorted(next)
  if (ordered.length === kinds.length && ordered.every((kind, index) => kind === kinds[index])) return
  kinds = ordered
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Keep the kinds in step with the providers; a provider that loads after a thread rendered still folds its rows. */
const follow = (providers: { get(): readonly RunFoldKind[]; subscribe(listener: () => void): () => void }): (() => void) => {
  set(providers.get())
  const unsubscribe = providers.subscribe(() => set(providers.get()))
  return () => {
    unsubscribe()
    set([])
  }
}

const textOf = (content: readonly unknown[]): string =>
  content
    .flatMap(part =>
      typeof part === 'object' && part !== null && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : [],
    )
    .join('\n')

const calls = new WeakMap<ToolCallBlock, RunFoldCall>()

/** The classified fields of a root call; one object per block, so equal blocks compare by identity. */
const callOf = (root: ToolCallBlock): RunFoldCall => {
  const cached = calls.get(root)
  if (cached !== undefined) return cached
  const call: RunFoldCall =
    'kind' in root
      ? {
          callId: root.callId,
          toolName: root.call?.name ?? root.name,
          phase: 'result',
          argsRaw: root.call?.argsRaw,
          resultText: root.isError ? undefined : textOf(root.content),
          isError: root.isError,
        }
      : {
          callId: root.callId,
          toolName: root.name,
          phase: root.phase,
          argsRaw: root.phase === 'start' ? root.argsRaw : undefined,
          resultText: undefined,
          isError: false,
        }
  calls.set(root, call)
  return call
}

/** The first kind (in order) that claims the call; a throwing provider claims nothing. */
const kindOf = (call: RunFoldCall): RunFoldKind | undefined =>
  kinds.find(kind => {
    try {
      return kind.claims(call)
    } catch {
      return false
    }
  })

export const RunFoldKinds = {
  get: (): readonly RunFoldKind[] => kinds,
  set,
  subscribe,
  follow,
  callOf,
  kindOf,
} as const
