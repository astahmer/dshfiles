import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'

const RELATIVE_TIME_SUFFIX = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

const compact = (distance: ReturnType<typeof relativeTime>): string => (distance.unit === 'now' ? 'now' : `${distance.n}${RELATIVE_TIME_SUFFIX[distance.unit]}`)

/** Compact relative distance ("22h") for a moment that has already passed, shared by thread rows and thread notices. */
export const formatAge = (at: number, now: number = Date.now()): string => compact(relativeTime(at, now))

/** Compact relative distance ("2h") for a moment still ahead, so a notice can say what is left rather than when. */
export const formatRemaining = (deadline: number, now: number = Date.now()): string => compact(relativeTime(now, deadline))
