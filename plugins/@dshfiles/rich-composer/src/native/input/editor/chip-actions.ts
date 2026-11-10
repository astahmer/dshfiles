import { $getNodeByKey, type LexicalEditor } from 'lexical'
import { ComposerSnippets } from '../../../composer-snippets.ts'
import type { ChipActions } from './chip-actions-context.ts'
import { $isReferenceChipNode } from './chip-node.tsx'

export const createChipActions = (editor: LexicalEditor): ChipActions => ({
  remove: key => {
    editor.update(() => {
      const node = $getNodeByKey(key)
      if ($isReferenceChipNode(node)) node.remove()
    })
  },
  setComment: ({ key, comment }) => {
    editor.update(() => {
      const node = $getNodeByKey(key)
      if ($isReferenceChipNode(node)) node.setReference(ComposerSnippets.withComment(node.getReference(), comment))
    })
  },
})
