import assert from 'node:assert/strict'
import { test } from 'vitest'
import { SessionQueueEditorModel } from './session-queue-editor.js'

class Composer {
  restored = 0
  private readonly deps = { inputTriggers: () => ({ restore: () => 1 }) }

  restoreReferences(): boolean {
    this.restored += this.deps.inputTriggers().restore()
    return true
  }
}

test('restoring reference chips runs on the composer itself, keeping its own state', () => {
  const composer = new Composer()
  SessionQueueEditorModel.restoreComposerReferences(composer)
  assert.equal(composer.restored, 1)
})
