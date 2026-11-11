import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ImagePreview } from '@dshfiles/image-preview'

// Ordinary Node, not Vite: an unbundled Host consumer must load the built JavaScript.
test('the image preview library loads built JavaScript', () => {
  assert.ok(import.meta.resolve('@dshfiles/image-preview').endsWith('/dist/image-preview.js'))
  assert.equal(ImagePreview.typeOf('shot.png'), 'image/png')
})
