import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ToolMetaTranslate } from './locales.js'
import { WaitTimerIndicator } from './wait-timer-indicator.js'

const templates = new Map([
  ['seconds', '{n} s'],
  ['minutes', '{m} min {s} s'],
  ['hours', '{h} h {m} min'],
  ['waitElapsed', 'Waiting for {duration}'],
  ['waitingForJobOutput', 'Waiting for job output'],
  ['waitingForAllJobs', 'Waiting for all running background jobs to settle'],
  ['waitingForJob', 'Waiting for 1 background job to finish'],
  ['waitingForJobs', 'Waiting for {count} background jobs to finish'],
  ['waitingForAnyJobs', 'Waiting for any of {count} background jobs to finish'],
  ['waitRemaining', '{duration} until wait timeout'],
  ['waitProgress', 'Wait timeout countdown: {remaining} remaining of {timeout}'],
])
const t: ToolMetaTranslate = (key, params) => (templates.get(key) ?? key).replaceAll(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))

describe('WaitTimerIndicator', () => {
  it('shows elapsed and remaining time as a timeout progress bar', () => {
    render(
      <TooltipProvider>
        <WaitTimerIndicator
          timer={{ timeoutMs: 300_000, elapsedMs: 90_000, remainingMs: 210_000, waitingFor: { kind: 'jobs', count: 2, until: 'settled' } }}
          t={t}
        />
      </TooltipProvider>,
    )
    expect(screen.getByRole('progressbar', { name: 'Wait timeout countdown: 3 min 30 s remaining of 5 min 0 s' }).getAttribute('aria-valuenow')).toBe('90000')
    expect(screen.getByText('Waiting for 2 background jobs to finish')).toBeTruthy()
    expect(screen.getByText('3 min 30 s until wait timeout')).toBeTruthy()
  })

  it('shows elapsed time with an indeterminate bar when there is no timeout', () => {
    render(
      <TooltipProvider>
        <WaitTimerIndicator timer={{ timeoutMs: undefined, elapsedMs: 90_000, remainingMs: undefined, waitingFor: 'job-output' }} t={t} />
      </TooltipProvider>,
    )
    const bar = screen.getByRole('progressbar', { name: 'Waiting for 1 min 30 s' })
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(screen.getByText('Waiting for job output')).toBeTruthy()
    expect(screen.getByText('Waiting for 1 min 30 s')).toBeTruthy()
  })
})
