import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { describe, expect, it } from 'vitest'

import { $createImageReferenceTextNode, $isImageReferenceTextNode, ImageReferenceTextNode } from './image-reference-node.js'
import { registerImageReferenceTextEntity, replaceEditorContents } from './image-reference-editor.js'
import type { ComposerFile } from './composer-files.js'

const image: ComposerFile = {
  id: 'image-one',
  kind: 'image',
  name: 'one.png',
  mediaType: 'image/png',
  bytes: 1,
  dataUrl: 'data:image/png;base64,AA==',
}

describe('ImageReferenceTextNode', () => {
  it('projects as plain text while behaving as one stable token', () => {
    const editor = createEditor({
      namespace: 'backlog-image-reference-test',
      nodes: [ImageReferenceTextNode],
      onError: error => {
        throw error
      },
    })
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        paragraph.append($createImageReferenceTextNode('@Image 1', 'image-one'))
        $getRoot().append(paragraph)
      },
      { discrete: true },
    )

    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant()
        if ($isImageReferenceTextNode(node)) node.setValid(false)
      },
      { discrete: true },
    )
    const projection = editor.getEditorState().read(() => {
      const node = $getRoot().getFirstDescendant()
      if (!$isImageReferenceTextNode(node)) return null
      return { text: $getRoot().getTextContent(), mode: node.getMode(), attachmentId: node.getAttachmentId(), entity: node.isTextEntity(), valid: node.isValid() }
    })

    expect(projection).toEqual({
      text: '@Image 1',
      mode: 'token',
      attachmentId: 'image-one',
      entity: true,
      valid: false,
    })
  })

  it('seeds rich content inside a paragraph and preserves line breaks', () => {
    const editor = createEditor({
      namespace: 'backlog-image-reference-seed-test',
      nodes: [ImageReferenceTextNode],
      onError: error => {
        throw error
      },
    })
    replaceEditorContents(editor, 'Before @Image 1\\nAfter', [image])

    const state = editor.getEditorState().read(() => ({
      rootChildTypes: $getRoot()
        .getChildren()
        .map(node => node.getType()),
      text: $getRoot().getTextContent(),
      references: $getRoot()
        .getAllTextNodes()
        .filter($isImageReferenceTextNode)
        .map(node => node.getAttachmentId()),
    }))

    expect(state).toEqual({ rootChildTypes: ['paragraph'], text: 'Before @Image 1\\nAfter', references: ['image-one'] })
  })

  it('turns typed attachment references into atomic nodes and keeps unknown refs invalid', () => {
    const editor = createEditor({
      namespace: 'backlog-image-reference-transform-test',
      nodes: [ImageReferenceTextNode],
      onError: error => {
        throw error
      },
    })
    const unregister = registerImageReferenceTextEntity(editor, () => [image])
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        paragraph.append($createTextNode('Look @Image 1 and @Image 2'))
        $getRoot().append(paragraph)
      },
      { discrete: true },
    )

    const references = editor.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .filter($isImageReferenceTextNode)
        .map(node => ({ text: node.getTextContent(), id: node.getAttachmentId(), valid: node.isValid() })),
    )
    unregister()

    expect(references).toEqual([
      { text: '@Image 1', id: 'image-one', valid: true },
      { text: '@Image 2', id: '', valid: false },
    ])
  })
})
