import { useEffect, useState } from 'react'

/**
 * The current time, ticking once a second while `active`. Kept local rather than in `@dshfiles/plugin-ui` until a
 * second plugin needs a live timer (the plan's `LiveTimer` row).
 */
export const useNow = (active: boolean, intervalMs = 1000): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return active ? now : Date.now()
}
