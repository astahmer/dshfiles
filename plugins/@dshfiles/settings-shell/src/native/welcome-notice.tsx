/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-models@0.2.0-rc.2 (MIT): `OnboardingModal.js`, `WelcomeNotice.js`,
 * `welcome-store.js`, `onboarding-copy.js` and the welcome copy of its dictionaries. The native step keeps its
 * acknowledgement in the `ui-settings-general` namespace, which only the switched-off native row serves, so this copy
 * shadows the `welcome-notice` onboarding entry and keeps it in this plugin's own namespace instead.
 */
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createActor, fromPromise, waitFor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { defineLocale } from '@dshfiles/dshx/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback, useEffect, useRef } from 'react'
import { z } from 'zod'
import { useObservable } from './use-observable.js'
import { welcomeNoticeMachine, type WelcomeNoticeScopeState } from './welcome-notice-machine.js'

export const WELCOME_STEP_ID = 'welcome-notice'
/** Field storing the last welcome notice version the user acknowledged, in `dshfiles-settings-shell`. */
const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'
/** The upstream notice version; a material change in the notice bumps it upstream, and every user sees it again. */
const WELCOME_NOTICE_VERSION = '2026-09-28.1'

export const WELCOME_LOCALE_NAMESPACE = 'dshfiles.settings-shell.welcome'

const en = {
  welcomeTitle: 'Preview Notice',
  welcomeBody:
    'DeepSeek Harness 0.2 is still in preview, and many areas need continued improvement and refinement. We welcome feedback and suggestions from all developers and users. The new desktop app now targets a broad range of users, while developer-related advanced features can be enabled in the settings. DeepSeek Harness’s product features and plugin APIs are expected to continue rapid iteration and evolution, and will gradually stabilize over time.\n\nWe look forward to exploring the limits of intelligence together with users and developers around the world, building on open-source, reusable, and composable infrastructure. We welcome everyone to bring their ideas to life with DeepSeek Harness and participate in the community to enrich the plugin ecosystem.',
  welcomeContinue: 'Continue',
  welcomeError: 'The acknowledgement could not be saved. Please try again.',
}

const zh = {
  welcomeTitle: '预览版说明',
  welcomeBody:
    'DeepSeek Harness 目前的 0.2 版本仍处于预览阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者和用户的反馈建议。现在，新的桌面端面向广泛用户，开发者相关的进阶功能可在配置中开启使用。预计 DeepSeek Harness 的产品功能以及插件 API 都会继续快速迭代、持续演化，并逐渐趋于稳定。\n\n我们期待与全球用户和开发者一起，在开源、可复用、可组合的基础设施之上，共同探索智能上限。欢迎大家用 DeepSeek Harness 将想法变成现实，与社区一起丰富插件生态。',
  welcomeContinue: '继续',
  welcomeError: '暂时无法保存确认状态，请重试。',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.settings-shell.welcome': keyof typeof en
  }
}

export type WelcomeTranslate = TranslateNS<typeof WELCOME_LOCALE_NAMESPACE>

export const welcomeLocale = defineLocale(WELCOME_LOCALE_NAMESPACE, { en, zh })

/** Mutable: the snapshot store hands updates an immer draft. */
interface WelcomeState {
  status: 'idle' | 'loading' | 'saving' | 'ready' | 'error'
  acknowledged: boolean
  error: string | null
}

const ackSchema = z.object({ [WELCOME_NOTICE_ACK_FIELD]: z.string() })

type WelcomeNoticeActor = ActorRefFrom<typeof welcomeNoticeMachine>

type PersistAcknowledgementInput = { readonly write: () => Promise<boolean> }

const persistAcknowledgement = fromPromise<boolean, PersistAcknowledgementInput>(({ input }) => input.write())

const providedWelcomeNoticeMachine = welcomeNoticeMachine.provide({ actors: { persistAcknowledgement } })

const scopeState = (scope: ConfigForm<unknown>): WelcomeNoticeScopeState => {
  const snapshot = scope.getSnapshot()
  if (snapshot.mode === 'memory') return { mode: snapshot.mode, status: snapshot.status, acknowledged: false }
  const parsed = ackSchema.safeParse(snapshot.value)
  return {
    mode: snapshot.mode,
    status: snapshot.status,
    acknowledged: snapshot.status === 'ready' && parsed.success && parsed.data[WELCOME_NOTICE_ACK_FIELD] === WELCOME_NOTICE_VERSION,
  }
}

const welcomeStatus = (snapshot: ReturnType<WelcomeNoticeActor['getSnapshot']>): WelcomeState['status'] => {
  if (snapshot.matches('loading')) return 'loading'
  if (snapshot.matches('saving')) return 'saving'
  if (snapshot.matches('error')) return 'error'
  return 'ready'
}

const welcomeState = (snapshot: ReturnType<WelcomeNoticeActor['getSnapshot']>): WelcomeState => ({
  status: welcomeStatus(snapshot),
  acknowledged: snapshot.context.acknowledged,
  error: snapshot.context.error,
})

/** Durable Host acknowledgement, or a process-local one for a remote browser whose settings stay in memory. */
export class WelcomeNoticeStore {
  readonly store = createSnapshotStore<WelcomeState>({ status: 'idle', acknowledged: false, error: null })
  private actor: WelcomeNoticeActor | undefined
  private following: (() => void) | undefined
  private stopObservingActor: (() => void) | undefined

  constructor(private readonly scope: ConfigForm<unknown>) {}

  /** Begin following the bound scope (idempotent) and publish its current answer. */
  load(): void {
    if (this.actor !== undefined) return
    const actor = createActor(providedWelcomeNoticeMachine, {
      input: {
        scope: scopeState(this.scope),
        write: () => this.scope.set(WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_VERSION),
      },
    })
    const subscription = actor.subscribe(snapshot => this.store.set(welcomeState(snapshot)))
    this.actor = actor
    this.stopObservingActor = () => subscription.unsubscribe()
    this.following = this.scope.subscribe(() => actor.send({ type: 'scope.changed', scope: scopeState(this.scope) }))
    actor.start()
  }

  /** Persist this copy version, or advance only this process for a remote browser. */
  async acknowledge(): Promise<boolean> {
    const actor = this.actor
    if (actor === undefined) return false
    const current = actor.getSnapshot()
    if (current.context.acknowledged) return true
    if (current.matches('loading') || current.matches('sync')) return false
    if (!current.matches('saving')) actor.send({ type: 'acknowledge' })
    try {
      const result = await waitFor(actor, snapshot => snapshot.context.acknowledged || snapshot.matches('error'))
      return result.context.acknowledged
    } catch {
      return false
    }
  }

  dispose(): void {
    this.following?.()
    this.following = undefined
    this.stopObservingActor?.()
    this.stopObservingActor = undefined
    this.actor?.stop()
    this.actor = undefined
  }
}

const ignoreImplicitDismiss = (): void => {}

/** A blocking onboarding dialog that keeps the application root inert. */
const OnboardingModal = (props: { readonly title: string; readonly focusTitle: boolean; readonly children: React.ReactNode }): JSX.Element | null => {
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => {
      appRoot.inert = previous
    }
  }, [])
  useEffect(() => {
    if (props.focusTitle) titleRef.current?.focus()
  }, [props.focusTitle])
  return (
    <Modal className="dshx:max-h-full dshx:w-[min(600px,100%)] dshx:p-0" headless onClose={ignoreImplicitDismiss} open title={props.title}>
      <div className="dshx:box-border dshx:flex dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto dshx:p-7 dshx:max-[560px]:p-6">
        <h2
          className="dshx:m-0 dshx:text-[20px] dshx:leading-7 dshx:font-medium dshx:text-[var(--dsw-alias-label-primary)] dshx:outline-none"
          ref={titleRef}
          tabIndex={props.focusTitle ? -1 : undefined}
        >
          {props.title}
        </h2>
        <div className="dshx:mt-5">{props.children}</div>
      </div>
    </Modal>
  )
}

/** The versioned preview notice, shown once per notice version on the empty Hero. */
export const WelcomeNotice = (props: {
  readonly complete: () => void
  readonly controller: WelcomeNoticeStore
  readonly t: WelcomeTranslate
}): JSX.Element | null => {
  const { complete, controller, t } = props
  const state = useObservable(controller.store)
  const finished = useRef(false)
  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])
  useEffect(() => {
    if (state.acknowledged) finish()
  }, [finish, state.acknowledged])
  if (state.status === 'idle' || state.status === 'loading' || state.acknowledged) return null
  const acknowledge = async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }
  return (
    <OnboardingModal focusTitle title={t('welcomeTitle')}>
      <div className="dshx:text-[14px] dshx:leading-6 dshx:text-[var(--dsw-alias-label-secondary)] dshx:[&_p]:m-0 dshx:[&_p+p]:mt-3">
        {t('welcomeBody')
          .split('\n\n')
          .map(paragraph => (
            <p key={paragraph}>{paragraph}</p>
          ))}
      </div>
      {state.error !== null && (
        <p className="dshx:mt-4 dshx:mb-0 dshx:text-[14px] dshx:leading-[22px] dshx:text-[var(--dsw-alias-state-error-primary)]" role="alert">
          {t('welcomeError')}
        </p>
      )}
      <div className="dshx:mt-6 dshx:flex dshx:justify-end">
        <Button
          className="dshx:min-w-[120px] dshx:max-[560px]:w-full"
          disabled={state.status === 'saving'}
          onClick={() => void acknowledge()}
          variant="primary"
        >
          {t('welcomeContinue')}
        </Button>
      </div>
    </OnboardingModal>
  )
}
