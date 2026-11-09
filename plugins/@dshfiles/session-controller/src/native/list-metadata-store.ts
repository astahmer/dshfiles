/** Durable answers of the cold-row list metadata recovery, so a Host start does not re-stat and re-fold every log. */

import type { Context } from '@deepseek-ai/cordis'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

const recoveredEntrySchema = Schema.Struct({
  createdAt: Schema.Finite,
  /** `null` records a log past the draft size: a log only grows, so it is never statted again. */
  revision: Schema.NullOr(Schema.String),
  metadata: Schema.NullOr(Schema.Struct({ blank: Schema.Boolean, lastPromptAt: Schema.NullOr(Schema.Finite) })),
})

/** One cold row's recovery answer, bound to its header's `createdAt` and to the stored log's persistence revision. */
export type RecoveredListMetadata = typeof recoveredEntrySchema.Type

const decodeSnapshot = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const decodeEntry = Schema.decodeUnknownOption(recoveredEntrySchema)

/**
 * A `single`-layout domain: the whole map is one document, read once at open and rewritten once per recovery pass.
 * The domain accepts any value so a malformed snapshot never fails the open; entries are decoded here one by one.
 */
const domainSpec = {
  name: 'session_list_metadata',
  version: 1,
  tables: { snapshot: { valueSchema: zodSchemaFromEffect(Schema.Unknown) } },
}
const SNAPSHOT_KEY = 'entries'

const facilityOf = (ctx: Context) => ctx.get('storageDomain')
const openDomain = (facility: NonNullable<ReturnType<typeof facilityOf>>) => facility.open(domainSpec)
type SnapshotDomain = Awaited<ReturnType<typeof openDomain>>

export class ListMetadataStore {
  private opening: Promise<SnapshotDomain | undefined> | undefined
  private loading: Promise<Map<string, RecoveredListMetadata>> | undefined

  constructor(private readonly ctx: Context) {}

  /** The stored answers, opened on first use; an absent, unreadable or malformed store reads as empty. */
  load(): Promise<Map<string, RecoveredListMetadata>> {
    this.loading ??= this.domain().then((domain) => {
      const entries = new Map<string, RecoveredListMetadata>()
      const snapshot = decodeSnapshot(domain?.table('snapshot').get(SNAPSHOT_KEY))
      if (Option.isNone(snapshot)) return entries
      for (const [id, value] of Object.entries(snapshot.value)) {
        const entry = decodeEntry(value)
        if (Option.isSome(entry)) entries.set(id, entry.value)
      }
      return entries
    })
    return this.loading
  }

  async save(entries: ReadonlyMap<string, RecoveredListMetadata>): Promise<void> {
    const domain = await this.domain()
    if (domain === undefined) return
    try {
      await domain.table('snapshot').put(SNAPSHOT_KEY, Object.fromEntries(entries))
    } catch (error) {
      this.ctx.logger.warn(`api-session.list: list metadata answers were not saved: ${String(error)}`)
    }
  }

  async close(): Promise<void> {
    await (await this.opening)?.close()
  }

  private domain(): Promise<SnapshotDomain | undefined> {
    this.opening ??= (async () => {
      let facility
      try {
        facility = facilityOf(this.ctx)
      } catch {
        return undefined
      }
      return facility === undefined ? undefined : openDomain(facility)
    })().catch((error: unknown) => {
      this.ctx.logger.warn(`api-session.list: list metadata answers are unavailable; recovering from the logs: ${String(error)}`)
      return undefined
    })
    return this.opening
  }
}
