import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Command, Composer, defineClient, useApi, useContract, useSettings, type PluginContext } from '@dshfiles/dshx/client'
import { CompassIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DestinationSections } from '@dshfiles/thread-sidebar/destinations'
import { useEffect, type ReactNode } from 'react'
import { onboardingApi } from './api.js'
import { GettingStartedPage } from './getting-started-page.js'
import type { Overview, OverviewInput } from './overview-model.js'
import { Routes, type RouteServices } from './routes.js'
import { ONBOARDING_DEFAULTS, onboardingSettings, type OnboardingSettings } from './settings.js'
import { SetupWizard } from './setup-wizard.js'
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
  return (input, signal) => api.overview(input, { signal })
}

export default defineClient({
  name: '@dshfiles/onboarding',
  inject: ['slots', 'uiWorkspace'],
  setup(ctx, decorate, metadata) {
    const plugin: PluginContext | undefined = metadata?.plugin
    metadata?.plugin?.add(DestinationSections, {
      panelId: PANEL_ID,
      destination: 'knowledge',
      label: 'Getting started',
      description: 'Setup checklist, plugin packs and every feature.',
      order: 0,
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

    /** Into the composer on screen, else a new thread draft; neither sends. */
    const useInsertPrompt = (): ((text: string) => boolean) => {
      const composer = useContract(Composer)
      return text => {
        if (composer.status === 'active' && composer.value.insert({ text })) return true
        ctx.uiWorkspace.startSession(undefined, { prompt: text })
        return true
      }
    }

    const Wizard = (props: { readonly open: boolean; readonly onFinish: (outcome: 'done' | 'skipped') => void }): ReactNode => (
      <SetupWizard insertPrompt={useInsertPrompt()} loadOverview={useLoadOverview()} onFinish={props.onFinish} open={props.open} routes={routes} />
    )

    plugin?.add(Command, {
      id: '@dshfiles/onboarding.open',
      title: 'Onboarding: Getting started',
      keywords: ['onboarding', 'setup', 'checklist', 'packs', 'features', 'tour', 'help'],
      run: () => {
        plugin.layout.openPanel(PANEL_ID)
      },
    })
    plugin?.add(Command, {
      id: '@dshfiles/onboarding.wizard',
      title: 'Onboarding: Show the setup wizard',
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
              copy={copy}
              loadOverview={useLoadOverview()}
              routes={routes}
              settings={useOnboardingSettings()}
              startWizard={WizardStore.request}
            />
          </PluginQueryProvider>
        )),
      ),
    )

    // First run: settings-shell mounts this step only while no thread is open; it completes at once when seen or off.
    const FirstRunStep = (props: { readonly complete: () => void; readonly explicit?: boolean | undefined }): ReactNode => {
      const settings = useOnboardingSettings()
      const outcome = WizardStore.useOutcome()
      const requested = WizardStore.useRequested()
      const show = props.explicit === true || (settings.wizard && outcome === null)
      const complete = props.complete
      useEffect(() => {
        if (!show || requested) complete()
      }, [show, requested, complete])
      if (!show || requested) return null
      return (
        <PluginQueryProvider>
          <Wizard
            onFinish={next => {
              WizardStore.finish(next)
              complete()
            }}
            open
          />
        </PluginQueryProvider>
      )
    }
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({ name: 'settings.onboarding', id: WIZARD_STEP_ID, order: 10 }, decorate(FirstRunStep)))

    // Replay from the palette or the page, wherever the user is.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-onboarding-wizard', order: 120 },
        decorate(() => {
          const requested = WizardStore.useRequested()
          if (!requested) return null
          return (
            <PluginQueryProvider>
              <Wizard onFinish={WizardStore.finish} open />
            </PluginQueryProvider>
          )
        }),
      ),
    )
  },
})
