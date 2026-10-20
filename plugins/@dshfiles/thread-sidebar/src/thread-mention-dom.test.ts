// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { afterEach, test } from 'vitest'
import { ThreadMentionModel } from './thread-mention.js'

afterEach(() => {
  document.body.innerHTML = ''
})

const seat = (hostSessionId: string, parent: HTMLElement = document.body): void => {
  const host = document.createElement('div')
  host.setAttribute('data-conversation-session', hostSessionId)
  const composer = document.createElement('div')
  composer.setAttribute('data-composer-seat', '')
  host.append(composer)
  parent.append(host)
}

test('the main composer session ignores an aside conversation on screen beside it', () => {
  const aside = document.createElement('div')
  aside.setAttribute('data-dshfiles-thread-aside', '')
  seat('aside-thread', aside)
  document.body.append(aside)
  assert.equal(ThreadMentionModel.mainComposerSessionId(), undefined)

  seat('main-thread')
  assert.equal(ThreadMentionModel.mainComposerSessionId(), 'main-thread')
})

test('no composer on screen resolves no session', () => {
  assert.equal(ThreadMentionModel.mainComposerSessionId(), undefined)
})
