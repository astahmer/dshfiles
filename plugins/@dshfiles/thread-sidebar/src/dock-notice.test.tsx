import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { test } from 'vitest'
import { DockNotice } from './dock-notice.js'

const render = (): string =>
  renderToString(
    <DockNotice
      label="This thread is settled."
      heading="Settled 2h"
      icon={<span aria-hidden>icon</span>}
      meta={<time dateTime="2026-10-19T10:00:00.000Z">Archives in 6d</time>}
      actionLabel="Thread actions"
      actions={<button type="button">Unsettle</button>}
    />,
  )

test('a dock notice is one labelled status strip with its title, dating and actions', () => {
  const html = render()
  assert.match(html, /role="status"/)
  assert.match(html, /aria-label="This thread is settled\."/)
  assert.match(html, /Settled 2h/)
  assert.match(html, /Archives in 6d/)
  assert.match(html, /aria-label="Thread actions"/)
  assert.match(html, /Unsettle/)
})

test('a dock notice hugs its content instead of stretching to the dock width', () => {
  const html = render()
  // A strip, not a panel: fit-content, capped, centred, one row unless the pane cannot hold it.
  assert.match(html, /dshx:w-fit/)
  assert.match(html, /dshx:max-w-lg/)
  assert.match(html, /dshx:mx-auto/)
  assert.match(html, /dshx:flex-wrap/)
  assert.doesNotMatch(html, /dshx:w-full/)
})

test('the dating slot is optional', () => {
  const withoutMeta = renderToString(
    <DockNotice
      label="This thread is archived."
      heading="Archived"
      icon={<span aria-hidden>icon</span>}
      actionLabel="Thread actions"
      actions={<button type="button">Restore</button>}
    />,
  )
  assert.match(withoutMeta, /Archived/)
  assert.doesNotMatch(withoutMeta, /tabular-nums/)
})
