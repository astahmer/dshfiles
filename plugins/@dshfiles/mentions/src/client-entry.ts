import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputTriggerCandidate, InputTriggerCrumb, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference'
import { defineClient } from '@dshfiles/dshx/client'
import { FileMentions } from './file-mentions.js'
import { MENTIONS_LOCALE_NAMESPACE, mentionsLocale } from './locales.js'
import { MentionRanking, type FileEntry, type MentionQuery, type ThreadEntry } from './mention-ranking.js'
import { SessionLinks } from './session-links.js'
import './client.css'

// The native chip codec, copy/paste and send-time serialization are keyed by this source name.
const SOURCE_NAME = 'reference'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** An `@` menu lookup holding the composer's Session open for its two Host reads. */
    mentionCandidates: unknown
  }
}
const TIMING_MEASURE = 'dshfiles-mentions:candidates'
// @dshfiles/main-tabs takes this cancelable window event to open a thread in a tab.
const OPEN_THREAD_EVENT = 'dshfiles:open-thread'
// A sent message's in-text session chip (ui-primitives `projectUserText`) and its "Referenced session · …" line (ui-chat).
const SESSION_CHIP = '[data-ref-chip="session"]'
const SESSION_LINK = `${SESSION_CHIP}, [class*="_referenceSummary"]`

type PickValue =
  | { readonly kind: 'file'; readonly fileKind: 'file' | 'directory'; readonly label: string; readonly mention: string; readonly drillText: string }
  | { readonly kind: 'session'; readonly label: string; readonly mention: string }

// Menu rows carry an opaque string; the pick payload behind it stays here. Bounded: a long session of typing only ever
// needs the rows of the open menu.
const PICK_VALUES_LIMIT = 1000

const isInside = (path: string, root: string): boolean => path === root || path.startsWith(`${root.replace(/\/+$/u, '')}/`)

/** A drill keeps the typed scope prefix when the path needs no quoting; a quoted path falls back to the plain grammar. */
const drillTextFor = (query: MentionQuery, mention: string): string =>
  query.prefix !== '' && !mention.startsWith('@"') ? `@${query.prefix}${mention.slice(1)}` : mention

export default defineClient({
  name: '@dshfiles/mentions',
  locales: [mentionsLocale],
  inject: ['inputTriggers', 'sessions', 'remote', 'remote.fileReferences', 'remote.sessionReferenceResolver', 'sidebarRight', 'uiWorkspace'],
  setup(ctx) {
    const t = ctx.locale.bind(MENTIONS_LOCALE_NAMESPACE)
    const pickValues = new Map<string, PickValue>()
    const keep = (value: PickValue): string => {
      if (pickValues.size >= PICK_VALUES_LIMIT) pickValues.clear()
      const key = `${value.kind === 'file' ? `${value.fileKind}:${value.drillText}` : 'session'}:${value.mention}`
      pickValues.set(key, value)
      return key
    }
    const sessions = ctx.sessions

    const crumbsFor = (query: MentionQuery, quoted: boolean, drilled: boolean): InputTriggerCrumb[] | undefined => {
      if (!drilled || query.scope === 'thread') return undefined
      const slash = query.text.lastIndexOf('/')
      if (slash < 0) return undefined
      const segments = query.text
        .slice(0, slash)
        .split('/')
        .filter(segment => segment !== '')
      const rootMention = quoted ? '@"' : '@'
      const directoryValue = (label: string, mention: string): string =>
        keep({ kind: 'file', fileKind: 'directory', label, mention, drillText: drillTextFor(query, mention) })
      const crumbs: InputTriggerCrumb[] = [{ label: t('crumbRoot'), value: directoryValue(t('crumbRoot'), rootMention) }]
      for (const [index, segment] of segments.entries()) {
        const mention = FileMentions.format({ path: segments.slice(0, index + 1).join('/'), kind: 'directory' }, quoted)
        if (mention === undefined) return undefined
        crumbs.push({ label: segment, value: directoryValue(segment, mention), current: index === segments.length - 1 })
      }
      return crumbs
    }

    // The composer hands `openReference` no event, so a Mod-click is read from the pointer that just went down.
    let modifiedPointerAt = Number.NEGATIVE_INFINITY
    const MODIFIER_WINDOW_MS = 1000
    const wantsNewTab = (): boolean => performance.now() - modifiedPointerAt < MODIFIER_WINDOW_MS

    /** Open a referenced thread; Mod-click asks @dshfiles/main-tabs for a new tab, a plain click follows its openMode. */
    const openThread = (sessionId: string, newTab: boolean): boolean => {
      const listed = sessions.list.getSnapshot().ids.find(id => id === sessionId)
      if (listed === undefined) return false
      if (newTab && !window.dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { detail: { sessionId: listed, newTab: true }, cancelable: true }))) return true
      ctx.uiWorkspace.openSession(listed)
      return true
    }

    /** The session a sent message's chip or "Referenced session · …" line names, read from that thread's own recall events. */
    const referencedSessionAt = (element: Element, point: { readonly x: number; readonly y: number }): string | undefined => {
      const fromMention = SessionLinks.idFromMention(element.getAttribute('title') ?? '')
      if (fromMention !== undefined) return fromMention
      const threadId = element.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? ''
      const thread = sessions.list.getSnapshot().ids.find(id => id === threadId)
      const events = thread === undefined ? [] : (sessions.binding(thread)?.eventSource.getSnapshot().entries ?? []).map(entry => entry.event)
      const byLabel = SessionLinks.referencedSessions(events)
      if (element.matches(SESSION_CHIP)) return byLabel.get((element.getAttribute('title') ?? '').replace(/^@/u, ''))
      const caret = document.caretPositionFromPoint?.(point.x, point.y)
      const label = SessionLinks.labelAt({
        text: element.textContent ?? '',
        offset: caret?.offsetNode.parentElement === element ? caret.offset : undefined,
        labels: byLabel.keys(),
      })
      return label === undefined ? undefined : byLabel.get(label)
    }

    const sessionLinkOf = (target: EventTarget | null): Element | null =>
      target instanceof Element && target.closest('[data-composer-card]') === null ? target.closest(SESSION_LINK) : null

    const onPointerDown = (event: PointerEvent): void => {
      if (event.metaKey || event.ctrlKey) modifiedPointerAt = performance.now()
    }
    const onClick = (event: MouseEvent): void => {
      const link = sessionLinkOf(event.target)
      if (link === null || event.button !== 0 || document.getSelection()?.isCollapsed === false) return
      const sessionId = referencedSessionAt(link, { x: event.clientX, y: event.clientY })
      if (sessionId !== undefined && openThread(sessionId, event.metaKey || event.ctrlKey)) event.preventDefault()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const link = event.key === 'Enter' ? sessionLinkOf(event.target) : null
      if (link === null) return
      const box = link.getBoundingClientRect()
      const sessionId = referencedSessionAt(link, { x: box.left + 1, y: box.top + box.height / 2 })
      if (sessionId !== undefined && openThread(sessionId, event.metaKey || event.ctrlKey)) event.preventDefault()
    }
    // Native renders these as inert text; marking them keeps React's own nodes and only adds link semantics.
    const markLinks = (): void => {
      for (const element of document.querySelectorAll(`${SESSION_LINK}:not([data-dshfiles-session-link])`)) {
        if (element.closest('[data-composer-card]') !== null) continue
        element.setAttribute('data-dshfiles-session-link', '')
        element.setAttribute('role', 'link')
        element.setAttribute('tabindex', '0')
      }
    }
    ctx.effect(() => {
      let frame = 0
      const observer = new MutationObserver(() => {
        if (frame === 0)
          frame = requestAnimationFrame(() => {
            frame = 0
            markLinks()
          })
      })
      observer.observe(document.body, { childList: true, subtree: true })
      markLinks()
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('click', onClick)
      window.addEventListener('keydown', onKeyDown)
      return () => {
        observer.disconnect()
        cancelAnimationFrame(frame)
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('click', onClick)
        window.removeEventListener('keydown', onKeyDown)
      }
    }, 'dshfiles-mentions: referenced sessions open their thread')

    const source: InputTriggerSource = {
      trigger: '@',
      name: SOURCE_NAME,
      showGroupTitle: false,
      async candidates(session, request) {
        const startedAt = performance.now()
        if (sessions.binding(session.sessionId) === undefined) throw new Error(`mention candidates require a retained session "${session.sessionId}"`)
        const query = MentionRanking.parseQuery(request.query)
        if (query.scope === 'skill' || query.scope === 'mcp') return []
        const quoted = request.quoted === true
        const [files, threads] = await sessions.using(session.sessionId, { source: 'mentionCandidates', signal: request.signal }, async reference => {
          request.signal.throwIfAborted()
          const state = reference.binding.session.getSnapshot()
          if (state.openState !== 'open') throw state.openError ?? new Error(`session "${session.sessionId}" is not open`)
          const fileLookup: Promise<readonly FileReferenceCandidate[]> =
            query.scope === 'thread'
              ? Promise.resolve([])
              : ctx.remote.fileReferences.list(session.sessionId, query.text, request.signal).then(result => (result.ok ? result.value : []))
          const threadLookup: Promise<readonly SessionReferenceMentionCandidate[]> =
            query.scope === 'file' || quoted
              ? Promise.resolve([])
              : ctx.remote.sessionReferenceResolver.candidates(session.sessionId, query.text, request.signal).then(result => (result.ok ? result.value : []))
          return Promise.all([fileLookup, threadLookup])
        })
        if (request.signal.aborted) return []

        const now = Date.now()
        const listed = sessions.list.getSnapshot().byId
        const ownCwd = listed[session.sessionId]?.cwd
        const withLocation = crumbsFor(query, quoted, request.drilled) === undefined
        const section = t(`scope.${query.scope}`)

        const fileRows = new Map<FileEntry, InputTriggerCandidate>()
        files.forEach((candidate, hostRank) => {
          const mention = FileMentions.format(candidate, quoted)
          if (mention === undefined) return
          const slash = candidate.path.lastIndexOf('/')
          const name = candidate.path.slice(slash + 1)
          const parent = slash < 0 ? '' : candidate.path.slice(0, slash)
          const directory = candidate.kind === 'directory'
          const value: PickValue = { kind: 'file', fileKind: candidate.kind, label: name, mention, drillText: drillTextFor(query, mention) }
          const row: InputTriggerCandidate = {
            name: `${name}${directory ? '/' : ''}`,
            icon: directory ? 'folder' : 'file',
            section,
            value: keep(value),
            drill: directory,
          }
          fileRows.set({ kind: 'file', path: candidate.path, hostRank }, withLocation && parent !== '' ? { ...row, description: parent } : row)
        })

        const threadRows = new Map<ThreadEntry, InputTriggerCandidate>()
        for (const candidate of threads) {
          const summary = listed[candidate.sessionId]
          if (summary?.blank === true) continue
          const label = candidate.displayTitle ?? candidate.label
          const updatedAt = summary?.updatedAt ?? candidate.createdAt
          const child = summary?.origin === 'subagent' && summary.parentId === session.sessionId
          const age = relativeTime(updatedAt, now)
          const ageText = age.unit === 'now' ? t('time.now') : t(`time.${age.unit}`, { n: age.n })
          const location = candidate.sameWorkspace
            ? undefined
            : candidate.cwd === undefined
              ? t('noCwd')
              : FileMentions.abbreviateHome(candidate.cwd, ctx.remote.$host.home)
          const sameProject = ownCwd !== undefined && candidate.cwd !== undefined && (isInside(candidate.cwd, ownCwd) || isInside(ownCwd, candidate.cwd))
          const value: PickValue = { kind: 'session', label, mention: candidate.mention }
          threadRows.set(
            { kind: 'thread', title: label, updatedAt, sameWorkspace: candidate.sameWorkspace, sameProject },
            {
              name: label,
              description: [child ? t('subagent') : undefined, location, ageText].filter(part => part !== undefined).join(' · '),
              icon: 'session',
              section,
              value: keep(value),
            },
          )
        }

        const ranked = MentionRanking.rank({ text: query.text, entries: [...fileRows.keys(), ...threadRows.keys()], now })
        const rows = ranked.flatMap(entry => {
          const row = entry.kind === 'file' ? fileRows.get(entry) : threadRows.get(entry)
          return row === undefined ? [] : [row]
        })
        performance.measure(TIMING_MEASURE, { start: startedAt, detail: { scope: query.scope, files: files.length, threads: threads.length } })
        return rows
      },
      header(_session, request) {
        return crumbsFor(MentionRanking.parseQuery(request.query), request.quoted === true, request.drilled)
      },
      onPick({ candidate, action }) {
        const value = candidate.value === undefined ? undefined : pickValues.get(candidate.value)
        if (value === undefined) return undefined
        if (value.kind === 'session')
          return { insert: { source: SOURCE_NAME, ref: value.mention, label: value.label, appearance: 'session', clipboardText: value.mention } }
        if (value.fileKind === 'directory' && action === 'drill') return { text: value.drillText, continue: true }
        return {
          insert: {
            source: SOURCE_NAME,
            ref: value.mention,
            label: value.fileKind === 'directory' ? `${value.label}/` : value.label,
            appearance: value.fileKind === 'directory' ? 'folder' : 'file',
            clipboardText: value.mention,
          },
        }
      },
      openReference(session, reference) {
        if (reference.appearance === 'session') {
          const sessionId = SessionLinks.idFromMention(reference.ref)
          return sessionId !== undefined && openThread(sessionId, wantsNewTab())
        }
        if (reference.appearance !== 'file') return false
        const path = reference.ref.startsWith('@"') ? reference.ref.slice(2, -1) : reference.ref.slice(1)
        const cwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd
        ctx.sidebarRight.openResource(FileMentions.addressFor({ sessionId: session.sessionId, cwd, path }))
        return true
      },
      codec: {
        clipboardText: ref => ref,
        serialize: ref => Promise.resolve(ref),
      },
    }

    ctx.effect(() => ctx.inputTriggers.registerSource(source), 'dshfiles-mentions: @ source')
  },
})
