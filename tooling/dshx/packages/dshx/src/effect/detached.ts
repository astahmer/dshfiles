import { Context, Effect, Tracer } from 'effect'

// SAFETY: ParentSpan is a tracing reference, never a service a caller declares in R, so dropping it keeps Context<R>.
const withoutParentSpan = <R>(context: Context.Context<R>): Context.Context<R> => Context.omit(Tracer.ParentSpan)(context) as Context.Context<R>

/**
 * Run `effect` without the span that is current while it is captured. Callbacks, event handlers, tools and
 * workers captured while the plugin layer builds would otherwise parent every later run to the ended
 * `plugin activate` span: one endless trace, and none at all when that span was unsampled.
 */
export const detached = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.updateContext(effect, withoutParentSpan<R>)

/** The current services without the current span, for a runtime that runs work later. */
export const detachedContext = <R>(): Effect.Effect<Context.Context<R>, never, R> => Effect.map(Effect.context<R>(), withoutParentSpan)
