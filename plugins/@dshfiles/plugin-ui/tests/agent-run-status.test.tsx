// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRunStatus } from '../src/components/motion/agent-run-status.js'

afterEach(cleanup)

const steps = [
  { id: 'read', label: 'Reading 12 files', startedAt: 1_000, endedAt: 4_000 },
  { id: 'test', label: 'Running focused tests', startedAt: 4_000 },
]

describe('AgentRunStatus', () => {
  it('counts the step against the total when the run knows it', () => {
    render(
      <AgentRunStatus
        heading="Fix the flaky test"
        model="openai/gpt-6.1-luna"
        steps={steps}
        totalSteps={6}
        startedAt={1_000}
        state="running"
        onOpen={() => undefined}
      />,
    )
    const rail = screen.getByRole('progressbar')
    expect(rail.getAttribute('aria-valuemax')).toBe('6')
    expect(screen.getByText(/Step/).textContent).toContain('of 6')
  })

  it('counts the position a live feed reports without listing every step', () => {
    render(<AgentRunStatus heading="Review" steps={[steps[1]!]} stepIndex={3} startedAt={1_000} state="running" onOpen={() => undefined} />)
    expect(screen.getByText(/Step/).textContent).toContain('Step 3')
  })

  it('drops the target and the rail when the total is unknown', () => {
    render(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} state="running" onOpen={() => undefined} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText(/Step/).textContent).not.toContain('of')
    expect(screen.getByText('Running focused tests')).not.toBeNull()
  })

  it('renders only the actions whose handler exists, never a disabled stand-in', () => {
    render(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} state="running" onOpen={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.getByRole('button', { name: /Open run/ })).not.toBeNull()
  })

  it('keeps no footer at all without an action', () => {
    render(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} state="running" />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders the header chevron only when the caller can collapse the card', () => {
    const onCollapse = vi.fn()
    const { rerender } = render(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} state="running" onCollapse={onCollapse} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(onCollapse).toHaveBeenCalledOnce()
    rerender(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} state="running" />)
    expect(screen.queryByRole('button', { name: 'Collapse' })).toBeNull()
  })

  it('takes the visible strings from its caller', () => {
    render(
      <AgentRunStatus
        heading="Review"
        steps={steps}
        startedAt={1_000}
        state="running"
        labels={{ running: 'Working', step: '步骤', elapsed: '已用时间' }}
        onOpen={() => undefined}
      />,
    )
    expect(screen.getByText('Working')).not.toBeNull()
    expect(screen.getByText(/步骤/)).not.toBeNull()
  })

  it('says a run is Working and Done, never Running or Completed', () => {
    const { rerender } = render(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} state="running" />)
    expect(screen.getByText('Working')).not.toBeNull()
    expect(screen.queryByText('Running')).toBeNull()
    rerender(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} endedAt={9_000} state="done" />)
    expect(screen.getByText('Done')).not.toBeNull()
    expect(screen.queryByText('Completed')).toBeNull()
  })

  it('marks the run with the kit status glyph, not an amber asterisk', () => {
    const { container, rerender } = render(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} state="running" />)
    expect(container.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('working')
    expect(container.querySelector('.dshx\\:text-chart-3')).toBeNull()
    rerender(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} endedAt={9_000} state="done" />)
    expect(container.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('done')
  })

  it('shows the clock in the kit duration grammar', () => {
    render(<AgentRunStatus heading="Review" steps={steps} startedAt={1_000} endedAt={126_000} state="done" />)
    expect(screen.getByLabelText('Elapsed').textContent).toBe('2m 05s')
  })
})
