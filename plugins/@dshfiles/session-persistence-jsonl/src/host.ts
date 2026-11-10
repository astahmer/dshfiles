/**
 * Loader row entry for the owned JSONL session-persistence fork: the vendored
 * plugin module exports `apply`/`name`/`Config` unchanged, so the row loads it
 * with the same `root` config as the stock row it replaces.
 * @module @dshfiles/session-persistence-jsonl
 */

export { apply, Config, name } from './native/index.ts'

/** The stock row declares no injections: the backend registers itself inside its own effect. */
export const inject: string[] = []
