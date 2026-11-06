/**
 * Frozen pure-core contract: trigger detection and
 * menu reduction, zero React / DOM / cordis. Types only — implementations
 * live in sibling modules annotated with these
 * aliases; the service shell wires them to ctx.
 */
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerCandidate, TriggerChar, TriggerGuard, TriggerPosition } from '../types.js'

/** A detected trigger token under the caret. */
export interface TriggerHit {
  readonly trigger: TriggerChar
  /** Text between the trigger char and the caret, live-filtered. */
  readonly query: string
  /** True only for an open quoted `@file` token. */
  readonly quoted: boolean
  /** leading = draft trimmed (whitespace incl. newlines) starts with the token. */
  readonly position: TriggerPosition
  /** Token span; draftRev injected by the caller. */
  readonly span: TokenSpan
}

/**
 * Detect a trigger token at the caret under the given guard tier.
 * `@` uses the shared file-reference start/whitespace grammar; `/` accepts
 * punctuation boundaries with URL carve-outs. `user@host` and URL `/` do not
 * trigger.
 * Returns null when no trigger is live at the caret.
 */
export type DetectTrigger = (draft: string, caret: number, guard: TriggerGuard) => TriggerHit | null

/** Token identity a dismissal sticks to: the same trigger, query, and span bounds. */
export interface DismissedHit {
  readonly trigger: string
  readonly query: string
  readonly quoted: boolean
  readonly start: number
  readonly end: number
}

/** Menu state: one group per source; empty ready groups auto-close the menu. */
export interface MenuState {
  readonly open: boolean
  readonly hit: TriggerHit | null
  /** Monotonic per-hit generation; stale source settlements are dropped. */
  readonly generation: number
  /** Source opened through the programmatic launcher, or null for a typed menu. */
  readonly launcher: string | null
  /** Whether the menu was reached by a drill pick; cleared when the menu closes. */
  readonly drilled: boolean
  /**
   * Identity of the hit whose menu the user dismissed: "not this one, not now".
   * Survives the close, so restoring the caret cannot reopen that token, and is
   * cleared by typing or by moving to another token.
   */
  readonly dismissed: DismissedHit | null
  readonly groups: readonly {
    readonly source: string
    /** False when candidate section rows own all visible group labeling. */
    readonly showGroupTitle?: boolean
    readonly status: 'pending' | 'ready'
    readonly items: readonly InputTriggerCandidate[]
  }[]
  readonly highlight: { readonly source: string; readonly index: number } | null
}

/** Menu reduction events. Source failure = silent group removal (log only; no error UI tier). */
export type MenuEvent =
  | { readonly type: 'hit'; readonly hit: TriggerHit | null; readonly launcher?: string | null }
  | { readonly type: 'dismiss' }
  | { readonly type: 'dismissed-cleared' }
  | { readonly type: 'launcher-cleared' }
  | { readonly type: 'drilled'; readonly value: boolean }
  | { readonly type: 'source-settled'; readonly generation: number; readonly source: string; readonly items?: readonly InputTriggerCandidate[] }
  | { readonly type: 'source-failed'; readonly generation: number; readonly source: string }
  | { readonly type: 'move'; readonly dir: 1 | -1 }
  | { readonly type: 'hover'; readonly source: string; readonly index: number }
  | { readonly type: 'close' }

/** Pure menu reducer; returns the same reference when the event is stale or a no-op. */
export type MenuReduce = (state: MenuState, ev: MenuEvent) => MenuState

/**
 * Exact-name lookup in one source's ready group; null when absent or the
 * group is not ready.
 */
export type ExactMatch = (groups: MenuState['groups'], source: string, name: string) => InputTriggerCandidate | null
