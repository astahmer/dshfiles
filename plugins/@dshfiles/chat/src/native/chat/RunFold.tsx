/**
 * dshfiles (b:7rv2): consecutive background-job and subagent rows fold into one summary row. The summary lives in the
 * first member's seat, so the Turn's own fold still hides it with that seat; the other members hide through their own
 * seat while the run is collapsed. A failed member, or one that needs the user, is never hidden.
 */
import { createContext, memo, useCallback, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChevronDownIcon, ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { LiveElapsed, formatElapsed } from '@dshfiles/plugin-ui/components/live-elapsed'
import type { RunFoldCall, RunFoldKind, RunFoldMemberState, RunFoldRuntime } from '../../run-folds.ts'
import { RunFoldKinds } from '../../run-fold-kinds.ts'
import { RunFoldModel, type RunFoldGroup } from '../../run-fold-model.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'
import type { ChatFlowSlotProps } from '../contract/slots.ts'
import css from './RunFold.module.css'

/** What a flow hands its rows: the thread, the hooks providers read, and whether this view mode folds at all. */
export interface RunFoldScope {
  readonly sessionId: SessionId
  readonly runtime: RunFoldRuntime
  /** False in Verbose: every row stays open. */
  readonly enabled: boolean
}

export const RunFoldContext = createContext<RunFoldScope | null>(null)

/** A seat's place in a run; the head seat also renders the summary row. */
export interface RunFoldPlacement {
  readonly runKey: string
  readonly head: { readonly memberKeys: readonly string[] } | undefined
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-run state: expanded (the reader's choice, kept while the page lives) and the members shown while collapsed.

interface RunFoldEntry {
  readonly expanded: boolean
  readonly shown: ReadonlySet<string>
}

const COLLAPSED: RunFoldEntry = { expanded: false, shown: new Set() }
/** Runs remembered at most; the oldest choice goes first. */
const RUN_STATE_LIMIT = 500
const runs = new Map<string, RunFoldEntry>()
const runListeners = new Map<string, Set<() => void>>()

const readRun = (runKey: string): RunFoldEntry => runs.get(runKey) ?? COLLAPSED

const writeRun = (runKey: string, next: RunFoldEntry): void => {
  if (readRun(runKey) === next) return
  runs.delete(runKey)
  runs.set(runKey, next)
  if (runs.size > RUN_STATE_LIMIT) {
    const oldest = runs.keys().next().value
    if (oldest !== undefined) runs.delete(oldest)
  }
  for (const listener of runListeners.get(runKey) ?? []) listener()
}

const subscribeRun = (runKey: string, listener: () => void): (() => void) => {
  const set = runListeners.get(runKey) ?? new Set()
  set.add(listener)
  runListeners.set(runKey, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) runListeners.delete(runKey)
  }
}

const sameKeys = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => left.size === right.size && [...left].every(key => right.has(key))

export const RunFoldStore = {
  read: readRun,
  setExpanded: (runKey: string, expanded: boolean): void => {
    const entry = readRun(runKey)
    if (entry.expanded !== expanded) writeRun(runKey, { ...entry, expanded })
  },
  setShown: (runKey: string, shown: ReadonlySet<string>): void => {
    const entry = readRun(runKey)
    if (!sameKeys(entry.shown, shown)) writeRun(runKey, { ...entry, shown })
  },
  subscribe: subscribeRun,
} as const

const useRun = (runKey: string): RunFoldEntry =>
  useSyncExternalStore(
    useCallback(listener => subscribeRun(runKey, listener), [runKey]),
    () => readRun(runKey),
  )

// ---------------------------------------------------------------------------------------------------------------------
// Layout: which rows of a list form runs.

const useKinds = (): readonly RunFoldKind[] => useSyncExternalStore(RunFoldKinds.subscribe, RunFoldKinds.get)

const callOfNode = (nodeStore: ChatNodeStore, key: string): RunFoldCall | undefined => {
  const node = nodeStore.get(key)
  // SAFETY: the kind discriminant names the data shape; the store's node type does not narrow on it.
  return node?.kind === 'tool-call' ? RunFoldKinds.callOf((node as ChatNode<'tool-call'>).data.root) : undefined
}

/** Subscribe to the given tool rows and read one string derived from them, so unrelated updates do not re-render. */
const useToolRowsSignature = (nodeStore: ChatNodeStore, keys: readonly string[], read: () => string): string => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = keys.map(key => nodeStore.source(key).subscribe(listener))
      unsubscribes.push(RunFoldKinds.subscribe(listener))
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
    [nodeStore, keys],
  )
  return useSyncExternalStore(subscribe, read)
}

const SEPARATOR = '\n'
const NO_PLACEMENTS: readonly (RunFoldPlacement | undefined)[] = []

/**
 * Place every row of a list: undefined for a row outside any run, else its run and, for the first row, the summary.
 * @param nodeStore - the flow's node reader.
 * @param keys - the list's rows in order; undefined for a row that is not a single node (a group) and breaks a run.
 */
export function useRunFoldPlacements(nodeStore: ChatNodeStore, keys: readonly (string | undefined)[]): readonly (RunFoldPlacement | undefined)[] {
  const scope = useContext(RunFoldContext)
  const kinds = useKinds()
  const enabled = scope !== null && scope.enabled && kinds.length > 0
  const toolKeys = useMemo(
    () => (enabled ? keys.filter((key): key is string => key !== undefined && nodeStore.get(key)?.kind === 'tool-call') : []),
    [enabled, keys, nodeStore],
  )
  const read = useCallback(
    () =>
      enabled
        ? keys
            .map(key => {
              const call = key === undefined ? undefined : callOfNode(nodeStore, key)
              return call === undefined ? '' : (RunFoldKinds.kindOf(call)?.id ?? '')
            })
            .join(SEPARATOR)
        : '',
    [enabled, keys, nodeStore],
  )
  const signature = useToolRowsSignature(nodeStore, toolKeys, read)
  const sessionId = scope?.sessionId
  return useMemo(() => {
    if (!enabled || signature === '' || sessionId === undefined) return NO_PLACEMENTS
    const claimed = signature.split(SEPARATOR).map(kind => (kind === '' ? undefined : kind))
    const placements: (RunFoldPlacement | undefined)[] = keys.map(() => undefined)
    for (const run of RunFoldModel.partition(claimed, true)) {
      const memberKeys = keys.slice(run.start, run.end).filter((key): key is string => key !== undefined)
      const first = memberKeys[0]
      if (first === undefined) continue
      const runKey = `${sessionId}${SEPARATOR}${first}`
      placements[run.start] = { runKey, head: { memberKeys } }
      for (let index = run.start + 1; index < run.end; index += 1) placements[index] = { runKey, head: undefined }
    }
    return placements
  }, [enabled, signature, sessionId, keys])
}

/**
 * Whether a seat hides because its run is collapsed. The head seat never hides through this: it holds the summary
 * row, and its own content hides inside it.
 */
export function useRunFoldHidden(placement: RunFoldPlacement | undefined, nodeKey: string): boolean {
  const entry = useRun(placement?.runKey ?? '')
  if (placement === undefined) return false
  return RunFoldModel.memberHidden({ expanded: entry.expanded, problem: entry.shown.has(nodeKey) })
}

/** Expand the run a seat belongs to (find-in-thread and focus reveal a hidden member through this). */
export const revealRun = (placement: RunFoldPlacement | undefined): void => {
  if (placement !== undefined) RunFoldStore.setExpanded(placement.runKey, true)
}

// ---------------------------------------------------------------------------------------------------------------------
// The summary row.

interface Member {
  readonly key: string
  readonly call: RunFoldCall
  readonly kind: RunFoldKind
}

type ChatT = ChatFlowSlotProps['t']

/** One kind's live states; a hook because `useStates` is the provider's hook. */
const useKindStates = (kind: RunFoldKind, members: readonly Member[], scope: RunFoldScope): readonly RunFoldMemberState[] => {
  const calls = useMemo(() => members.map(member => member.call), [members])
  return kind.useStates({ sessionId: scope.sessionId, calls, runtime: scope.runtime })
}

const KindStates = (props: {
  readonly kind: RunFoldKind
  readonly members: readonly Member[]
  readonly scope: RunFoldScope
  readonly children: (states: readonly RunFoldMemberState[], text: RunFoldGroup['text']) => ReactNode
}): ReactNode => {
  const states = useKindStates(props.kind, props.members, props.scope)
  const text = props.kind.useText()
  return props.children(states, text)
}

interface KindResult {
  readonly kind: RunFoldKind
  readonly members: readonly Member[]
  readonly states: readonly RunFoldMemberState[]
  readonly text: RunFoldGroup['text']
}

/** Collect every kind's states through nested components, so each provider hook keeps a fixed call position. */
const Collect = (props: {
  readonly groups: readonly { readonly kind: RunFoldKind; readonly members: readonly Member[] }[]
  readonly scope: RunFoldScope
  readonly done: readonly KindResult[]
  readonly render: (results: readonly KindResult[]) => ReactNode
}): ReactNode => {
  const [next, ...rest] = props.groups
  if (next === undefined) return props.render(props.done)
  return (
    <KindStates kind={next.kind} members={next.members} scope={props.scope}>
      {(states, text) => <Collect groups={rest} scope={props.scope} done={[...props.done, { ...next, states, text }]} render={props.render} />}
    </KindStates>
  )
}

const SummaryRow = memo(function SummaryRow({ runKey, results, t }: { readonly runKey: string; readonly results: readonly KindResult[]; readonly t: ChatT }) {
  const entry = useRun(runKey)
  const problems = useMemo(() => {
    const keys = new Set<string>()
    for (const result of results)
      result.members.forEach((member, index) => {
        const state = result.states[index]
        if (state !== undefined && RunFoldModel.isProblem(state.status)) keys.add(member.key)
      })
    return keys
  }, [results])
  // Before paint, so a failed member never flashes hidden.
  useLayoutEffect(() => {
    RunFoldStore.setShown(runKey, problems)
  }, [runKey, problems])
  const states = results.flatMap(result => result.states)
  const counts = RunFoldModel.count(states)
  const parts = RunFoldModel.summary(
    results.map(result => ({ text: result.text, states: result.states })),
    { stopped: t('message.runFold.stopped'), failed: t('message.runFold.failed'), needsYou: t('message.runFold.needsYou') },
  )
  const longest = RunFoldModel.longest(states)
  const label = parts.map(part => part.text).join(' · ')
  const icons = results.map(result => result.kind)
  const expanded = entry.expanded
  return (
    <button
      type="button"
      className={css.row}
      aria-expanded={expanded}
      aria-label={label}
      data-run-fold=""
      data-run-fold-status={RunFoldModel.glyph(counts)}
      onClick={event => {
        event.currentTarget.focus()
        RunFoldStore.setExpanded(runKey, !expanded)
      }}
    >
      <span className={css.chevron} aria-hidden="true">
        {expanded ? <ChevronDownIcon size={14} strokeWidth={1.5} /> : <ChevronRightIcon size={14} strokeWidth={1.5} />}
      </span>
      {icons.map(kind => (
        <span key={kind.id} className={css.icon} aria-hidden="true">
          <kind.Icon className={css.iconSvg} />
        </span>
      ))}
      <span className={css.label} aria-hidden="true">
        {parts.map((part, index) => (
          <span key={`${String(index)}:${part.text}`} className={part.tone === 'plain' ? undefined : css[part.tone === 'failed' ? 'failed' : 'needsYou']}>
            {index === 0 ? '' : ' · '}
            {part.text}
          </span>
        ))}
        {longest === undefined ? null : (
          <span className={css.elapsed}>
            {' · '}
            {longest.kind === 'live' ? (
              <LiveElapsed since={longest.since} active format={elapsed => t('message.runFold.longest', { duration: elapsed })} />
            ) : (
              t('message.runFold.longest', { duration: formatElapsed(longest.ms) })
            )}
          </span>
        )}
      </span>
      <StatusGlyph status={RunFoldModel.glyph(counts)} decorative className={css.glyph} />
    </button>
  )
})

/** The summary row of one run, read from the members' current calls. */
export const RunFoldSummary = memo(function RunFoldSummary({
  runKey,
  memberKeys,
  nodeStore,
  t,
}: {
  readonly runKey: string
  readonly memberKeys: readonly string[]
  readonly nodeStore: ChatNodeStore
  readonly t: ChatT
}) {
  const scope = useContext(RunFoldContext)
  const read = useCallback(
    () =>
      memberKeys
        .map(key => {
          const call = callOfNode(nodeStore, key)
          const kind = call === undefined ? undefined : RunFoldKinds.kindOf(call)
          return call === undefined || kind === undefined ? '' : `${kind.id}\t${call.callId}\t${call.phase}\t${String(call.isError)}\t${call.resultText ?? ''}`
        })
        .join(SEPARATOR),
    [memberKeys, nodeStore],
  )
  const signature = useToolRowsSignature(nodeStore, memberKeys, read)
  const groups = useMemo(() => {
    void signature
    const members = memberKeys.flatMap((key): Member[] => {
      const call = callOfNode(nodeStore, key)
      const kind = call === undefined ? undefined : RunFoldKinds.kindOf(call)
      return call === undefined || kind === undefined ? [] : [{ key, call, kind }]
    })
    return RunFoldKinds.get().flatMap(kind => {
      const own = members.filter(member => member.kind === kind)
      return own.length === 0 ? [] : [{ kind, members: own }]
    })
  }, [signature, memberKeys, nodeStore])
  const render = useCallback((results: readonly KindResult[]) => <SummaryRow runKey={runKey} results={results} t={t} />, [runKey, t])
  if (scope === null || groups.length === 0) return null
  // A change in which kinds the run holds remounts the chain, so every provider hook keeps its position.
  return <Collect key={groups.map(group => group.kind.id).join(',')} groups={groups} scope={scope} done={[]} render={render} />
})
