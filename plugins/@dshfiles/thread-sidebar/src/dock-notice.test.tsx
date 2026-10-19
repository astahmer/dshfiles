import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { test } from 'vitest'
import { DockNotice } from './dock-notice.js'

const render = (): string =>
  renderToString(
    <DockNotice
      label="This thread is settled."
      icon={<span aria-hidden>icon</span>}
      meta={<time dateTime="2026-10-19T10:00:00.000Z">Settled 2h</time>}
      actions={<button type="button">Unsettle to reply</button>}
    />,
  )

test('a dock notice is one labelled status card with its label, dating and actions', () => {
  const html = render()
  assert.match(html, /role="status"/)
  assert.match(html, /aria-label="This thread is settled\."/)
  assert.match(html, /This thread is settled\./)
  assert.match(html, /Settled 2h/)
  assert.match(html, /Unsettle to reply/)
})

test('a dock notice hugs its content instead of stretching to the dock width', () => {
  const html = render()
  // The presentation the settled and archived notices agreed on: fit-content, capped, centred.
  assert.match(html, /dshx:w-fit/)
  assert.match(html, /dshx:max-w-lg/)
  assert.match(html, /dshx:mx-auto/)
  assert.doesNotMatch(html, /dshx:w-full/)
})

test('the dating slot is optional', () => {
  const html = renderToString(
    <DockNotice label="This thread is archived." icon={<span aria-hidden>icon</span>} actions={<button type="button">Restore to reply</button>} />,
  )
  assert.match(html, /This thread is archived\./)
  assert.doesNotMatch(html, /tabular-nums/)
})
