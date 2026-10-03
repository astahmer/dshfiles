/**
 * Settings vocabulary that DSH 0.2 removed.
 *
 * `protocol-1` described a settings namespace as an object the owning plugin
 * registered (`SettingsProvider` / `SettingsScope.register()`). Protocol 2
 * inverts that: a namespace is a Loader entry id, and `ctx.settings` reads and
 * writes every registered section generically through `describe()` /
 * `update()`. These aliases keep the `defineSettings` author surface stable
 * across both generations instead of forcing a fork per protocol.
 */
import type { SettingsForms } from '@deepseek-ai/dsh-settings'

/**
 * The per-namespace handle `SettingsScope` used to be. A protocol-2 scope is
 * a thin façade over the shared `SettingsForms` service plus the Loader entry
 * id that identifies the namespace.
 */
export interface SettingsScope<Value extends object = Record<string, unknown>> {
  readonly namespace: string
  /** Actual scoped native service for advanced operations. */
  readonly raw: SettingsForms
  /** Read this native entry's resolved Host values. */
  get(): Value
  update(patch: Partial<Value>, expectedRevision?: number): Promise<void>
  replace(value: Value, expectedRevision?: number): Promise<void>
  /** Observe native form revisions; automatically removed with the owning fiber. */
  watch(listener: (value: Value, revision: number) => void): () => boolean
}
