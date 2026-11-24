import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState } from 'react'
import type { JjIntegrationTranslate } from './locales.js'

/** A past moment in this plugin's words: "now", "5m ago", "3h ago"… */
export const activityLabel = (t: JjIntegrationTranslate, at: number, now: number): string => {
  const age = relativeTime(at, now)
  if (age.unit === 'now') return t('timeNow')
  if (age.unit === 'minutes') return t('timeMinutes', { n: age.n })
  if (age.unit === 'hours') return t('timeHours', { n: age.n })
  if (age.unit === 'days') return t('timeDays', { n: age.n })
  if (age.unit === 'months') return t('timeMonths', { n: age.n })
  return t('timeYears', { n: age.n })
}

/** Relative times stay honest while the page sits open. */
export const useMinuteTick = (): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
