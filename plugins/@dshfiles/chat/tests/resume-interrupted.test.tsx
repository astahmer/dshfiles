// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ResumeInterruptedAction, resumeAvailabilityRefetchInterval } from '../src/resume-interrupted.tsx'

afterEach(cleanup)

it('stops polling unavailable tasks and backs off checks for resumable tasks', () => {
  expect(resumeAvailabilityRefetchInterval(undefined)).toBe(false)
  expect(resumeAvailabilityRefetchInterval(false)).toBe(false)
  expect(resumeAvailabilityRefetchInterval(true)).toBe(30_000)
})

it('hides unavailable stopped tasks', async () => {
  render(
    <PluginQueryProvider>
      <ResumeInterruptedAction
        sessionId="old-task"
        seq={3}
        api={{ available: async () => ({ available: false }), resume: async () => ({ accepted: false }), retry: async () => ({ accepted: false }) }}
      />
    </PluginQueryProvider>,
  )
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
})

it('disables Resume while pending, reports errors, and hides after acceptance', async () => {
  let rejectRequest: ((reason: Error) => void) | undefined
  let attempts = 0
  const api = {
    available: async () => ({ available: true }),
    resume: async () => {
      attempts++
      if (attempts === 1)
        return new Promise<{ accepted: boolean }>((_resolve, reject) => {
          rejectRequest = reject
        })
      return { accepted: true }
    },
    retry: async () => ({ accepted: false }),
  }
  render(
    <PluginQueryProvider>
      <ResumeInterruptedAction sessionId="latest-task" seq={8} api={api} />
    </PluginQueryProvider>,
  )
  const resumeButton = await screen.findByRole('button', { name: 'Resume' })
  expect(resumeButton.getAttribute('data-variant')).toBe('default')
  fireEvent.click(resumeButton)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resuming…' }).hasAttribute('disabled')).toBe(true))
  expect(attempts).toBe(1)
  rejectRequest?.(new Error('offline'))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not resume')
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  expect(attempts).toBe(2)
})

it('offers Retry for a task that produced nothing and sends it to the retry verb, not resume', async () => {
  const calls: string[] = []
  const api = {
    available: async () => ({ available: true, action: 'retry' as const }),
    resume: async () => {
      calls.push('resume')
      return { accepted: true }
    },
    retry: async (input: { sessionId: string; seq: number }) => {
      calls.push(`retry ${input.sessionId} ${String(input.seq)}`)
      return { accepted: true }
    },
  }
  render(
    <PluginQueryProvider>
      <ResumeInterruptedAction sessionId="failed-task" seq={22} api={api} />
    </PluginQueryProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  expect(calls).toEqual(['retry failed-task 22'])
})

it('keeps Resume when an older Host reports no action', async () => {
  render(
    <PluginQueryProvider>
      <ResumeInterruptedAction
        sessionId="old-host"
        seq={4}
        api={{ available: async () => ({ available: true }), resume: async () => ({ accepted: true }), retry: async () => ({ accepted: false }) }}
      />
    </PluginQueryProvider>,
  )
  expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy()
})
