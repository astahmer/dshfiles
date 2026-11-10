import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputTriggerCandidate, InputTriggerCrumb, InputTriggerSource, RestoredReference } from '@dshfiles/input-trigger/client'
import { EntityKinds, EntityRegistryModel } from '@dshfiles/input-trigger/entity-registry'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference'
import { InlineReferences } from '@dshfiles/chat/inline-references'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { createApiClient, defineClient, LinkHandler } from '@dshfiles/dshx/client'
import { MainTabs } from '@dshfiles/main-tabs/tabs-contract'
import { multiHostApi } from '@dshfiles/multi-host/api'
import { FileMentions } from './file-mentions.js'
import { remoteMentionCandidates } from './remote-mention-candidates.js'
import { MENTIONS_LOCALE_NAMESPACE, mentionsLocale } from './locales.js'
import { MentionRanking, type FileEntry, type MentionQuery, type ThreadEntry } from './mention-ranking.js'
import { SessionLinks } from './session-links.js'
import { SessionMentionChip, SessionReferenceLinks } from './session-reference-links.js'
import './client.css'

// The native chip codec, copy/paste and send-time serialization are keyed by this source name.
const SOURCE_NAME = 'reference'
/** This plugin's kind in input-trigger's entity registry. */
const ENTITY_KIND = 'reference'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** An `@` menu lookup holding the composer's Session open for its two Host reads. */
    mentionCandidates: unknown
  }
}
const TIMING_MEASURE = 'dshfiles-mentions:candidates'
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
  inject: ['sessions', 'slots', 'remote', 'remote.fileReferences', 'remote.sessionReferenceResolver', 'sidebarRight', 'uiWorkspace'],
  setup(ctx, _decorate, metadata) {
    const multiHost = createApiClient(ctx, multiHostApi, '@dshfiles/multi-host')
    const entityKinds = metadata?.plugin?.list(EntityKinds)
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

    // The composer and a Markdown link hand their opener no event, so a Mod-click is read from the pointer that just went down.
    let modifiedPointerAt = Number.NEGATIVE_INFINITY
    const MODIFIER_WINDOW_MS = 1000
    const wantsNewTab = (): boolean => performance.now() - modifiedPointerAt < MODIFIER_WINDOW_MS

    /** Open a referenced thread; Mod-click asks @dshfiles/main-tabs for a new tab, a plain click follows its openMode. */
    const openThread = (sessionId: string, newTab: boolean): boolean => {
      const listed = sessions.list.getSnapshot().ids.find(id => id === sessionId)
      if (listed === undefined) return false
      const tabs = newTab ? metadata?.plugin?.use(MainTabs).get() : undefined
      if (tabs?.status === 'active' && tabs.value.open({ kind: 'thread', sessionId: listed }, { newTab: true }) !== undefined) return true
      ctx.uiWorkspace.openSession(listed)
      return true
    }

    /** Label → session id for every session one thread's loaded messages referenced, from its own recall events. */
    const referencedSessions = (threadId: string): ReadonlyMap<string, string> => {
      const thread = sessions.list.getSnapshot().ids.find(id => id === threadId)
      const events = thread === undefined ? [] : (sessions.binding(thread)?.eventSource.getSnapshot().entries ?? []).map(entry => entry.event)
      return SessionLinks.referencedSessions(events)
    }
    // Chat renders the "Referenced session · …" line and the sent chip through typed seats; this plugin only answers.
    const sessionForLabel = (label: string): string | undefined => {
      for (const threadId of sessions.list.getSnapshot().ids) {
        const sessionId = referencedSessions(threadId).get(label)
        if (sessionId !== undefined) return sessionId
      }
      return undefined
    }
    SessionReferenceLinks.connect({ openThread, referencedSessions, sessionForLabel })
    metadata?.plugin?.add(InlineReferences, SessionReferenceLinks.summary)
    // An Agent writes `@[label](dsh-session:…)`; Markdown keeps it as a link that opens through this handler.
    metadata?.plugin?.add(LinkHandler, {
      id: 'dshfiles-mentions.session',
      scheme: 'dsh-session',
      open: link => {
        const sessionId = SessionLinks.idFromMention(link.href)
        if (sessionId !== undefined) openThread(sessionId, wantsNewTab())
      },
    })
    // A keyed cell renders its lowest priority: 50 shadows the native renderer's 100 with the same chip plus link semantics.
    ctx.slots.inject('conversation.user.text.node', () =>
      ctx.slots.register({ name: 'conversation.user.text.node', key: 'session', priority: 50 }, SessionMentionChip),
    )
    ctx.effect(() => {
      const onPointerDown = (event: PointerEvent): void => {
        if (event.metaKey || event.ctrlKey) modifiedPointerAt = performance.now()
      }
      window.addEventListener('pointerdown', onPointerDown, true)
      return () => window.removeEventListener('pointerdown', onPointerDown, true)
    }, 'dshfiles-mentions: Mod-click opens a referenced thread in a new tab')

    const source: InputTriggerSource = {
      trigger: '@',
      name: SOURCE_NAME,
      showGroupTitle: false,
      async candidates(session, request) {
        const startedAt = performance.now()
        if (sessions.binding(session.sessionId) === undefined) throw new Error(`mention candidates require a retained session "${session.sessionId}"`)
        const query = MentionRanking.parseQuery(request.query)
        // A scope another registry kind owns (`@skill:`, `@b:`, …) lists only that kind; the built-in ones stay as a fallback.
        if (EntityRegistryModel.foreignScope(entityKinds?.get() ?? [], ENTITY_KIND, request.query)) return []
        if (query.scope === 'skill' || query.scope === 'mcp' || query.scope === 'backlog' || query.scope === 'agent') return []
        const quoted = request.quoted === true
        const [files, threads, remoteThreads] = await sessions.using(
          session.sessionId,
          { source: 'mentionCandidates', signal: request.signal },
          async reference => {
            request.signal.throwIfAborted()
            const state = reference.binding.session.getSnapshot()
            if (state.openState !== 'open') throw state.openError ?? new Error(`session "${session.sessionId}" is not open`)
            const fileLookup: Promise<readonly FileReferenceCandidate[]> =
              query.scope === 'thread'
                ? Promise.resolve([])
                : (async () => {
                    // Without multi-host loaded every Session is local: the missing route must not reject the whole lookup,
                    // or the thread rows that do not depend on it vanish with the file rows.
                    const ownership = await multiHost.sessionRuntime({ sessionId: session.sessionId }, { signal: request.signal }).catch((error: unknown) => {
                      if (error instanceof Error && isApiOwnerMissing(error)) return { ok: true as const, runtimeId: null }
                      throw error
                    })
                    if (!ownership.ok) return []
                    if (ownership.runtimeId === null) {
                      const result = await ctx.remote.fileReferences.list(session.sessionId, query.text, request.signal)
                      return result.ok ? result.value : []
                    }
                    const result = await multiHost.runtimeFileReferences(
                      { runtimeId: ownership.runtimeId, sessionId: session.sessionId, query: query.text },
                      { signal: request.signal },
                    )
                    return result.ok ? result.candidates : []
                  })()
            const threadLookup: Promise<readonly SessionReferenceMentionCandidate[]> =
              query.scope === 'file'
                ? Promise.resolve([])
                : ctx.remote.sessionReferenceResolver.candidates(session.sessionId, query.text, request.signal).then(result => (result.ok ? result.value : []))
            const remoteThreadLookup: Promise<readonly SessionReferenceMentionCandidate[]> =
              query.scope === 'file'
                ? Promise.resolve([])
                : multiHost
                    .threadList(undefined, { signal: request.signal })
                    .then(result => {
                      const listed = sessions.list.getSnapshot().byId
                      return remoteMentionCandidates({
                        threads: result.threads,
                        sessions: listed,
                        currentSessionId: session.sessionId,
                        currentCwd: listed[session.sessionId]?.cwd,
                      })
                    })
                    .catch(() => [])
            return Promise.all([fileLookup, threadLookup, remoteThreadLookup])
          },
        )
        if (request.signal.aborted) return []

        const now = Date.now()
        const listed = sessions.list.getSnapshot().byId
        const allThreads = [...threads, ...remoteThreads.filter(remote => !threads.some(local => local.sessionId === remote.sessionId))]
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
        for (const candidate of allThreads) {
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
        performance.measure(TIMING_MEASURE, { start: startedAt, detail: { scope: query.scope, files: files.length, threads: allThreads.length } })
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
      restore(_session, text) {
        const mentions: RestoredReference[] = [
          ...SessionLinks.matches(text).map((match): RestoredReference => ({
            source: SOURCE_NAME,
            ref: match.mention,
            label: match.label,
            appearance: 'session' as const,
            clipboardText: match.mention,
            start: match.start,
            end: match.end,
          })),
          ...FileMentions.matches(text).map((match): RestoredReference => ({
            source: SOURCE_NAME,
            ref: match.mention,
            label: match.kind === 'directory' ? `${match.path}` : match.path,
            appearance: match.kind === 'directory' ? 'folder' : 'file',
            clipboardText: match.mention,
            start: match.start,
            end: match.end,
          })),
        ]
        return mentions.sort((left, right) => left.start - right.start)
      },
    }

    // Files and threads are the first `@` group; input-trigger's entity registry registers it with the composer.
    metadata?.plugin?.add(EntityKinds, {
      kind: ENTITY_KIND,
      label: 'File or thread',
      order: 0,
      mentionPrefixes: ['thread', 't', 'file', 'f'],
      mentionSource: source,
    })
  },
})
