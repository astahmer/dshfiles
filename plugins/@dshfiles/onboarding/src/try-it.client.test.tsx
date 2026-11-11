// @vitest-environment jsdom
import { SessionId } from '@dshfiles/dshx/ids'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { GettingStartedPage } from './getting-started-page.js'
import { OnboardingOverview, type OverviewInput } from './overview-model.js'
import { PackPlan } from './pack-plan.js'
import type { OnScreenProject } from './on-screen-project.js'
import { ONBOARDING_DEFAULTS } from './settings.js'
import { TRY_IT_COST } from './try-it-dialog.js'
import type { TryItInput, TryItOutput } from './try-it-model.js'

afterEach(cleanup)

const FEATURE_TITLE = 'Get features suggested from what you already do'

const renderPage = (tryIt: boolean, project: OnScreenProject | null = null) => {
  const started: TryItInput[] = []
  const opened: string[] = []
  const startTryIt = async (input: TryItInput): Promise<TryItOutput> => {
    started.push(input)
    return { sessionId: Schema.decodeUnknownSync(SessionId)('session-demo'), title: 'Try it', prompt: 'accepted', promptError: null }
  }
  render(
    <PluginQueryProvider>
      <GettingStartedPage
        applyPack={async () => Promise.reject(new Error('not applied in these tests'))}
        copy={async () => true}
        loadOverview={async (request: OverviewInput) =>
          OnboardingOverview.overview({
            catalog: FEATURE_CATALOG,
            facts: null,
            states: PackPlan.statesOf([
              { entryId: 'include:dshfiles-traces', plugin: 'traces', moduleName: '@dshfiles/traces', enabled: true, readOnlyReason: null },
            ]),
            request: { ...request, query: request.query ?? 'suggested from what you already do' },
            curatedDefault: true,
            preview: null,
          })
        }
        loadSuggestions={async () => ({ state: 'ready', days: 30, suggestions: [] })}
        loadWhatsNew={async () => ({ state: 'no-checkout', reason: 'none', commitsUrl: 'https://github.com/astahmer/dshfiles/commits/main' })}
        openThread={sessionId => opened.push(sessionId)}
        project={project}
        routes={{
          hasPanel: () => false,
          openPanel: () => false,
          hasCommand: () => false,
          runCommand: () => false,
          hasSettings: () => true,
          openSettings: () => true,
        }}
        settings={{ ...ONBOARDING_DEFAULTS, tryIt }}
        showWhere={() => undefined}
        startTryIt={startTryIt}
        startWizard={() => undefined}
      />
    </PluginQueryProvider>,
  )
  return { started, opened }
}

const featureRow = async (): Promise<HTMLElement> => {
  const features = await screen.findByRole('list', { name: 'Features' })
  const title = await within(features).findByText(FEATURE_TITLE)
  const row = title.closest('li')
  if (row === null) throw new Error('no feature row')
  return row
}

describe('Try it', () => {
  it('is off by default: no Try it control on a feature row or a pack card', async () => {
    expect(ONBOARDING_DEFAULTS.tryIt).toBe(false)
    const page = renderPage(false)
    await featureRow()
    await screen.findByRole('region', { name: /^Packs/u })
    expect(screen.queryAllByRole('button', { name: /^Try it/u })).toEqual([])
    expect(page.started).toEqual([])
  })

  it('names the token cost before anything starts, and Cancel sends nothing', async () => {
    const page = renderPage(true)
    fireEvent.click(within(await featureRow()).getByRole('button', { name: `Try it: ${FEATURE_TITLE}` }))
    const dialog = await screen.findByRole('dialog', { name: `Try it: ${FEATURE_TITLE}` })
    expect(within(dialog).getByText(TRY_IT_COST)).toBeTruthy()
    expect(within(dialog).getByText('Starts in the Host default directory.')).toBeTruthy()
    expect(TRY_IT_COST).toMatch(/spends tokens on your current AI account/u)
    expect(page.started).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(page.started).toEqual([])
    expect(page.opened).toEqual([])
  })

  it('starts exactly one confirmed demo for the feature and opens its thread', async () => {
    const page = renderPage(true)
    fireEvent.click(within(await featureRow()).getByRole('button', { name: `Try it: ${FEATURE_TITLE}` }))
    const dialog = await screen.findByRole('dialog', { name: `Try it: ${FEATURE_TITLE}` })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start demo' }))
    await waitFor(() => expect(page.opened).toEqual(['session-demo']))
    expect(page.started).toEqual([{ feature: 'onboarding#usage-suggestions', confirm: true }])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('starts the demo in the project on screen and names it before Start demo', async () => {
    const page = renderPage(true, { projectId: 'workspace-dshfiles', title: 'dshfiles' })
    fireEvent.click(within(await featureRow()).getByRole('button', { name: `Try it: ${FEATURE_TITLE}` }))
    const dialog = await screen.findByRole('dialog', { name: `Try it: ${FEATURE_TITLE}` })
    expect(within(dialog).getByText('Starts in dshfiles.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start demo' }))
    await waitFor(() => expect(page.opened).toEqual(['session-demo']))
    expect(page.started).toEqual([{ feature: 'onboarding#usage-suggestions', project: 'workspace-dshfiles', confirm: true }])
  })

  it('offers Try it on a pack with an enabled plugin only', async () => {
    const page = renderPage(true)
    const packs = await screen.findByRole('region', { name: /^Packs/u })
    const observe = within(packs)
      .getAllByRole('listitem')
      .find(item => item.dataset.pack === 'observe')
    const planning = within(packs)
      .getAllByRole('listitem')
      .find(item => item.dataset.pack === 'planning')
    if (observe === undefined || planning === undefined) throw new Error('missing pack')
    expect(within(planning).queryByRole('button', { name: /^Try it/u })).toBeNull()
    fireEvent.click(within(observe).getByRole('button', { name: 'Try it: Observe & perf' }))
    const dialog = await screen.findByRole('dialog', { name: 'Try it: Observe & perf' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start demo' }))
    await waitFor(() => expect(page.started).toEqual([{ pack: 'observe', confirm: true }]))
  })
})
