import type { InputTriggerSource } from './types.js'
import type { ImageAttachmentSourceRegistration } from './image-attachment-contract.js'

export const imageAttachmentSource = (deps: ImageAttachmentSourceRegistration): InputTriggerSource => ({
  trigger: '@',
  name: 'image-attachment',
  order: -1,
  showGroupTitle: false,
  async candidates(session, request) {
    const query = request.query.trim().toLocaleLowerCase()
    return deps
      .imagesFor(session.sessionId)
      .filter(image => query === '' || image.label.toLocaleLowerCase().includes(query))
      .map(image => ({ name: image.label, icon: 'file', value: image.id }))
  },
  onPick({ candidate, session }) {
    const image = deps.imagesFor(session.sessionId).find(item => item.id === candidate.value)
    if (image === undefined) return undefined
    return {
      insert: {
        source: 'image-attachment',
        ref: image.id,
        label: image.label,
        appearance: 'file',
        clipboardText: `[${image.label}]`,
      },
    }
  },
  openReference(session, reference) {
    return deps.open(session.sessionId, reference.ref)
  },
  restore(session, text) {
    const images = deps.imagesFor(session.sessionId)
    return [...text.matchAll(/\[Image (\d+)\]/gu)].flatMap(token => {
      const index = Number(token[1])
      const image = Number.isSafeInteger(index) && index > 0 ? images[index - 1] : undefined
      if (image === undefined) return []
      const start = token.index ?? 0
      return [
        {
          source: 'image-attachment',
          ref: image.id,
          label: image.label,
          appearance: 'file' as const,
          clipboardText: token[0],
          start,
          end: start + token[0].length,
        },
      ]
    })
  },
  codec: {
    clipboardText: () => '[Image]',
    serialize: (_ref, _signal, label) => Promise.resolve(`[${label}]`),
  },
})
