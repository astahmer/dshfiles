// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type * as React from 'react'
import { RoutineList, type Routine } from '../src/components/motion/routine-list.js'
import { TooltipProvider } from '../src/components/ui/tooltip.js'

afterEach(cleanup)

const inProvider = (node: React.ReactNode) => render(<TooltipProvider>{node}</TooltipProvider>)

const routine: Routine = {
  id: 'nightly',
  name: 'Nightly triage',
  schedule: 'Weekdays at 9:00',
  enabled: true,
  running: true,
  history: [],
  sources: [{ label: 'Issues' }],
  destination: { label: 'Slack' },
}

describe('RoutineList labels', () => {
  it('says a running routine is Working by default, never Running now', () => {
    inProvider(<RoutineList routines={[routine]} />)
    expect(screen.queryByText('Running now')).toBeNull()
    expect(screen.getAllByText('Working').length).toBeGreaterThan(0)
  })

  it('takes the running label from its caller', () => {
    inProvider(<RoutineList routines={[routine]} labels={{ runningNow: '运行中' }} />)
    expect(screen.getByText('运行中')).not.toBeNull()
  })
})
