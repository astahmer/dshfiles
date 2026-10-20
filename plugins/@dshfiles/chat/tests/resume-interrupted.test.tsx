// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ResumeInterruptedAction } from '../src/resume-interrupted.tsx'

afterEach(cleanup)

it('hides unavailable stopped tasks', async () => {
  render(
    <PluginQueryProvider>
      <ResumeInterruptedAction
        sessionId="old-task"
        seq={3}
        api={{ available: async () => ({ available: false }), resume: async () => ({ accepted: false }) }}
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
  }
  render(
    <PluginQueryProvider>
      <ResumeInterruptedAction sessionId="latest-task" seq={8} api={api} />
    </PluginQueryProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resuming…' }).hasAttribute('disabled')).toBe(true))
  expect(attempts).toBe(1)
  rejectRequest?.(new Error('offline'))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not resume')
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  expect(attempts).toBe(2)
})
