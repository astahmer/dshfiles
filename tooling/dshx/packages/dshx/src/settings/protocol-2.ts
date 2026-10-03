/** DSH 0.2 Settings adapter for the DSHX Host authoring API. */
import type { SettingsForms } from '@deepseek-ai/dsh-settings'

/** Namespace-scoped façade over DSH's shared SettingsForms service. */
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
