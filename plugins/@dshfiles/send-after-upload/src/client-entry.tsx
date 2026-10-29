import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ComposerPill, defineClient } from '@dshfiles/dshx/client'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useCallback, useSyncExternalStore } from 'react'
import { disposeSessionComposers, sessionComposer } from './session-composer.js'
import { SEND_AFTER_UPLOAD_LOCALE_NAMESPACE, sendAfterUploadLocale } from './locales.js'

const isSessionId = (value: string): value is SessionId => value.length > 0

/** The session whose composer card holds `target`; the native card and session root carry these attributes. */
const composerSessionOf = (target: EventTarget | null): { readonly sessionId: SessionId; readonly root: Element } | undefined => {
  if (!(target instanceof Element) || target.closest('[data-composer-card]') === null) return undefined
  const root = target.closest('[data-conversation-session]')
  const sessionId = root?.getAttribute('data-conversation-session') ?? ''
  return root !== null && root !== undefined && isSessionId(sessionId) ? { sessionId, root } : undefined
}

// The native Send button is disabled while files upload, so it receives no click; its pointerdown still arrives.
const isDisabledSendButton = (target: EventTarget | null): boolean => {
  const button = target instanceof Element ? target.closest('button') : null
  return button !== null && button.disabled && /(?:^|\s)\S*_primary(?:\s|$)/u.test(button.className)
}

export default defineClient({
  name: '@dshfiles/send-after-upload',
  locales: [sendAfterUploadLocale],
  inject: ['slots', 'sessions'],
  setup(ctx, _decorate, metadata) {
    const t = ctx.locale.bind(SEND_AFTER_UPLOAD_LOCALE_NAMESPACE)

    const requestSend = (event: Event, sessionId: SessionId, root: Element): void => {
      const composer = sessionComposer(ctx, sessionId)
      if (composer === undefined) return
      const view = composer.view()
      if (!view.plain || (view.draft.trim() === '' && view.attachmentIds.length === 0)) return
      if (composer.uploadStatus(view.attachmentIds) !== 'uploading') return
      // An open @ or / menu owns Enter: it picks the highlighted row.
      if (event instanceof KeyboardEvent && root.querySelector('[role="listbox"]') !== null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      composer.actor.send({ type: 'request' })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = composerSessionOf(event.target)
      if (target === undefined) return
      if (event.key === 'Escape') {
        const composer = sessionComposer(ctx, target.sessionId)
        if (composer === undefined || composer.actor.getSnapshot().matches('idle')) return
        event.preventDefault()
        event.stopImmediatePropagation()
        composer.actor.send({ type: 'cancel' })
        return
      }
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      requestSend(event, target.sessionId, target.root)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !isDisabledSendButton(event.target)) return
      const target = composerSessionOf(event.target)
      if (target !== undefined) requestSend(event, target.sessionId, target.root)
    }

    ctx.effect(() => {
      // Capture runs before the editor's own Enter handler, which would refuse the send with a toast.
      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('pointerdown', onPointerDown, true)
      return () => {
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('pointerdown', onPointerDown, true)
        disposeSessionComposers()
      }
    }, 'dshfiles-send-after-upload: composer Enter and Send while uploading')

    metadata?.plugin?.add(ComposerPill, {
      id: 'dshfiles-pending-send',
      order: 5,
      usePill: session => {
        const composer = isSessionId(session.sessionId) ? sessionComposer(ctx, session.sessionId) : undefined
        const subscribe = useCallback((listener: () => void) => composer?.actor.subscribe(listener).unsubscribe ?? (() => {}), [composer])
        const snapshot = useSyncExternalStore(subscribe, () => composer?.actor.getSnapshot())
        if (composer === undefined || snapshot === undefined) return undefined
        const waiting = snapshot.matches('waiting') || snapshot.matches('sending')
        const failure = snapshot.matches('failed') ? snapshot.context.failure : null
        if (!waiting && failure === null) return undefined
        return {
          label: failure === null ? t('waiting') : t(`failed.${failure}`),
          ...(waiting && { icon: <Spinner className="dshx:size-3.5" /> }),
          menu: [
            waiting
              ? { id: 'cancel', title: t('cancel'), run: () => composer.actor.send({ type: 'cancel' }) }
              : { id: 'dismiss', title: t('dismiss'), run: () => composer.actor.send({ type: 'dismiss' }) },
          ],
        }
      },
    })
  },
})
