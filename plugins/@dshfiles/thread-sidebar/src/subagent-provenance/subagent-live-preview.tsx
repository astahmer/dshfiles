import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from '../locales.js'
import { createSubagentFeedStore, type SubagentFeed, type SubagentFeedStore, type SubagentPreviewState } from './subagent-feed.js'

export type SubagentPreviewTranslate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>

/** What the row reads from its plugin, bound once in the client entry. */
export interface SubagentPreviewBindings {
  readonly t: SubagentPreviewTranslate
  /** Hold the child open while the preview shows; the returned release is called exactly once. */
  readonly retainChild: (childId: string, signal: AbortSignal) => { readonly ready: Promise<SessionBinding>; readonly release: () => void }
  readonly openChild: (childId: string) => void
  readonly openChildAside: (childId: string) => void
  /** A child whose address is unknown cannot open in a side tab. */
  readonly canOpenAside: (childId: string) => boolean
}

const STATE_KEY = {
  starting: 'subagentPreviewStarting',
  'failed-to-start': 'subagentPreviewFailedToStart',
  working: 'subagentPreviewWorking',
  finished: 'subagentPreviewFinished',
  interrupted: 'subagentPreviewInterrupted',
  idle: 'subagentPreviewIdle',
} as const satisfies Record<SubagentPreviewState, string>

export const subagentStateLabel = (t: SubagentPreviewTranslate, state: SubagentPreviewState): string => t(STATE_KEY[state])

type Feed =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly store: SubagentFeedStore; readonly binding: SessionBinding }
  | { readonly kind: 'failed'; readonly message: string }

const failureOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Opening the child loads its history, so it happens per expansion and ends with it. */
const useChildFeed = (input: { readonly childId: string; readonly retainChild: SubagentPreviewBindings['retainChild'] }): Feed => {
  const { childId, retainChild } = input
  const [feed, setFeed] = useState<Feed>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    let store: SubagentFeedStore | undefined
    setFeed({ kind: 'loading' })
    try {
      const reference = retainChild(childId, controller.signal)
      reference.ready.then(
        binding => {
          if (controller.signal.aborted) return
          store = createSubagentFeedStore(binding.eventSource)
          setFeed({ kind: 'ready', store, binding })
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setFeed({ kind: 'failed', message: failureOf(error) })
        },
      )
      return () => {
        controller.abort()
        store?.dispose()
        reference.release()
      }
    } catch (error) {
      setFeed({ kind: 'failed', message: failureOf(error) })
      return undefined
    }
  }, [childId, retainChild])
  return feed
}

type Stop = { readonly kind: 'idle' } | { readonly kind: 'armed' } | { readonly kind: 'stopping' } | { readonly kind: 'failed'; readonly message: string }

const StopChild = (props: { readonly binding: SessionBinding; readonly t: SubagentPreviewTranslate }): JSX.Element => {
  const t = props.t
  const [stop, setStop] = useState<Stop>({ kind: 'idle' })
  const confirm = (): void => {
    setStop({ kind: 'stopping' })
    props.binding.session.cancel().then(
      result => setStop(result.ok ? { kind: 'idle' } : { kind: 'failed', message: result.error.message }),
      (error: unknown) => setStop({ kind: 'failed', message: failureOf(error) }),
    )
  }
  const armed = stop.kind === 'armed'
  return (
    <>
      {armed ? (
        <Button size="xs" variant="ghost" className="dshx:shrink" onClick={() => setStop({ kind: 'idle' })}>
          {t('subagentPreviewKeepWorking')}
        </Button>
      ) : null}
      <Button
        size="xs"
        variant={armed ? 'destructive' : 'outline'}
        className="dshx:shrink"
        disabled={stop.kind === 'stopping'}
        onClick={() => (armed ? confirm() : setStop({ kind: 'armed' }))}
      >
        {t(armed ? 'subagentPreviewConfirmStop' : 'subagentPreviewStop')}
      </Button>
      {stop.kind === 'failed' ? <span className="dshx:basis-full dshx:text-destructive">{t('subagentPreviewStopFailed', { error: stop.message })}</span> : null}
    </>
  )
}

const FeedLine = (props: {
  readonly store: SubagentFeedStore
  readonly t: SubagentPreviewTranslate
  readonly onTurnState: (lastTurnCompleted: boolean | undefined) => void
}): JSX.Element => {
  const feed: SubagentFeed = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const { onTurnState } = props
  useEffect(() => onTurnState(feed.lastTurnCompleted), [feed.lastTurnCompleted, onTurnState])
  return (
    <>
      <p className="dshx:text-muted-foreground" data-dshfiles-live-preview-progress="">
        {feed.tool === undefined
          ? props.t('subagentPreviewToolCalls', { count: String(feed.toolCalls) })
          : props.t('subagentPreviewInTool', { tool: feed.tool, count: String(feed.toolCalls) })}
      </p>
      {feed.text === '' ? null : (
        <pre
          data-dshfiles-live-preview-output=""
          className="dshx:m-0 dshx:max-h-48 dshx:overflow-auto dshx:font-mono! dshx:text-xs dshx:break-words dshx:whitespace-pre-wrap"
        >
          {feed.text}
        </pre>
      )}
    </>
  )
}

/** Mounted only while the row is open: collapsing releases the child. */
export const SubagentLivePreview = (
  props: SubagentPreviewBindings & {
    readonly childId: string
    readonly state: SubagentPreviewState
    readonly onTurnState: (lastTurnCompleted: boolean | undefined) => void
  },
): JSX.Element => {
  const { t, childId, state } = props
  const feed = useChildFeed({ childId, retainChild: props.retainChild })
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-xs">
      {feed.kind === 'loading' ? <p className="dshx:text-muted-foreground">{t('subagentPreviewLoading')}</p> : null}
      {feed.kind === 'failed' ? <p className="dshx:text-destructive">{t('subagentPreviewUnavailable', { error: feed.message })}</p> : null}
      {feed.kind === 'ready' ? <FeedLine store={feed.store} t={t} onTurnState={props.onTurnState} /> : null}
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Button size="xs" variant="link" className="dshx:shrink" onClick={() => props.openChild(childId)}>
          {t('subagentPreviewOpenThread')}
        </Button>
        {props.canOpenAside(childId) ? (
          <Button size="xs" variant="ghost" className="dshx:shrink" onClick={() => props.openChildAside(childId)}>
            {t('subagentPreviewOpenAside')}
          </Button>
        ) : null}
        <span className="dshx:flex-1" />
        {state === 'working' && feed.kind === 'ready' ? <StopChild binding={feed.binding} t={t} /> : null}
      </div>
    </div>
  )
}
