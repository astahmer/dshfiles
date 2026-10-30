import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import { registerPlainText } from '@lexical/plain-text'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $isElementNode,
  $isRangeSelection,
  $getRoot,
  $getSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  LineBreakNode,
  mergeRegister,
  PASTE_COMMAND,
  TextNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from 'lexical'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, type KeyboardEventHandler } from 'react'

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

type Point = { readonly key: string; readonly offset: number; readonly type: 'text' | 'element' }

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

const buildRichTextNodes = (text: string, files: readonly ComposerFile[]): LexicalNode[] => {
  const nodes: LexicalNode[] = []
  text.split('\n').forEach((line, index) => {
    if (index > 0) nodes.push($createLineBreakNode())
    nodes.push(...buildInlineNodes(line, files))
  })
  if (text === '') nodes.push($createTextNode(''))
  return nodes
}

const parentPoint = (node: LexicalNode, offset: number): Point => {
  const parent = node.getParentOrThrow()
  return { key: parent.getKey(), offset, type: 'element' }
}

const resolvePoint = (offset: number): Point | null => {
  const root = $getRoot()
  const paragraph = root.getFirstChild()
  if (!$isElementNode(paragraph)) return { key: root.getKey(), offset: 0, type: 'element' }
  const children = paragraph.getChildren()
  let cursor = 0

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child === undefined) continue
    const length = child.getTextContent().length
    const end = cursor + length
    if (offset < end || (offset === end && index === children.length - 1)) {
      if ($isImageReferenceTextNode(child)) return parentPoint(child, offset <= cursor ? index : index + 1)
      if (child instanceof LineBreakNode) return parentPoint(child, offset <= cursor ? index : index + 1)
      if (child instanceof TextNode) return { key: child.getKey(), offset: Math.max(0, Math.min(length, offset - cursor)), type: 'text' }
    }
    cursor = end
  }

  return { key: paragraph.getKey(), offset: children.length, type: 'element' }
}

const setRange = (start: number, end: number): boolean => {
  const anchor = resolvePoint(start)
  const focus = resolvePoint(end)
  if (anchor === null || focus === null) return false
  const selection = $createRangeSelection()
  selection.anchor.set(anchor.key, anchor.offset, anchor.type)
  selection.focus.set(focus.key, focus.offset, focus.type)
  $setSelection(selection)
  return true
}

const offsetBefore = (node: LexicalNode): number => {
  const path: LexicalNode[] = []
  let current = node
  while (current.getParent() !== null) {
    path.push(current)
    current = current.getParentOrThrow()
  }
  return path.reverse().reduce((offset, child) => {
    const parent = child.getParent()
    if (!$isElementNode(parent)) return offset
    return (
      offset +
      parent
        .getChildren()
        .slice(0, child.getIndexWithinParent())
        .reduce((length, sibling) => length + sibling.getTextContent().length, 0)
    )
  }, 0)
}

const pointOffset = (point: RangeSelection['anchor']): number => {
  const node = $getNodeByKey(point.key)
  if (node === null) return 0
  if (point.type === 'text' && node instanceof TextNode) {
    return offsetBefore(node) + ($isImageReferenceTextNode(node) ? (point.offset === 0 ? 0 : node.getTextContent().length) : point.offset)
  }
  if ($isElementNode(node)) {
    return (
      offsetBefore(node) +
      node
        .getChildren()
        .slice(0, point.offset)
        .reduce((offset, child) => offset + child.getTextContent().length, 0)
    )
  }
  return offsetBefore(node)
}

const caretOffset = (): number => {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return 0
  return pointOffset(selection.anchor)
}

const textContent = (editor: LexicalEditor): string => editor.getEditorState().read(() => $getRoot().getTextContent())

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

const markdownText = (editor: LexicalEditor, files: readonly ComposerFile[]): string =>
  editor.getEditorState().read(() => {
    const projection = projectNodes($getRoot().getChildren(), '\n')
    return ImageAttachmentReferenceModel.markdownImageReferencesFromEditor(projection.text, projection.references, files)
  })

export const replaceEditorContents = (editor: LexicalEditor, text: string, files: readonly ComposerFile[]): void => {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)
      const segments = text.split('\n')
      segments.forEach((segment, lineIndex) => {
        if (lineIndex > 0) paragraph.append($createLineBreakNode())
        for (const node of buildInlineNodes(segment, files)) paragraph.append(node)
      })
      if (text === '') paragraph.append($createTextNode(''))
    },
    { discrete: true },
  )
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

export const BacklogImageEditor = forwardRef<BacklogImageEditorHandle, BacklogImageEditorProps>((props, forwardedRef) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const editor = useMemo(
    () =>
      createEditor({
        namespace: 'dshfiles-backlog-image-editor',
        nodes: [ImageReferenceTextNode],
        onError: error => {
          throw error
        },
      }),
    [],
  )
  const lastText = useRef<string | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    editor.setRootElement(root)
    if (propsRef.current.autoFocus === true) editor.focus()
    const unregister = mergeRegister(
      registerPlainText(editor),
      registerHistory(editor, createEmptyHistoryState(), 1000),
      editor.registerCommand(
        PASTE_COMMAND,
        event => {
          const clipboardData = 'clipboardData' in event ? event.clipboardData : null
          const files = [...(clipboardData?.files ?? [])]
          if (files.length === 0) return false
          event.preventDefault()
          propsRef.current.onPasteFiles(files)
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      registerImageReferenceTextEntity(editor, () => propsRef.current.files),
      editor.registerUpdateListener(({ editorState }) => {
        const snapshot = editorState.read(() => ({ text: $getRoot().getTextContent(), caret: caretOffset() }))
        if (snapshot.text !== lastText.current) {
          lastText.current = snapshot.text
          propsRef.current.onChange(snapshot.text)
        }
        propsRef.current.onCaretChange(snapshot.caret)
      }),
    )
    return () => {
      unregister()
      editor.setRootElement(null)
    }
  }, [editor])

  useLayoutEffect(() => {
    if (lastText.current === null || props.value !== lastText.current) {
      replaceEditorContents(editor, props.value, props.files)
      lastText.current = props.value
    }
    editor.update(
      () => {
        for (const node of $getRoot().getAllTextNodes()) {
          if ($isImageReferenceTextNode(node)) {
            const attachmentId = node.getAttachmentId()
            if (attachmentId === '') {
              const match = imageReferencePattern.exec(node.getTextContent())
              const image = match === null ? undefined : imageFiles(props.files)[Number(match[1]) - 1]
              if (image !== undefined) node.setAttachmentId(image.id)
            }
            node.setValid(node.getAttachmentId() !== '' && props.files.some(file => file.kind === 'image' && file.id === node.getAttachmentId()))
          }
        }
      },
      { discrete: true },
    )
  }, [editor, props.files, props.value])

  useImperativeHandle(
    forwardedRef,
    (): BacklogImageEditorHandle => ({
      element: () => rootRef.current,
      focus: () => editor.focus(),
      getCaret: () => editor.getEditorState().read(caretOffset),
      getSelectionRange: () =>
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          return $isRangeSelection(selection) ? { start: pointOffset(selection.anchor), end: pointOffset(selection.focus) } : { start: 0, end: 0 }
        }),
      getText: () => textContent(editor),
      getMarkdownText: () => markdownText(editor, propsRef.current.files),
      setCaret: offset => {
        editor.update(
          () => {
            setRange(offset, offset)
          },
          { discrete: true },
        )
        editor.focus()
      },
      replaceRange: (start, end, text) => {
        editor.update(
          () => {
            if (!setRange(start, end)) return
            if (text.includes('\n')) $getSelection()?.insertNodes(buildRichTextNodes(text, propsRef.current.files))
            else $getSelection()?.insertText(text)
          },
          { discrete: true },
        )
        editor.focus()
      },
      replaceText: next => {
        const current = textContent(editor)
        let start = 0
        while (start < current.length && start < next.length && current[start] === next[start]) start += 1
        let currentEnd = current.length
        let nextEnd = next.length
        while (currentEnd > start && nextEnd > start && current[currentEnd - 1] === next[nextEnd - 1]) {
          currentEnd -= 1
          nextEnd -= 1
        }
        if (start === currentEnd && start === nextEnd) return
        editor.update(
          () => {
            if (!setRange(start, currentEnd)) return
            const replacement = next.slice(start, nextEnd)
            if (replacement.includes('\n')) $getSelection()?.insertNodes(buildRichTextNodes(replacement, propsRef.current.files))
            else $getSelection()?.insertText(replacement)
          },
          { discrete: true },
        )
        editor.focus()
      },
      insertImageReferences: (files, firstImageNumber) => {
        const images = imageFiles(files)
        if (images.length === 0) return
        editor.update(
          () => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            const text = $getRoot().getTextContent()
            const start = pointOffset(selection.anchor)
            const end = pointOffset(selection.focus)
            const before = text.slice(0, Math.min(start, end))
            const after = text.slice(Math.max(start, end))
            const prefix = before !== '' && !/\s$/u.test(before) ? ' ' : ''
            const suffix = after !== '' && !/^\s/u.test(after) ? ' ' : ''
            const nodes: LexicalNode[] = []
            if (prefix !== '') nodes.push($createTextNode(prefix))
            images.forEach((file, index) => {
              nodes.push($createImageReferenceTextNode(`@Image ${firstImageNumber + index + 1}`, file.id))
              if (index < images.length - 1) nodes.push($createTextNode(' '))
            })
            if (suffix !== '') nodes.push($createTextNode(suffix))
            selection.insertNodes(nodes)
            const referencesLength = images.reduce((length, _, index) => length + `@Image ${firstImageNumber + index + 1}`.length, 0) + images.length - 1
            setRange(Math.min(start, end) + prefix.length + referencesLength, Math.min(start, end) + prefix.length + referencesLength)
          },
          { discrete: true },
        )
        editor.focus()
      },
    }),
    [editor],
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
      <div
        ref={rootRef}
        aria-label={props.ariaLabel}
        aria-multiline="true"
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onKeyDownCapture={props.onKeyDown}
        onFocus={() => props.onFocus?.()}
        className={props.className}
        data-backlog-image-editor
      />
    </div>
  )
})

BacklogImageEditor.displayName = 'BacklogImageEditor'
