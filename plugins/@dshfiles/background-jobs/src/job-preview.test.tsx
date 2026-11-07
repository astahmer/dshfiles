// @vitest-environment jsdom
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { ToolCallSectionProps } from '@dshfiles/tool-meta/tool-call-sections'
import { Profiler, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobsClient } from './job-preview-model.js'
import { JobPreviewSection } from './job-preview.js'

const kill = vi.hoisted(() => vi.fn(async ({ jobId }: { readonly jobId: string }) => ({ jobId, outcome: 'requested' as const })))
vi.mock('@dshfiles/dshx/client', async original => ({
  ...(await original<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => ({ kill }),
}))

afterEach(() => {
  cleanup()
  kill.mockClear()
})

const JOB_ID = 'bash-1a2b'
const SESSION = 'session-1'
const STARTED_AT = 1_000
type JobsSnapshot = ReturnType<JobsClient['state']['getSnapshot']>

// SAFETY: fixture rows carry only what the card reads; no registry validates the brands.
const row = (overrides: Partial<JobView> = {}): JobView =>
  ({ id: JOB_ID, kind: 'bash', label: 'pnpm build', status: 'running', owner: SESSION, startedAt: STARTED_AT, output: { total: 0, earliest: 0 }, ...overrides }) as JobView

const fakeJobs = (rows: readonly JobView[] = [row()]) => {
  let snapshot: JobsSnapshot = { rows: { [SESSION]: rows }, observed: {} }
  const listeners = new Set<() => void>()
  const observe = vi.fn(() => vi.fn())
  const watchRows = vi.fn(() => vi.fn())
  const jobs: JobsClient = {
    state: {
      getSnapshot: () => snapshot,
      subscribe: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    watchRows,
    observe,
  }
  const publish = (next: Partial<JobsSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }
  return { jobs, publish, observe, watchRows }
}

// SAFETY: the card reads only these fields of the native owner.
const owner = (input: { readonly text?: string; readonly expanded?: boolean; readonly toggle?: () => void; readonly toolName?: string }) =>
  ({
    phase: 'result',
    toolName: input.toolName ?? 'bash',
    block: { isError: false, content: [{ type: 'text', text: input.text ?? `started background job ${JOB_ID}` }] },
    useDisclosure: () => ({ expanded: input.expanded ?? false, toggle: input.toggle ?? (() => undefined) }),
  }) as unknown as ToolCallSectionProps['owner']

const translate = ((key: string, params?: Record<string, string>) => (params === undefined ? key : `${key} ${Object.values(params).join(' ')}`)) as never

const bindings = {
  t: translate,
  useThreadLabel: () => (id: string) => `Thread ${id}`,
  openThread: vi.fn(),
  openProcesses: vi.fn(),
}

const renderCard = (input: Parameters<typeof owner>[0], jobs = fakeJobs()) => {
  render(
    <PluginQueryProvider>
      <JobPreviewSection {...bindings} jobs={jobs.jobs} owner={owner(input)} sessionId={SESSION} />
    </PluginQueryProvider>,
  )
  return jobs
}

const card = () => document.querySelector('[data-dshfiles-live-preview="job"]')

describe('JobPreviewSection', () => {
  it('renders nothing for a call that started no job, or a job the registry no longer holds', () => {
    renderCard({ toolName: 'read' })
    expect(card()).toBeNull()
    renderCard({}, fakeJobs([]))
    expect(card()).toBeNull()
  })

  it('shows the job state and label, without streaming output while collapsed', () => {
    const { observe } = renderCard({})
    expect(card()?.getAttribute('data-state')).toBe('running')
    expect(screen.getByRole('status').textContent).toContain('statusRunning')
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(observe).not.toHaveBeenCalled()
  })

  it('streams output only while open and releases the stream on collapse', () => {
    const fake = fakeJobs()
    const stopStream = vi.fn()
    fake.observe.mockReturnValue(stopStream)
    const Toggle = () => {
      const [expanded, setExpanded] = useState(true)
      return (
        <PluginQueryProvider>
          <JobPreviewSection {...bindings} jobs={fake.jobs} owner={owner({ expanded, toggle: () => setExpanded(false) })} sessionId={SESSION} />
        </PluginQueryProvider>
      )
    }
    render(<Toggle />)
    expect(fake.observe).toHaveBeenCalledWith(SESSION, JOB_ID)
    act(() => fake.publish({ observed: { [JOB_ID]: { text: 'compiling', gapBefore: false } } }))
    expect(screen.getByText('compiling')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /previewToggle/ }))
    expect(stopStream).toHaveBeenCalledOnce()
  })

  it('does not re-render the transcript above it per output chunk, and the collapsed card ignores roster offsets', () => {
    const fake = fakeJobs()
    let parent = 0
    let section = 0
    const Transcript = () => {
      parent += 1
      return (
        <Profiler id="section" onRender={() => (section += 1)}>
          <PluginQueryProvider>
            <JobPreviewSection {...bindings} jobs={fake.jobs} owner={owner({})} sessionId={SESSION} />
          </PluginQueryProvider>
        </Profiler>
      )
    }
    render(<Transcript />)
    const before = { parent, section }
    for (const total of [10, 20, 30]) act(() => fake.publish({ rows: { [SESSION]: [row({ output: { total, earliest: 0 } })] } }))
    expect({ parent, section }).toEqual(before)
    act(() => fake.publish({ rows: { [SESSION]: [row({ status: 'completed', finishedAt: STARTED_AT + 5_000 })] } }))
    expect(parent).toBe(before.parent)
    expect(section).toBe(before.section + 1)
    expect(card()?.getAttribute('data-state')).toBe('completed')
  })

  it('stops a job only after an explicit confirmation, which can be backed out of', async () => {
    renderCard({ expanded: true })
    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(kill).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'stopCancel' }))
    expect(screen.queryByRole('button', { name: 'stopConfirm' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'stopConfirm' }))
    await waitFor(() => expect(kill).toHaveBeenCalledWith({ jobId: JOB_ID, confirm: true }))
  })

  it('offers no Stop on a settled job', () => {
    renderCard({ expanded: true }, fakeJobs([row({ status: 'failed', detail: 'exit code: 3', finishedAt: Date.now() })]))
    expect(screen.queryByRole('button', { name: 'stop' })).toBeNull()
    expect(screen.getByText('exit code: 3')).toBeTruthy()
  })

  it('links a job owned by another thread to that thread', () => {
    renderCard({ expanded: true }, fakeJobs([row({ owner: 'session-2' as NonNullable<JobView['owner']> })]))
    fireEvent.click(screen.getByRole('button', { name: /previewThread/ }))
    expect(bindings.openThread).toHaveBeenCalledWith('session-2')
    expect(screen.queryByText('previewThisThread')).toBeNull()
  })

  it('names the current thread as owner without a link to itself', () => {
    renderCard({ expanded: true })
    expect(screen.getByText('previewThisThread')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /previewThread/ })).toBeNull()
  })
})
