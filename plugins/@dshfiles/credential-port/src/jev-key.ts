/**
 * The one TypeSafe Jev key (plan `plans/ade-ux` §4.6, "Jev key once"). Settings › Tools & MCP › Jev stores a single
 * `secret:ALIAS` reference in settings-shell's namespace; backlog and memory used to keep one each. Every reader uses
 * the same rules, so the move loses nothing:
 *
 * - `reference`: the shared key wins; a plugin's earlier key is the fallback while the shared one is empty, then the
 *   caller's environment variable (through `SecretReferenceResolver`).
 * - `adopt`: once, a plugin copies its earlier key into the empty shared field. It never overwrites a non-empty shared
 *   value (it writes only against the revision it read empty), and it never clears the plugin's own field, so clearing
 *   the shared key goes back to exactly what each plugin had.
 */
import { Effect } from 'effect'

/** The slice of a settings service this module reads and writes (dshx `SettingsService` satisfies it). */
export interface SharedJevKeySettings {
  readonly snapshot: Effect.Effect<{ readonly value: { readonly jevSecret: string }; readonly revision: number }>
  readonly update: (patch: { readonly jevSecret: string }, expectedRevision?: number) => Effect.Effect<void, unknown>
}

export type JevKeyAdoption =
  /** The shared key was empty and took the plugin's earlier key. */
  | { readonly kind: 'adopted' }
  /** The shared key is set (or neither is): nothing to do. */
  | { readonly kind: 'kept' }
  /** The write was refused (another writer, settings unavailable); the plugin keeps reading its own key. */
  | { readonly kind: 'deferred'; readonly cause: unknown }

/** The reference text to resolve: the shared key, else the plugin's earlier key; empty means "use the environment". */
const reference = (input: { readonly shared: string; readonly legacy: string }): string => {
  const shared = input.shared.trim()
  return shared === '' ? input.legacy.trim() : shared
}

/** The value to copy into the shared field, or undefined when the shared key is set or there is nothing to copy. */
const adoption = (input: { readonly shared: string; readonly legacy: string }): string | undefined => {
  const legacy = input.legacy.trim()
  return input.shared.trim() === '' && legacy !== '' ? legacy : undefined
}

const adopt = (settings: SharedJevKeySettings, legacy: string): Effect.Effect<JevKeyAdoption> =>
  Effect.gen(function* () {
    const snapshot = yield* settings.snapshot
    const value = adoption({ shared: snapshot.value.jevSecret, legacy })
    if (value === undefined) return { kind: 'kept' } as const
    // Written against the revision that was read empty: a concurrent write (the other plugin's adoption, the user)
    // fails the revision check instead of being overwritten.
    return yield* settings.update({ jevSecret: value }, snapshot.revision).pipe(
      Effect.as({ kind: 'adopted' } as const),
      Effect.catch(cause => Effect.succeed({ kind: 'deferred', cause } as const)),
    )
  }).pipe(Effect.withSpan('jev key adopt'))

export class SharedJevKey {
  /** The settings-shell namespace and field that hold the one key. */
  static readonly namespace = 'dshfiles-settings-shell'
  static readonly field = 'jevSecret'
  static readonly reference = reference
  static readonly adoption = adoption
  static readonly adopt = adopt
}
