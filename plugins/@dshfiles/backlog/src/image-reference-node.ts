import type { EditorConfig, LexicalNode, NodeKey, SerializedTextNode, Spread } from 'lexical'
import { TextNode } from 'lexical'

export type SerializedImageReferenceTextNode = Spread<{ attachmentId: string; valid: boolean }, SerializedTextNode>

export class ImageReferenceTextNode extends TextNode {
  __attachmentId: string
  __valid: boolean

  static override getType(): string {
    return 'backlog-image-reference'
  }

  static override clone(node: ImageReferenceTextNode): ImageReferenceTextNode {
    return new ImageReferenceTextNode(node.__text, node.__attachmentId, node.__valid, node.__key)
  }

  static override importJSON(json: SerializedImageReferenceTextNode): ImageReferenceTextNode {
    const node = new ImageReferenceTextNode(json.text, json.attachmentId, json.valid)
    node.setFormat(json.format)
    node.setDetail(json.detail)
    node.setStyle(json.style)
    return node
  }

  constructor(text: string, attachmentId: string, valid = true, key?: NodeKey) {
    super(text, key)
    this.__attachmentId = attachmentId
    this.__valid = valid
    this.setMode('token')
  }

  override exportJSON(): SerializedImageReferenceTextNode {
    return {
      ...super.exportJSON(),
      type: 'backlog-image-reference',
      attachmentId: this.__attachmentId,
      valid: this.__valid,
    }
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.dataset.dshfilesImageReference = 'true'
    if (!this.__valid) element.dataset.invalid = 'true'
    return element
  }

  override updateDOM(previousNode: this, element: HTMLElement, config: EditorConfig): boolean {
    if (this.__valid) delete element.dataset.invalid
    else element.dataset.invalid = 'true'
    return super.updateDOM(previousNode, element, config)
  }

  override isTextEntity(): true {
    return true
  }

  setValid(valid: boolean): void {
    if (this.getLatest().__valid !== valid) this.getWritable().__valid = valid
  }

  setAttachmentId(attachmentId: string): void {
    if (this.getLatest().__attachmentId !== attachmentId) this.getWritable().__attachmentId = attachmentId
  }

  getAttachmentId(): string {
    return this.getLatest().__attachmentId
  }

  isValid(): boolean {
    return this.getLatest().__valid
  }
}

export const $createImageReferenceTextNode = (text: string, attachmentId: string, valid = true): ImageReferenceTextNode =>
  new ImageReferenceTextNode(text, attachmentId, valid)

export const $isImageReferenceTextNode = (node: LexicalNode | null | undefined): node is ImageReferenceTextNode => node instanceof ImageReferenceTextNode
