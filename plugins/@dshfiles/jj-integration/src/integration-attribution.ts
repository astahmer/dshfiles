export interface AttributedIntegrationRecord {
  readonly at: number
  readonly sessionId?: string | undefined
}

/**
 * A land belongs in the conversation whose work it shipped. A forked Session inherits its parent's transcript and
 * keeps working in the parent's jj workspace, so that workspace keeps recording lands the fork never asked for: only
 * a land that existed when the conversation was cut, or one this Session asked for itself, reads there. A record
 * written before attribution existed has no owner, so a fork bounds it by its cut and a plain Session shows it.
 */
export class IntegrationAttribution {
  static readonly forSession = <Record extends AttributedIntegrationRecord>(input: {
    readonly records: readonly Record[]
    readonly sessionId: string | undefined
    readonly forkCutAt: number | undefined
  }): readonly Record[] => {
    if (input.sessionId === undefined) return input.records
    return input.records.filter(record => {
      if (input.forkCutAt !== undefined && record.at < input.forkCutAt) return true
      return record.sessionId === undefined ? input.forkCutAt === undefined : record.sessionId === input.sessionId
    })
  }
}
