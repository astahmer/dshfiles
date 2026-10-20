/** Strict per-session header/body content inserted into the resident conversation layout. */

import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { resolveActiveView } from '../view-selection.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

interface SessionTitleEditorProps {
  readonly title: string
  readonly label: string
  readonly error: string | undefined
  readonly onCommit: (title: string) => void
  readonly onCancel: () => void
}

/** In-place editor for the current Session title: Enter or blur commits, Escape cancels. */
function SessionTitleEditor({ title, label, error, onCommit, onCancel }: SessionTitleEditorProps): JSX.Element {
  const [draft, setDraft] = useState(title)
  const settled = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const settle = (mode: 'commit' | 'cancel'): void => {
    if (settled.current) return
    settled.current = true
    const next = draft.trim()
    if (mode === 'cancel' || next === '' || next === title.trim()) {
      onCancel()
      return
    }
    onCommit(next)
  }
  return (
    <span className={css.titleEditor}>
      <input
        ref={input}
        aria-label={label}
        aria-invalid={error === undefined ? undefined : true}
        className={css.titleInput}
        maxLength={200}
        spellCheck={false}
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        onBlur={() => settle('commit')}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            settle('commit')
          } else if (event.key === 'Escape') {
            event.preventDefault()
            settle('cancel')
          }
        }}
      />
      {error === undefined ? null : <span role="alert" className={css.titleError}>{error}</span>}
    </span>
  )
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns Session navigation controls, with title and tabs after conversation starts.
 */
export function ConversationSessionHeader({
  sessionId, hideChrome, useSessions, useConversationViews, useStore,
  renderSlot, open, rename, selectView, t,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string>()
  useEffect(() => {
    setRenaming(false)
    setRenameError(undefined)
  }, [sessionId])
  const commitRename = async (title: string): Promise<void> => {
    try {
      await rename(sessionId, title)
      setRenaming(false)
      setRenameError(undefined)
    } catch {
      setRenameError(t('session.renameFailed'))
    }
  }
  const showTabs = !hideChrome && tabs.length > 1
  return (
    <>
      <div className={css.titleRow}>
        {!hideChrome && (
          <>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  // The current crumb is editable in place. Ancestor crumbs stay
                  // buttons because they navigate; a subagent current crumb keeps
                  // its lineage switcher and is not renamed from here.
                  const title = last
                    ? summary.subagent
                      ? (
                        <span className={clsx(css.crumb, css.crumbSubagent, css.crumbCurrent)}>
                          {summary.displayTitle}
                        </span>
                      )
                      : renaming
                        ? (
                          <SessionTitleEditor
                            title={summary.displayTitle}
                            label={t('session.renameTitle')}
                            error={renameError}
                            onCommit={next => void commitRename(next)}
                            onCancel={() => {
                              setRenaming(false)
                              setRenameError(undefined)
                            }}
                          />
                        )
                        : (
                          <button
                            type="button"
                            className={clsx(css.crumb, css.crumbCurrent, css.crumbEditable)}
                            title={t('session.renameHint')}
                            onClick={() => {
                              setRenameError(undefined)
                              setRenaming(true)
                            }}
                          >
                            {summary.displayTitle}
                          </button>
                        )
                    : (
                      <button
                        type="button"
                        className={clsx(css.crumb, summary.subagent && css.crumbSubagent)}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </>
        )}
        <div className={css.headerCorner} data-conversation-header-corner="">
          {renderSlot('conversation.session.header.corner', {})}
        </div>
      </div>
      {showTabs && (
        // data-conversation-tabs: marks the tab strip, which the window-chrome
        // geometry and the browser coverage lane anchor on.
        <div className={css.tabs} role="tablist" data-conversation-tabs="">
          {tabs.map(viewTab => (
            <button
              key={viewTab.id}
              type="button"
              role="tab"
              aria-selected={viewTab.id === active?.id}
              className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
              onClick={() => { selectView(viewTab.id) }}
            >
              {viewTab.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps) {
  return <DefaultConversationViews {...props} />
}
