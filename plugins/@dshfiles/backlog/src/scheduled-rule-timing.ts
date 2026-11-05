/** The schedule a one-click rule uses: every night at 02:00 in the browser's time zone. */
export const nightlyTiming = () => ({ kind: 'daily' as const, time: '02:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
