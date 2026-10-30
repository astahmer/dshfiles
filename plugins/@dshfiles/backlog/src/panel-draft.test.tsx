// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { useComposerFiles } from './composer-attachments.js'
import { useComposerDraft } from './composer-draft.js'
import { BACKLOG_PANEL_ID, panelDraftKey } from './panel-draft.js'

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))

describe('backlog panel drafts', () => {
  it('keeps legacy and repeatable occurrences separate through remount and clear', async () => {
    localStorage.setItem('dshfiles.backlog.draft.v1', JSON.stringify({ feed: 'legacy draft' }))
    const first = 'view/backlog/first'
    const second = 'view/backlog/second'
    expect(panelDraftKey(undefined)).toBe('feed')
    expect(panelDraftKey(BACKLOG_PANEL_ID)).toBe('feed')
    expect(panelDraftKey(first)).not.toBe(panelDraftKey(second))

    const handles = new Map<string, { draft: ReturnType<typeof useComposerDraft>; files: ReturnType<typeof useComposerFiles> }>()
    const Panel = (props: { id: string }) => {
      const draftKey = panelDraftKey(props.id)
      const draft = useComposerDraft(draftKey)
      const files = useComposerFiles({ draftKey, onError: () => undefined })
      handles.set(props.id, { draft, files })
      return (
        <div>
          {draft.text}:{files.files.map(file => file.name).join(',')}
        </div>
      )
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    const mount = () =>
      root.render(
        <>
          <Panel id={BACKLOG_PANEL_ID} />
          <Panel id={first} />
          <Panel id={second} />
        </>,
      )
    await act(async () => mount())
    expect(handles.get(BACKLOG_PANEL_ID)?.draft.text).toBe('legacy draft')
    await act(async () => {
      handles.get(first)?.draft.setText('first draft')
      handles.get(second)?.draft.setText('second draft')
      await handles.get(first)?.files.add([new File(['one'], 'one.txt', { type: 'text/plain' })])
      await handles.get(second)?.files.add([new File(['two'], 'two.txt', { type: 'text/plain' })])
    })
    await act(async () => root.render(null))
    await act(async () => mount())
    expect(handles.get(first)?.draft.text).toBe('first draft')
    expect(handles.get(first)?.files.files.map(file => file.name)).toEqual(['one.txt'])
    expect(handles.get(second)?.draft.text).toBe('second draft')
    expect(handles.get(second)?.files.files.map(file => file.name)).toEqual(['two.txt'])
    await act(async () => {
      handles.get(first)?.draft.setText('')
      handles.get(first)?.files.clear()
    })
    await act(async () => root.render(null))
    await act(async () => mount())
    expect(handles.get(first)?.draft.text).toBe('')
    expect(handles.get(first)?.files.files).toEqual([])
    expect(handles.get(second)?.draft.text).toBe('second draft')
    expect(handles.get(second)?.files.files.map(file => file.name)).toEqual(['two.txt'])
    expect(handles.get(BACKLOG_PANEL_ID)?.draft.text).toBe('legacy draft')
    await act(async () => root.unmount())
  })
})
