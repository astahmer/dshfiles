import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  LineBreakNode,
  TextNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { RichTextEditor, type RichTextEditorHandle } from '@dshfiles/rich-composer/rich-text-editor'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { forwardRef, useEffect, useImperativeHandle, useRef, type KeyboardEventHandler } from 'react'

import { ImageAttachmentReferenceModel } from './image-attachment-reference.js'
import type { ImageReferenceOccurrence } from './image-attachment-reference.js'
import type { ComposerFile } from './composer-files.js'
import { $createImageReferenceTextNode, $isImageReferenceTextNode, ImageReferenceTextNode } from './image-reference-node.js'

export interface BacklogImageEditorHandle {
  readonly element: () => HTMLDivElement | null
  readonly focus: () => void
  readonly getCaret: () => number
  readonly getSelectionRange: () => { readonly start: number; readonly end: number }
  readonly getText: () => string
  readonly getMarkdownText: () => string
  readonly setCaret: (offset: number) => void
  readonly replaceRange: (start: number, end: number, text: string) => void
  readonly replaceText: (text: string) => void
  readonly insertImageReferences: (files: readonly ComposerFile[], firstImageNumber: number) => void
}

interface BacklogImageEditorProps {
  readonly value: string
  readonly files: readonly ComposerFile[]
  readonly placeholder: string
  readonly placeholderClassName?: string
  readonly ariaLabel: string
  readonly className: string
  readonly onChange: (value: string) => void
  readonly onCaretChange: (offset: number) => void
  readonly onPasteFiles: (files: readonly File[]) => void
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>
  readonly onFocus?: (() => void) | undefined
  readonly autoFocus?: boolean | undefined
}

const imageReferencePattern = /(?<![\w@])@Image (\d+)(?!\w)/u

const imageFiles = (files: readonly ComposerFile[]): readonly ComposerFile[] => files.filter(file => file.kind === 'image')

const imageReferenceMatch = (text: string): { readonly start: number; readonly end: number; readonly number: number } | null => {
  const match = imageReferencePattern.exec(text)
  const number = Number(match?.[1])
  if (match === null || match.index === undefined || !Number.isSafeInteger(number) || number < 1) return null
  return { start: match.index, end: match.index + match[0].length, number }
}

const buildInlineNodes = (text: string, files: readonly ComposerFile[]): readonly LexicalNode[] => {
  const nodes: LexicalNode[] = []
  const pattern = /(?<![\w@])@Image (\d+)(?!\w)/gu
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const reference = match[0]
    const start = match.index
    const number = Number(match[1])
    if (reference === undefined || start === undefined || number < 1) continue
    const image = imageFiles(files)[number - 1]
    if (start > cursor) nodes.push($createTextNode(text.slice(cursor, start)))
    nodes.push($createImageReferenceTextNode(reference, image?.id ?? '', image !== undefined))
    cursor = start + reference.length
  }

  if (cursor < text.length) nodes.push($createTextNode(text.slice(cursor)))
  return nodes
}

interface TextProjection {
  readonly text: string
  readonly references: readonly ImageReferenceOccurrence[]
}

const projectNodes = (nodes: readonly LexicalNode[], separator: string): TextProjection => {
  let text = ''
  const references: ImageReferenceOccurrence[] = []
  nodes.forEach((node, index) => {
    if (index > 0) text += separator
    const projection = projectNode(node)
    const start = text.length
    text += projection.text
    references.push(...projection.references.map(reference => ({ ...reference, start: start + reference.start, end: start + reference.end })))
  })
  return { text, references }
}

const projectNode = (node: LexicalNode): TextProjection => {
  if ($isImageReferenceTextNode(node)) {
    const text = node.getTextContent()
    return { text, references: [{ start: 0, end: text.length, attachmentId: node.getAttachmentId() }] }
  }
  if (node instanceof LineBreakNode) return { text: '\n', references: [] }
  if (node instanceof TextNode) return { text: node.getTextContent(), references: [] }
  if ($isElementNode(node)) return projectNodes(node.getChildren(), '')
  return { text: node.getTextContent(), references: [] }
}

/** The current document as Markdown, inside the editor read it is called from. */
const projectMarkdown = (files: readonly ComposerFile[]): string => {
  const projection = projectNodes($getRoot().getChildren(), '\n')
  return ImageAttachmentReferenceModel.markdownImageReferencesFromEditor(projection.text, projection.references, files)
}

export const registerImageReferenceTextEntity = (editor: LexicalEditor, filesOf: () => readonly ComposerFile[]): (() => void) =>
  editor.registerNodeTransform(TextNode, node => {
    if ($isImageReferenceTextNode(node)) return
    const text = node.getTextContent()
    const match = imageReferenceMatch(text)
    if (match === null) return
    const image = imageFiles(filesOf())[match.number - 1]
    const replacementNodes = node.splitText(match.start, match.end)
    const matchedNode = replacementNodes[match.start === 0 ? 0 : 1]
    if (matchedNode === undefined) return
    const reference = new ImageReferenceTextNode(text.slice(match.start, match.end), image?.id ?? '', image !== undefined)
    reference.setFormat(matchedNode.getFormat())
    matchedNode.replace(reference)
  })

/** Refresh each image token's attachment and validity after the attachment tray changed; runs inside the editor update. */
const syncImageReferences = (files: readonly ComposerFile[]): void => {
  for (const node of $getRoot().getAllTextNodes()) {
    if (!$isImageReferenceTextNode(node)) continue
    const attachmentId = node.getAttachmentId()
    if (attachmentId === '') {
      const match = imageReferencePattern.exec(node.getTextContent())
      const image = match === null ? undefined : imageFiles(files)[Number(match[1]) - 1]
      if (image !== undefined) node.setAttachmentId(image.id)
    }
    node.setValid(node.getAttachmentId() !== '' && files.some(file => file.kind === 'image' && file.id === node.getAttachmentId()))
  }
}

export const BacklogImageEditor = forwardRef<BacklogImageEditorHandle, BacklogImageEditorProps>((props, forwardedRef) => {
  const propsRef = useRef(props)
  propsRef.current = props
  const editor = useRef<RichTextEditorHandle | null>(null)

  useEffect(() => {
    editor.current?.update(() => syncImageReferences(propsRef.current.files))
  }, [props.files, props.value])

  useImperativeHandle(
    forwardedRef,
    (): BacklogImageEditorHandle => ({
      element: () => editor.current?.element() ?? null,
      focus: () => editor.current?.focus(),
      getCaret: () => editor.current?.getCaret() ?? 0,
      getSelectionRange: () => editor.current?.getSelectionRange() ?? { start: 0, end: 0 },
      getText: () => editor.current?.getText() ?? propsRef.current.value,
      getMarkdownText: () => editor.current?.getProjectedText() ?? propsRef.current.value,
      setCaret: offset => editor.current?.setCaret(offset),
      replaceRange: (start, end, text) => editor.current?.replaceRange(start, end, text),
      replaceText: next => editor.current?.replaceText(next),
      insertImageReferences: (files, firstImageNumber) => {
        const images = imageFiles(files)
        const seat = editor.current
        if (images.length === 0 || seat === null) return
        const text = seat.getText()
        const range = seat.getSelectionRange()
        const start = Math.min(range.start, range.end)
        const end = Math.max(range.start, range.end)
        const before = text.slice(0, start)
        const after = text.slice(end)
        const prefix = before !== '' && !/\s$/u.test(before) ? ' ' : ''
        const suffix = after !== '' && !/^\s/u.test(after) ? ' ' : ''
        seat.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          const nodes: LexicalNode[] = []
          if (prefix !== '') nodes.push($createTextNode(prefix))
          images.forEach((file, index) => {
            nodes.push($createImageReferenceTextNode(`@Image ${firstImageNumber + index + 1}`, file.id))
            if (index < images.length - 1) nodes.push($createTextNode(' '))
          })
          if (suffix !== '') nodes.push($createTextNode(suffix))
          selection.insertNodes(nodes)
        })
        const referencesLength = images.reduce((length, _, index) => length + `@Image ${firstImageNumber + index + 1}`.length, 0) + images.length - 1
        seat.setCaret(start + prefix.length + referencesLength)
      },
    }),
    [],
  )

  return (
    <div className="dshx:relative">
      {props.value === '' ? (
        <div
          aria-hidden="true"
          className={cn('dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:z-10 dshx:text-muted-foreground', props.placeholderClassName)}
        >
          {props.placeholder}
        </div>
      ) : null}
      <RichTextEditor
        ref={editor}
        ariaLabel={props.ariaLabel}
        autoFocus={props.autoFocus}
        value={props.value}
        className={props.className}
        nodes={[ImageReferenceTextNode]}
        parseLine={line => buildInlineNodes(line, propsRef.current.files)}
        project={() => projectMarkdown(propsRef.current.files)}
        isAtomicNode={node => $isImageReferenceTextNode(node)}
        register={seat => registerImageReferenceTextEntity(seat, () => propsRef.current.files)}
        onPasteFiles={props.onPasteFiles}
        onKeyDownCapture={props.onKeyDown}
        onFocus={props.onFocus}
        onChange={props.onChange}
        onCaretChange={props.onCaretChange}
      />
    </div>
  )
})

BacklogImageEditor.displayName = 'BacklogImageEditor'
