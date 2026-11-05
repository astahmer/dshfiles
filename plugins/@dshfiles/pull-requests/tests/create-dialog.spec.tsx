// @vitest-environment jsdom
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatePullRequestDialog, type CreateDialogApi, type Translate } from '../src/create-dialog.js'
import { CreateModel, type PullRequestCreateInput, type PullRequestCreatePreview } from '../src/create-model.js'

const t: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`)
const HEAD = 'a'.repeat(40)

const preview = (overrides: Partial<PullRequestCreatePreview> = {}): PullRequestCreatePreview => ({
  status: 'ready',
  sessionId: 'session-dialog',
  cwd: '/work/widget',
  repo: 'acme/widget',
  remote: 'origin',
  base: 'main',
  bookmark: 'dsh/widget-sprockets',
  bookmarkExists: false,
  headCommitId: HEAD,
  commits: [{ changeId: 'kkkkkkkkkkkk', commitId: HEAD, summary: 'feat(widget): add sprockets', described: true, conflicted: false }],
  title: 'Add sprockets to the widget',
  body: 'The widget now spins sprockets.',
  generation: { source: 'model', note: 'test-provider/test-model' },
  existingUrl: null,
  problems: [],
  ...overrides,
})

// The plugin Query client is shared, so each test previews its own thread.
const mount = (sessionId: string, api: CreateDialogApi, onClose = vi.fn()) =>
  render(
    <PluginQueryProvider>
      <CreatePullRequestDialog sessionId={sessionId} threadTitle="Widget sprockets" api={api} t={t} onClose={onClose} />
    </PluginQueryProvider>,
  )

// Radix's Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(cleanup)

describe('create pull request dialog', () => {
  it('previews the draft, lets the user edit it, and confirms the create with the previewed head commit', async () => {
    const created: PullRequestCreateInput[] = []
    const api: CreateDialogApi = {
      preview: async () => preview(),
      create: async input => {
        created.push(input)
        return {
          status: 'created',
          opened: true,
          url: 'https://github.com/acme/widget/pull/7',
          link: {
            sessionId: 'session-dialog',
            repo: 'acme/widget',
            number: 7,
            url: 'https://github.com/acme/widget/pull/7',
            watching: true,
            lastKnownState: null,
            lastCheckedAt: null,
            lastError: null,
          },
        }
      },
    }
    mount('session-dialog-create', api)
    const title = await screen.findByDisplayValue('Add sprockets to the widget')
    expect(screen.getByText('feat(widget): add sprockets')).toBeTruthy()
    expect(screen.getByTestId('dshfiles-pull-request-create-generation').textContent).toContain('test-provider/test-model')
    fireEvent.change(title, { target: { value: 'Add sprockets' } })
    fireEvent.click(screen.getByTestId('dshfiles-pull-request-create-confirm'))
    await screen.findByTestId('dshfiles-pull-request-create-result')
    expect(created).toEqual([
      {
        sessionId: 'session-dialog',
        cwd: '/work/widget',
        confirm: true,
        title: 'Add sprockets',
        body: 'The widget now spins sprockets.',
        bookmark: 'dsh/widget-sprockets',
        base: 'main',
        headCommitId: HEAD,
        draft: false,
      },
    ])
    expect(screen.getByText('openOnGitHub').closest('a')?.getAttribute('href')).toBe('https://github.com/acme/widget/pull/7')
  })

  it('shows every blocker with its recovery and keeps confirm disabled', async () => {
    const create = vi.fn()
    mount('session-dialog-blocked', {
      preview: async () =>
        preview({ status: 'blocked', problems: [CreateModel.problem('gh-unauthenticated', 'The GitHub CLI is not signed in to github.com.')] }),
      create,
    })
    const problems = await screen.findByTestId('dshfiles-pull-request-create-problems')
    expect(problems.textContent).toContain('gh auth login')
    const confirm = screen.getByTestId('dshfiles-pull-request-create-confirm')
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(confirm)
    await waitFor(() => expect(create).not.toHaveBeenCalled())
  })

  it('shows the failed stage and recovery when the push is rejected', async () => {
    mount('session-dialog-rejected', {
      preview: async () => preview(),
      create: async () => ({
        status: 'failed',
        stage: 'push',
        message: 'jj git push failed: stale info',
        recovery: 'Run `jj git fetch`, rebase the thread onto it, then retry.',
        problems: [],
        pushed: false,
      }),
    })
    fireEvent.click(await screen.findByTestId('dshfiles-pull-request-create-confirm'))
    const failure = await screen.findByTestId('dshfiles-pull-request-create-failure')
    expect(failure.textContent).toContain('jj git fetch')
  })
})
