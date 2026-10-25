// @vitest-environment jsdom
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { $createReferenceChipNode, ReferenceChipNode } from './chip-node.js'
import { registerReferenceActivation } from './reference-activation.js'

vi.mock('./ReferenceChip.js', () => ({ ReferenceChip: () => null }))

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('reference chip activation', () => {
  it('opens an atomic chip when the previous text selection was non-collapsed', () => {
    const editor = createEditor({ namespace: 'reference-chip-activation-test', nodes: [ReferenceChipNode] })
    const rootElement = document.createElement('div')
    rootElement.contentEditable = 'true'
    editor.setRootElement(rootElement)
    disposers.push(() => editor.setRootElement(null))
    const open = vi.fn(() => true)
    disposers.push(registerReferenceActivation(editor, open))

    editor.update(() => {
      const paragraph = $createParagraphNode()
      const selectedText = $createTextNode('selected text')
      paragraph.append(selectedText, $createReferenceChipNode({
        source: 'image-attachment',
        ref: 'draft-image-b',
        label: 'Image 2',
        appearance: 'file',
        clipboardText: '[Image 2]',
      }))
      $getRoot().append(paragraph)
      selectedText.select(0, 4)
    }, { discrete: true })

    const chip = rootElement.querySelector('[data-composer-chip="image-attachment"]')
    expect(chip).not.toBeNull()
    const chipLabel = document.createElement('span')
    chip?.append(chipLabel)
    chipLabel.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }))

    expect(open).toHaveBeenCalledWith('image-attachment', { ref: 'draft-image-b', appearance: 'file' })
  })
})
