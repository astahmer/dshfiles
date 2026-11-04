import { Cause } from 'effect'

const MAX_LOGGED_REPORT = 4000

/** `Cause.pretty`, bounded, for the Host log only: never sent to a caller. */
export const causeReport = (cause: Cause.Cause<unknown>): string => Cause.pretty(cause).slice(0, MAX_LOGGED_REPORT)
