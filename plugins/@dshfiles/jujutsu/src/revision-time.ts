import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'

const SUFFIX = { minutes: 'min', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

/**
 * The one time a revision's detail line shows: when it last changed, relative to now. The line printed "Created …,
 * Last edited …, Last rewritten …" as three absolute timestamps, usually the same one; those stay in the tooltip.
 */
const lastChanged = (
  revision: { readonly authorTime: string; readonly committerTime?: string | undefined },
  editedAt: string | undefined,
  now: number,
): { readonly dateTime: string; readonly text: string } => {
  const created = Date.parse(revision.authorTime)
  const candidates = [editedAt, revision.committerTime, revision.authorTime].filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
  const latest = candidates.reduce<string | undefined>((best, value) => (best === undefined || Date.parse(value) > Date.parse(best) ? value : best), undefined)
  if (latest === undefined) return { dateTime: revision.authorTime, text: 'Time unknown' }
  const verb = Number.isFinite(created) && Date.parse(latest) > created ? 'Changed' : 'Created'
  const age = relativeTime(Date.parse(latest), now)
  return { dateTime: latest, text: age.unit === 'now' ? `${verb} just now` : `${verb} ${String(age.n)} ${SUFFIX[age.unit]} ago` }
}

export class RevisionTime {
  static readonly lastChanged = lastChanged
}
