import type { Effect } from 'effect'

export type HtmlRenderEffectRunner = <Value, Failure>(effect: Effect.Effect<Value, Failure, never>, options: { readonly signal: AbortSignal }) => Promise<Value>
