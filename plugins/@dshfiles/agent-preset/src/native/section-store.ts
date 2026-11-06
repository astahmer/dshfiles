/** Preset roster, the new-task default and the read-only composition viewer for the settings section. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { AGENT_PRESET_SETTINGS_NS, listRoster, requiresCodingTools, writeDefaultPreset } from './settings-store.ts'

/** The read-only composition viewer over one preset. */
export interface PresetView {
  /** The preset being read. */
  id: string
  /** Display name the preset published, or its id. */
  title: string
  /** The declared child plugin list as YAML. */
  content: string
}

/** The roster read: never asked, in flight, read, or failed. */
export type PresetRoster =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'error'; readonly error: string }

/** The section's last write: nothing yet, in flight, or the refusal it reported. */
export type PresetSave =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'error'; readonly error: string }

/** The composition viewer: closed, open on one preset, or the refusal it reported. */
export type PresetViewer =
  | { readonly status: 'closed' }
  | { readonly status: 'open'; readonly view: PresetView }
  | { readonly status: 'error'; readonly error: string }

/** Fields every roster phase carries. */
interface PresetSectionFields {
  /** Rows of the last successful read; a later read or failure keeps them on screen. */
  readonly rows: readonly AgentPresetRow[]
  readonly save: PresetSave
  readonly viewer: PresetViewer
}

/** Settings page state. */
export type AgentPresetSectionState =
  | ({ readonly status: 'idle' } & PresetSectionFields)
  | ({ readonly status: 'loading' } & PresetSectionFields)
  | ({ readonly status: 'ready' } & PresetSectionFields)
  | ({ readonly status: 'error'; readonly error: string } & PresetSectionFields)

const INITIAL: AgentPresetSectionState = { status: 'idle', rows: [], save: { status: 'idle' }, viewer: { status: 'closed' } }
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** The roster phase is the only field this merge changes, so no phase can keep another one's error. */
const withRoster = (input: {
  readonly current: AgentPresetSectionState
  readonly roster: PresetRoster
  readonly rows?: readonly AgentPresetRow[]
}): AgentPresetSectionState => ({
  ...input.roster,
  rows: input.rows ?? input.current.rows,
  save: input.current.save,
  viewer: input.current.viewer,
})

const withSave = (input: { readonly current: AgentPresetSectionState; readonly save: PresetSave }): AgentPresetSectionState => ({
  ...input.current,
  save: input.save,
})

const withViewer = (input: { readonly current: AgentPresetSectionState; readonly viewer: PresetViewer }): AgentPresetSectionState => ({
  ...input.current,
  viewer: input.viewer,
})

/** Loads the roster, writes the default, and reads one composition at a time. */
export class AgentPresetSectionController {
  /** Observable roster, save outcome and viewer state. */
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)
  private loading: Promise<void> | undefined
  /** Writes run one after the other, so a reconcile that arrives mid-save still lands after it. */
  private saveChain: Promise<void> = Promise.resolve()
  private viewRequest = 0
  constructor(private readonly ctx: Context) {}

  private setRoster(input: { readonly roster: PresetRoster; readonly rows?: readonly AgentPresetRow[] }): void {
    this.store.set(withRoster({ current: this.store.getSnapshot(), ...input }))
  }
  private setSave(save: PresetSave): void { this.store.set(withSave({ current: this.store.getSnapshot(), save })) }
  private setViewer(viewer: PresetViewer): void { this.store.set(withViewer({ current: this.store.getSnapshot(), viewer })) }

  /** Refresh the roster; concurrent calls share one read.
   * @returns Once the roster read settles.
   */
  load(): Promise<void> {
    return this.loading ??= this.readRoster().finally(() => { this.loading = undefined })
  }
  private async readRoster(): Promise<void> {
    if (this.store.getSnapshot().status === 'idle') this.setRoster({ roster: { status: 'loading' } })
    try {
      const result = await listRoster(this.ctx)
      if (!result.ok) throw new Error(result.error.message)
      this.setRoster({ roster: { status: 'ready' }, rows: result.value.presets })
    } catch (error) { this.setRoster({ roster: { status: 'error', error: message(error) } }) }
  }

  /** Open one preset's declared composition in the viewer.
   * @param id Preset to read.
   * @returns Once the read settles; a current failure lands in the viewer, while a read superseded by close or another read is ignored.
   */
  async view(id: string): Promise<void> {
    const request = ++this.viewRequest
    this.setViewer({ status: 'closed' })
    try {
      const result = await this.ctx.remote.agentPresets.read(id)
      if (request !== this.viewRequest) return
      if (!result.ok) throw new Error(result.error.message)
      const { name, content } = result.value
      this.setViewer({ status: 'open', view: { id, title: name ?? id, content } })
    } catch (error) {
      if (request === this.viewRequest) this.setViewer({ status: 'error', error: message(error) })
    }
  }
  /** Close the viewer. */
  closeView(): void {
    this.viewRequest++
    this.setViewer({ status: 'closed' })
  }

  /** Set the default and synchronize the current blank task when supplied.
   * @param id Selected default.
   * @param sync Blank-session synchronization callback.
   * @returns Once saved and refreshed.
   */
  async makeDefault(id: string, sync?: (id: string) => Promise<string | undefined>): Promise<void> {
    await this.save(() => writeDefaultPreset(this.ctx, id), sync)
  }

  /** Replace a hidden built-in default after accepted Coding Tools changes.
   * @param shouldReset Rechecked after waiting; false when tools are enabled or this owner is disposed.
   * @returns Once the conditional save settles; errors remain visible in the section.
   */
  async reconcileCodingTools(shouldReset: () => boolean): Promise<void> {
    await this.saveChain
    if (!shouldReset()) return
    const settings = this.ctx.configForms.get(AGENT_PRESET_SETTINGS_NS).getSnapshot()
    if (settings.status !== 'ready' || !settings.writable || settings.revision === undefined) return
    await this.load()
    if (!shouldReset() || this.store.getSnapshot().status !== 'ready') return
    const rows = this.store.getSnapshot().rows
    if (!requiresCodingTools(rows.find(row => row.isDefault))) return
    if (!rows.some(row => row.id === 'standard' && row.broken === undefined)) {
      this.setSave({ status: 'error', error: this.ctx.locale.bind('settings.agentPreset')('standardUnavailable') })
      return
    }
    await this.save(() => writeDefaultPreset(this.ctx, 'standard', settings.revision))
  }

  private save(write: () => Promise<string | undefined>, sync?: (id: string) => Promise<string | undefined>): Promise<void> {
    const run = async (): Promise<void> => {
      this.setSave({ status: 'saving' })
      try {
        const error = await write()
        await this.load()
        if (error !== undefined) throw new Error(error)
        const selected = this.store.getSnapshot().rows.find(row => row.isDefault)
        if (selected !== undefined) {
          const syncError = await sync?.(selected.id)
          if (syncError !== undefined) throw new Error(syncError)
        }
        this.setSave({ status: 'idle' })
      } catch (error) { this.setSave({ status: 'error', error: message(error) }) }
    }
    const queued = this.saveChain.then(run)
    this.saveChain = queued.catch(() => undefined)
    return queued
  }
}
