import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoadError } from '../src/components/load-error.js'
import { errorSentence, type ErrorSentenceInput } from '../src/lib/error-copy.js'

afterEach(cleanup)

/** What dshx's promise client throws (an `ApiError`), with the transport fields it now carries. */
const apiError = (fields: { kind: string; message: string; status?: number; endpoint?: string; remoteCode?: string }): Error =>
  Object.assign(new Error(fields.message), { name: 'ApiError', apiId: 'inbox', method: 'list', retryable: true, ...fields })

describe('errorSentence: the five classes (DESIGN.md Error copy)', () => {
  const table: ReadonlyArray<{ readonly name: string; readonly input: ErrorSentenceInput; readonly kind: string; readonly sentence: string }> = [
    {
      name: 'a fetch that never reached DSH',
      input: { subject: 'Inbox', error: new TypeError('Failed to fetch') },
      kind: 'unreachable',
      sentence: 'Could not reach DSH.',
    },
    {
      name: 'Safari wording of the same failure, with the kept draft',
      input: { subject: 'Message', error: new TypeError('Load failed'), kept: 'Your message is kept; send it again once DSH is back.' },
      kind: 'unreachable',
      sentence: 'Could not reach DSH. Your message is kept; send it again once DSH is back.',
    },
    {
      name: 'a dshx transport failure nothing answered',
      input: { subject: 'Inbox', error: apiError({ kind: 'transport', message: 'Failed to fetch', endpoint: 'dshx-inbox/list' }) },
      kind: 'unreachable',
      sentence: 'Could not reach DSH.',
    },
    {
      name: 'HTTP 500',
      input: { subject: 'Inbox', error: apiError({ kind: 'transport', message: 'transport failure for /api/dshx-inbox/list: HTTP 500', status: 500, endpoint: 'dshx-inbox/list' }) },
      kind: 'request',
      sentence: 'Inbox did not load (HTTP 500). Retry; if it repeats, check the DSH terminal.',
    },
    {
      name: 'a tunnel that answers 502 for DSH',
      input: { subject: 'Inbox', error: apiError({ kind: 'transport', message: 'transport failure for /api/dshx-inbox/list: HTTP 502', status: 502 }) },
      kind: 'unreachable',
      sentence: 'Could not reach DSH.',
    },
    {
      name: 'the owner plugin is not loaded (404)',
      input: {
        subject: 'Inbox',
        error: apiError({ kind: 'unavailable', message: '@dshfiles/activity-timeline is not loaded, so inbox.list is unavailable.', status: 404, remoteCode: 'owner-missing' }),
      },
      kind: 'missing',
      sentence: 'Inbox is not available: its plugin did not start. Open Settings › Plugins.',
    },
    {
      name: 'no account can run the model',
      input: { subject: 'Message', error: Object.assign(new Error('No API key configured for provider deepseek (set DEEPSEEK_API_KEY)'), { code: 'MISSING_CREDENTIAL' }) },
      kind: 'credential',
      sentence: 'No AI account can run this model. Connect an account, then send again.',
    },
    {
      name: "a provider's own sentence for a 4xx refusal",
      input: { subject: 'Message', error: Object.assign(new Error('The prompt is too long for this model.'), { status: 400 }) },
      kind: 'refused',
      sentence: 'The prompt is too long for this model.',
    },
    {
      name: 'a handler failure whose text is written for a developer',
      input: { subject: 'Inbox', error: apiError({ kind: 'remote', message: 'client api: dshx-inbox/list failed: ENOENT /Users/me/.dsh/inbox.db', remoteCode: 'internal' }) },
      kind: 'request',
      sentence: 'Inbox did not load. Retry; if it repeats, check the DSH terminal.',
    },
  ]

  const input = (name: string): ErrorSentenceInput => {
    const row = table.find(entry => entry.name === name)
    if (row === undefined) throw new Error(`no row ${name}`)
    return row.input
  }

  for (const row of table) {
    it(row.name, () => {
      const copy = errorSentence(row.input)
      expect(copy.kind).toBe(row.kind)
      expect(copy.sentence).toBe(row.sentence)
    })
  }

  it('never shows an endpoint, a route id, an environment variable or a path; the raw text goes to detail', () => {
    for (const row of table) {
      const copy = errorSentence(row.input)
      expect(copy.sentence).not.toMatch(/\/api\/|dshx-|client api:|[A-Z][A-Z0-9]+_[A-Z0-9_]+|\/Users\/|transport failure/u)
    }
    const http = errorSentence(input('HTTP 500'))
    expect(http.detail).toContain('transport failure for /api/dshx-inbox/list: HTTP 500')
  })

  it('lets Retry lead only where retrying can succeed', () => {
    expect(errorSentence(input('a fetch that never reached DSH')).retry).toBe('primary')
    expect(errorSentence(input('HTTP 500')).retry).toBe('primary')
    expect(errorSentence(input('the owner plugin is not loaded (404)')).retry).toBe('none')
    expect(errorSentence(input('no account can run the model')).retry).toBe('none')
    expect(errorSentence(input("a provider's own sentence for a 4xx refusal")).retry).toBe('secondary')
  })
})

describe('LoadError', () => {
  it('says what did not load, offers Retry, and keeps the cause under Details', () => {
    const onRetry = vi.fn()
    render(<LoadError subject="Inbox" error={apiError({ kind: 'transport', message: 'transport failure for /api/dshx-inbox/list: HTTP 500', status: 500 })} onRetry={onRetry} />)
    expect(screen.getByText('Inbox did not load (HTTP 500). Retry; if it repeats, check the DSH terminal.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    const details = screen.getByRole('button', { name: 'Details' })
    expect(screen.queryByText(/transport failure/u)).toBeNull()
    fireEvent.click(details)
    expect(screen.getByText(/transport failure for \/api\/dshx-inbox\/list: HTTP 500/u)).toBeTruthy()
  })

  it('takes its own sentence and actions for a destination whose plugin did not load', () => {
    render(
      <LoadError subject="Inbox" sentence="Inbox did not load. Reload the page; if it keeps failing, open Settings › Plugins." actions={<button type="button">Open Plugins</button>} />,
    )
    expect(screen.getByText('Inbox did not load. Reload the page; if it keeps failing, open Settings › Plugins.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Plugins' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
  })
})
