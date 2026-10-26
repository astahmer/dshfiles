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
  codec: {
    clipboardText: () => '[Image]',
    serialize: (_ref, _signal, label) => Promise.resolve(`[${label}]`),
  },
})
