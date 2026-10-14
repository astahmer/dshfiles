/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.0-rc.2 (MIT): `SettingsRoot.js`. The sidebar-foot
 * trigger row (connection recovery, Desktop update) plus the settings surface and the onboarding coordinator, which
 * mounts exactly one ordered `settings.onboarding` step while the main view shows no thread.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SettingsLauncherOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ConnectionIndicator, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DesktopUpdateIndicator, type DesktopUpdateSource } from './desktop-update.js'
import type { ShellTranslate } from './locales.js'
import type { ShellRenderSlot } from './slots.js'
import { useObservable } from './use-observable.js'

const RECOVERY_CONFIRMATION_MS = 2_000
/** Minimum visible time for the connecting pill; shorter attempts read as flicker. */
const CONNECTING_MIN_VISIBLE_MS = 800

type IndicatorState = 'connecting' | 'disconnected' | 'recovered' | undefined

const indicatorState = (input: {
  readonly connectionState: ConnectionState | undefined
  readonly holdConnecting: boolean
  readonly showRecovery: boolean
}): IndicatorState => {
  if (input.connectionState === 'connecting' || input.holdConnecting) return 'connecting'
  if (input.connectionState === 'disconnected') return 'disconnected'
  return input.showRecovery ? 'recovered' : undefined
}

export interface OnboardingStep {
  readonly id: string
  readonly order: number
}

/** Everything the root reads besides its slot props; built once per registration. */
export interface ShellRootDeps {
  readonly connectionState: ObservableSnapshot<ConnectionState | undefined>
  readonly reconnect: () => void
  readonly desktopUpdate: DesktopUpdateSource
  readonly shortcuts: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
  readonly onboardingSteps: ObservableSnapshot<readonly OnboardingStep[]>
  /** Whether the main view shows no thread (or a blank one), the empty-Hero fact onboarding waits for. */
  readonly onboardingActive: ObservableSnapshot<boolean>
  /** Steps whose durable facts are not served by this composition and would only show an error. */
  readonly skippedOnboarding: ObservableSnapshot<ReadonlySet<string>>
  readonly settingsOpen: ObservableSnapshot<boolean>
  readonly openSettings: () => void
  readonly closeSettings: () => void
  readonly openSection: (sectionId: string) => void
}

export const ShellRoot = (props: {
  readonly wide: boolean
  readonly t: ShellTranslate
  readonly renderSlot: ShellRenderSlot
  readonly deps: ShellRootDeps
  /** The settings surface (modal or tab) rendered while Settings is open. */
  readonly surface: ReactNode
}): JSX.Element => {
  const { deps, t, renderSlot, wide } = props
  const open = useObservable(deps.settingsOpen)
  const shortcut = useObservable(deps.shortcuts).find(row => row.id === 'settings.open')
  const desktopUpdate = useObservable(deps.desktopUpdate.store)
  const connectionState = useObservable(deps.connectionState)
  const onboardingSteps = useObservable(deps.onboardingSteps)
  const onboardingActive = useObservable(deps.onboardingActive)
  const skippedOnboarding = useObservable(deps.skippedOnboarding)
  const [requestedOnboarding, setRequestedOnboarding] = useState<string | undefined>()
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  const [holdConnecting, setHoldConnecting] = useState(false)
  const connectingShownAt = useRef<number | undefined>(undefined)
  const previousConnectionState = useRef(connectionState)

  const pendingStep = onboardingActive ? onboardingSteps.find(step => !completedOnboarding.has(step.id) && !skippedOnboarding.has(step.id)) : undefined
  const onboardingStep = requestedOnboarding === undefined ? pendingStep : onboardingSteps.find(step => step.id === requestedOnboarding)

  useEffect(() => {
    if (!onboardingActive) setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const onboardingStepSeen = useRef(onboardingStep)
  useEffect(() => {
    const appeared = onboardingStepSeen.current === undefined && onboardingStep !== undefined
    onboardingStepSeen.current = onboardingStep
    if (appeared && open) deps.closeSettings()
  }, [onboardingStep, open, deps])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
  }, [connectionState])

  useLayoutEffect(() => {
    if (!showRecovery || holdConnecting) return
    const timeout = window.setTimeout(() => setShowRecovery(false), RECOVERY_CONFIRMATION_MS)
    return () => window.clearTimeout(timeout)
  }, [showRecovery, holdConnecting])

  useLayoutEffect(() => {
    if (connectionState === 'connecting') {
      connectingShownAt.current = Date.now()
      return
    }
    const shownAt = connectingShownAt.current
    if (shownAt === undefined) return
    connectingShownAt.current = undefined
    const remaining = CONNECTING_MIN_VISIBLE_MS - (Date.now() - shownAt)
    if (remaining <= 0) return
    setHoldConnecting(true)
    const timeout = window.setTimeout(() => setHoldConnecting(false), remaining)
    return () => {
      window.clearTimeout(timeout)
      setHoldConnecting(false)
    }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setRequestedOnboarding(undefined)
    setCompletedOnboarding(previous => (previous.has(id) ? previous : new Set([...previous, id])))
  }, [])

  const connectionIndicator = indicatorState({ connectionState, holdConnecting, showRecovery })
  const installing = desktopUpdate.presentation?.phase === 'installing'
  const launcherProps: SettingsLauncherOwnerProps = {
    wide,
    settingsOpen: open,
    openSettings: deps.openSettings,
    openOnboarding: (id: string) => {
      deps.closeSettings()
      setRequestedOnboarding(id)
    },
  }
  if (shortcut !== undefined && shortcut.keys.length > 0) launcherProps.settingsShortcut = { keys: shortcut.keys, aria: shortcut.aria }

  return (
    <>
      <div
        className={cn(
          'dshx:relative dshx:mx-[-2px] dshx:my-1 dshx:flex dshx:w-[calc(100%+4px)] dshx:flex-none dshx:items-center dshx:gap-2',
          !wide && 'dshx:mx-0 dshx:mt-2 dshx:mb-2.5 dshx:w-9',
        )}
      >
        {renderSlot('settings.launcher', launcherProps, {
          fallback: (
            <Tooltip disabled={open} label={t('trigger')} shortcutKeys={shortcut?.keys}>
              <button
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-keyshortcuts={shortcut?.aria}
                aria-label={t('trigger')}
                className={cn(
                  'dshx:m-0 dshx:box-border dshx:flex dshx:h-[42px] dshx:w-auto dshx:min-w-0 dshx:flex-1 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:overflow-hidden dshx:rounded-[var(--dsw-radius-md)] dshx:border-none dshx:bg-transparent dshx:py-0 dshx:pr-2.5 dshx:pl-2 dshx:text-[14px] dshx:leading-[22px] dshx:text-[var(--dsw-alias-label-primary)] dshx:hover:bg-[var(--dsw-alias-interactive-bg-hover)]',
                  !wide && 'dshx:size-9 dshx:flex-none dshx:justify-center dshx:gap-0 dshx:p-0',
                )}
                onClick={deps.openSettings}
                type="button"
              >
                {renderSlot('settings.trigger', { wide })}
              </button>
            </Tooltip>
          ),
        })}
        <ConnectionIndicator
          connectingLabel={t('connection.connecting')}
          disconnectedLabel={t('connection.error')}
          onReconnect={deps.reconnect}
          reconnectActionLabel={t('connection.reconnect')}
          recoveredLabel={t('connection.connected')}
          restartActionLabel={t('connection.restart')}
          state={wide && !installing ? connectionIndicator : undefined}
        />
        <DesktopUpdateIndicator hidden={connectionIndicator !== undefined && !installing} source={deps.desktopUpdate} t={t} wide={wide} />
      </div>
      {open && props.surface}
      {onboardingStep !== undefined &&
        renderSlot(
          'settings.onboarding',
          {
            stepId: onboardingStep.id,
            explicit: requestedOnboarding !== undefined,
            complete: () => completeOnboardingStep(onboardingStep.id),
            openSection: deps.openSection,
          },
          { only: onboardingStep.id },
        )}
    </>
  )
}
