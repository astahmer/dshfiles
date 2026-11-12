import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Command, Composer, defineClient, useApi, useContract, useSettings, type PluginContext } from '@dshfiles/dshx/client'
import { CompassIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { DestinationSections } from '@dshfiles/thread-sidebar/destinations'
import { useThreadDirectories } from '@dshfiles/thread-sidebar/thread-directories'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { onboardingApi } from './api.js'
import { FirstRun } from './first-run.js'
import { GettingStartedPage, type GettingStartedProps } from './getting-started-page.js'
import { OnScreenProjects, type OnScreenProject } from './on-screen-project.js'
import type { Overview, OverviewInput } from './overview-model.js'
import { Routes, type RouteServices } from './routes.js'
import { ONBOARDING_DEFAULTS, onboardingSettings, type OnboardingSettings } from './settings.js'
import { SetupWizard } from './setup-wizard.js'
import { ShowMeWhere, WalkUnreadable } from './show-me-where.js'
import { WalkStore } from './walk-store.js'
import { WizardStore } from './wizard-store.js'

const PANEL_ID = 'dshfiles-onboarding'
const WIZARD_STEP_ID = 'dshfiles-onboarding-setup'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => <CompassIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

/** The namespace may be unregistered on a Host that predates this plugin: render with the defaults then. */
const useOnboardingSettings = (): OnboardingSettings => {
  const state = useSettings(onboardingSettings)
  return { ...ONBOARDING_DEFAULTS, ...state.value }
}

const useLoadOverview = (): ((input: OverviewInput, signal: AbortSignal) => Promise<Overview>) => {
  const api = useApi(onboardingApi)
  return useCallback((input, signal) => api.overview(input, { signal }), [api])
}

const useLoadWhatsNew = (): GettingStartedProps['loadWhatsNew'] => {
  const api = useApi(onboardingApi)
  return useCallback((input, signal) => api.whatsNew(input, { signal }), [api])
}

const useLoadSuggestions = (): GettingStartedProps['loadSuggestions'] => {
  const api = useApi(onboardingApi)
  return useCallback((input, signal) => api.suggestions(input, { signal }), [api])
}

/** One feature's steps, read from the Host when a walk starts: the catalog never ships in this bundle. */
const WalkOverlay = (props: { readonly featureKey: string; readonly routes: RouteServices }): ReactNode => {
  const api = useApi(onboardingApi)
  const reach = useQuery({
    queryKey: ['onboarding', 'reach', props.featureKey],
    queryFn: ({ signal }) => api.reach({ key: props.featureKey }, { signal }),
    retry: false,
    gcTime: 0,
  })
  const feature = reach.data?.feature ?? null
  useEffect(() => {
    if (reach.isSuccess && (feature === null || !feature.walkable)) WalkStore.end()
  }, [reach.isSuccess, feature])
  if (reach.isError) return <WalkUnreadable onEnd={WalkStore.end} onRetry={() => void reach.refetch()} />
  if (feature === null || !feature.walkable) return null
  return <ShowMeWhere onEnd={WalkStore.end} reach={feature} routes={props.routes} />
}

const useApplyPack = (): GettingStartedProps['applyPack'] => {
  const api = useApi(onboardingApi)
  return useCallback(input => api.applyPack(input), [api])
}

const useStartTryIt = (): GettingStartedProps['startTryIt'] => {
  const api = useApi(onboardingApi)
  return useCallback(input => api.tryIt(input), [api])
}

export default defineClient({
  name: '@dshfiles/onboarding',
  inject: ['slots', 'sessions', 'workspaces', 'uiWorkspace'],
  setup(ctx, decorate, metadata) {
    const plugin: PluginContext | undefined = metadata?.plugin
    metadata?.plugin?.add(DestinationSections, {
      panelId: PANEL_ID,
      destination: 'knowledge',
      label: 'Getting started',
      description: 'Setup checklist, plugin packs and every feature.',
      // dshfiles: last in Knowledge, so the destination opens on Memory; ⌘K Getting started, the New tab chooser and
      // Start setup reach it from anywhere (upstream UI fit).
      order: 6,
    })

    const routes: RouteServices = {
      hasPanel: panelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === panelId),
      openPanel: panelId => plugin?.layout.openPanel(panelId) ?? false,
      hasCommand: commandId => plugin?.commands.list.get().some(command => command.id === commandId && command.enabled !== false) ?? false,
      runCommand: commandId => plugin?.commands.run(commandId) ?? false,
      hasSettings: () => ctx.slots.entriesOfSlot('settings.section').length > 0,
      openSettings: Routes.dispatchOpenSettings,
    }
    const copy = (text: string): Promise<boolean> => plugin?.system.copy(text) ?? Promise.resolve(false)

    const subscribeSessions = (listener: () => void): (() => void) => ctx.sessions.list.subscribe(listener)
    const readSessions = () => ctx.sessions.list.getSnapshot()
    const subscribeWorkspaces = (listener: () => void): (() => void) => ctx.workspaces.list.subscribe(listener)
    const readWorkspaces = () => ctx.workspaces.list.getSnapshot().items
    /** Try it starts its demo in this project; the Host checks it is registered. */
    const useOnScreenProject = (): OnScreenProject | null => {
      const sessions = useSyncExternalStore(subscribeSessions, readSessions, readSessions)
      const workspaces = useSyncExternalStore(subscribeWorkspaces, readWorkspaces, readWorkspaces)
      const threadDirectories = useThreadDirectories(workspaces)
      return useMemo(() => OnScreenProjects.of({ sessions, workspaces, threadDirectories }), [sessions, threadDirectories, workspaces])
    }

    /** Into the composer on screen, else a new thread draft; neither sends. */
    const useInsertPrompt = (): ((text: string) => boolean) => {
      const composer = useContract(Composer)
      return text => {
        if (composer.status === 'active' && composer.value.insert({ text })) return true
        ctx.uiWorkspace.startSession(undefined, { prompt: text })
        return true
      }
    }

    const Wizard = (props: { readonly open: boolean; readonly onFinish: (outcome: 'done' | 'skipped') => void; readonly onClose: () => void }): ReactNode => (
      <SetupWizard
        insertPrompt={useInsertPrompt()}
        loadOverview={useLoadOverview()}
        onClose={props.onClose}
        onFinish={props.onFinish}
        open={props.open}
        routes={routes}
      />
    )

    plugin?.add(Command, {
      id: '@dshfiles/onboarding.open',
      title: 'Getting started',
      keywords: ['onboarding', 'setup', 'checklist', 'packs', 'features', 'tour', 'help'],
      run: () => {
        plugin.layout.openPanel(PANEL_ID)
      },
    })
    plugin?.add(Command, {
      id: '@dshfiles/onboarding.wizard',
      title: 'Show the setup wizard',
      keywords: ['onboarding', 'setup', 'wizard', 'tour', 'first run'],
      run: () => WizardStore.request(),
    })

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => 'Getting started' }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <GettingStartedPage
              applyPack={useApplyPack()}
              copy={copy}
              loadOverview={useLoadOverview()}
              loadSuggestions={useLoadSuggestions()}
              loadWhatsNew={useLoadWhatsNew()}
              openThread={sessionId => ctx.uiWorkspace.openSession(sessionId)}
              project={useOnScreenProject()}
              routes={routes}
              settings={useOnboardingSettings()}
              showWhere={WalkStore.start}
              startTryIt={useStartTryIt()}
              startWizard={WizardStore.request}
            />
          </PluginQueryProvider>
        )),
      ),
    )

    // dshfiles: the wizard opens by itself only while its own setup (an AI account, a project) is still missing, so an
    // existing user is not greeted by it in every new browser; ⌘K and Getting started still replay it (first-run.ts).
    const FirstRunGate = (props: { readonly complete: () => void; readonly explicit?: boolean | undefined }): ReactNode => {
      const settings = useOnboardingSettings()
      const outcome = WizardStore.useOutcome()
      const requested = WizardStore.useRequested()
      const closed = WizardStore.useClosed()
      const candidate = props.explicit !== true && settings.wizard && outcome === null && !requested && !closed
      const loadOverview = useLoadOverview()
      const overview = useQuery({
        queryKey: ['onboarding', 'first-run', 'overview'],
        queryFn: ({ signal }) => loadOverview({}, signal),
        enabled: candidate,
        retry: false,
      })
      // A read that has not answered within FirstRun.waitMs counts as failed: the wizard then opens as upstream's does.
      const [slow, setSlow] = useState(false)
      useEffect(() => {
        if (!candidate) return
        const timer = window.setTimeout(() => setSlow(true), FirstRun.waitMs)
        return () => window.clearTimeout(timer)
      }, [candidate])
      const setup = candidate ? FirstRun.setup({ overview: overview.data, failed: overview.isError || (slow && overview.data === undefined) }) : 'done'
      const waiting = candidate && setup === 'pending'
      const show = props.explicit === true || (candidate && setup === 'open')
      const complete = props.complete
      useEffect(() => {
        if (waiting) return
        if (!show || requested) complete()
      }, [waiting, show, requested, complete])
      if (waiting || !show || requested || (closed && props.explicit !== true)) return null
      // settings-shell mounts onboarding steps inside its settings trigger row, which this fork hides (b:4v6p): the kit
      // dialog portals to the body on its own; the portal keeps the step's React tree out of that hidden row too.
      return createPortal(
        <Wizard
          onClose={() => {
            WizardStore.close()
            complete()
          }}
          onFinish={next => {
            WizardStore.finish(next)
            complete()
          }}
          open
        />,
        document.body,
      )
    }
    const FirstRunStep = (props: { readonly complete: () => void; readonly explicit?: boolean | undefined }): ReactNode => (
      <PluginQueryProvider>
        <FirstRunGate {...props} />
      </PluginQueryProvider>
    )
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({ name: 'settings.onboarding', id: WIZARD_STEP_ID, order: 10 }, decorate(FirstRunStep)))

    // Show me where outlives the page: its first click usually navigates away from Getting started.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-onboarding-walk', order: 121 },
        decorate(() => {
          const featureKey = WalkStore.useCurrent()
          if (featureKey === null) return null
          return (
            <PluginQueryProvider>
              <WalkOverlay featureKey={featureKey} key={featureKey} routes={routes} />
            </PluginQueryProvider>
          )
        }),
      ),
    )

    // Replay from the palette or the page, wherever the user is.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-onboarding-wizard', order: 120 },
        decorate(() => {
          const requested = WizardStore.useRequested()
          if (!requested) return null
          return (
            <PluginQueryProvider>
              <Wizard onClose={WizardStore.close} onFinish={WizardStore.finish} open />
            </PluginQueryProvider>
          )
        }),
      ),
    )
  },
})
