/**
 * Kinds of transcript rows that fold into one summary row when two or more stand next to each other (b:7rv2): a run of
 * background-job starts reads "3 background jobs · 2 running · 1 done · longest 4m 10s" instead of three cards. Chat
 * owns the row, the grouping and the expanded state; a provider only says which calls are its kind and what state each
 * is in. Published as the `@dshfiles/chat/run-folds` dshx module; without providers nothing folds.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UseSessions, UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

/** The fields of one root tool call a provider classifies by; they change only as the call moves through its phases. */
export interface RunFoldCall {
  readonly callId: string
  readonly toolName: string
  readonly phase: 'preparing' | 'start' | 'result'
  /** Raw JSON arguments once the call is dispatched. */
  readonly argsRaw: string | undefined
  /** Text of a successful result; undefined before the result or for an error result. */
  readonly resultText: string | undefined
  readonly isError: boolean
}

/**
 * A member's state, on the StatusGlyph vocabulary. `failed` and `needs-you` are problems: such a member always stays
 * visible as its own row outside the fold, like a failed tool call outside "Worked for".
 */
export type RunFoldStatus = 'working' | 'done' | 'stopped' | 'failed' | 'needs-you'

export interface RunFoldMemberState {
  readonly status: RunFoldStatus
  /** Browser clock, epoch ms, when known; feeds the summary's "longest" time. */
  readonly startedAt?: number
  readonly finishedAt?: number
}

/** The selector hooks every Chat flow already holds, handed to providers so they need no slot of their own. */
export interface RunFoldRuntime {
  readonly useSessionStatus: UseSessionStatus
  readonly useSessions: UseSessions
}

export interface RunFoldStatesInput {
  /** The thread whose transcript holds the calls. */
  readonly sessionId: SessionId
  /** The run's calls of this kind, in transcript order. */
  readonly calls: readonly RunFoldCall[]
  readonly runtime: RunFoldRuntime
}

/** Words of one kind, in the provider's own locale. */
export interface RunFoldText {
  /** The count with its noun: "1 background job", "3 background jobs". */
  readonly count: (count: number) => string
  /** The live state word: "running" for a job, "working" for a subagent. */
  readonly active: string
  /** The settled state word: "done" for a job, "finished" for a subagent. */
  readonly done: string
}

export interface RunFoldKind {
  /** Stable id; a run of one kind folds as that kind, a run of several kinds as one combined row. */
  readonly id: string
  /** Lower first in a combined row; ties keep registration order. */
  readonly order?: number
  readonly Icon: ComponentType<{ readonly className?: string | undefined }>
  /** Whether a call belongs to this kind. Pure and cheap: Chat calls it for every tool row it lays out. */
  readonly claims: (call: RunFoldCall) => boolean
  /**
   * Live state of the given calls, one entry per call in order. A hook: subscribe inside it, and return the same array
   * while nothing changed, so ticking output does not re-render the transcript.
   */
  readonly useStates: (input: RunFoldStatesInput) => readonly RunFoldMemberState[]
  /** A hook returning this kind's words. */
  readonly useText: () => RunFoldText
}

export const TranscriptRunFolds = defineRegistry<RunFoldKind>('@dshfiles/chat.transcript-run-fold')
