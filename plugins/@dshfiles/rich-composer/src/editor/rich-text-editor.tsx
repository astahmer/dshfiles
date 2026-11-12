import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  LineBreakNode,
  mergeRegister,
  PASTE_COMMAND,
  TextNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from 'lexical'
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, type KeyboardEventHandler } from 'react'
import { ComposerContentEditable } from '../native/input/editor/ComposerContentEditable.js'
import { DecoratorPortals } from '../native/input/editor/DecoratorPortals.js'
import { DraftEditorRuntime } from '../native/input/editor/runtime.js'

/** One occurrence of the embeddable editor, driven by its owner rather than by a conversation. */
export interface RichTextEditorHandle {
  readonly element: () => HTMLDivElement | null
  readonly focus: () => void
  readonly getCaret: () => number
  readonly getSelectionRange: () => { readonly start: number; readonly end: number }
  readonly getText: () => string
  /** What the owner's `project` returns, evaluated against the current contents. */
  readonly getProjectedText: () => string
  readonly setCaret: (offset: number) => void
  readonly replaceRange: (start: number, end: number, text: string) => void
  readonly replaceText: (text: string) => void
  /** Run a `$`-function in one discrete update, for owner-specific nodes the editor never learns about. */
  readonly update: (edit: () => void) => void
}

export interface RichTextEditorProps {
  readonly value: string
  readonly ariaLabel: string
  readonly className?: string | undefined
  readonly autoFocus?: boolean | undefined
  /** Extra Lexical node types the owner parses into its value. */
  readonly nodes?: readonly Klass<LexicalNode>[] | undefined
  /** Inline nodes for one line of `value`; runs inside a Lexical update. Defaults to one text node. */
  readonly parseLine?: ((line: string) => readonly LexicalNode[]) | undefined
  /** The owner's text projection; runs inside an editor read. Defaults to the document's text. */
  readonly project?: (() => string) | undefined
  /** Owner registrations on the editor, cleaned up on unmount. */
  readonly register?: ((editor: LexicalEditor) => () => void) | undefined
  /** Owner nodes kept whole by caret placement and range replacement. */
  readonly isAtomicNode?: ((node: LexicalNode) => boolean) | undefined
  readonly onChange?: ((value: string) => void) | undefined
  readonly onCaretChange?: ((offset: number) => void) | undefined
  readonly onPasteFiles?: ((files: readonly File[]) => void) | undefined
  readonly onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement> | undefined
  readonly onFocus?: (() => void) | undefined
  readonly spellCheck?: boolean | undefined
}

type Point = { readonly key: string; readonly offset: number; readonly type: 'text' | 'element' }

/** One paragraph with line breaks, so the document's text keeps the owner's newlines. */
const seedContents = (editor: LexicalEditor, text: string, parseLine: (line: string) => readonly LexicalNode[]): void => {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)
      text.split('\n').forEach((line, index) => {
        if (index > 0) paragraph.append($createLineBreakNode())
        paragraph.append(...parseLine(line))
      })
      if (text === '') paragraph.append($createTextNode(''))
    },
    { discrete: true },
  )
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

const pointOffset = (point: RangeSelection['anchor'], isAtomicNode: (node: LexicalNode) => boolean): number => {
  const node = $getNodeByKey(point.key)
  if (node === null) return 0
  if (point.type === 'text' && node instanceof TextNode)
    return offsetBefore(node) + (isAtomicNode(node) && point.offset > 0 ? node.getTextContent().length : point.offset)
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

const parentPoint = (node: LexicalNode, offset: number): Point => {
  const parent = node.getParentOrThrow()
  return { key: parent.getKey(), offset, type: 'element' }
}

const resolvePoint = (offset: number, isAtomicNode: (node: LexicalNode) => boolean): Point | null => {
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
      if (isAtomicNode(child)) return parentPoint(child, offset <= cursor ? index : index + 1)
      if (child instanceof LineBreakNode) return parentPoint(child, offset <= cursor ? index : index + 1)
      if (child instanceof TextNode) return { key: child.getKey(), offset: Math.max(0, Math.min(length, offset - cursor)), type: 'text' }
    }
    cursor = end
  }

  return { key: paragraph.getKey(), offset: children.length, type: 'element' }
}

const setRange = (start: number, end: number, isAtomicNode: (node: LexicalNode) => boolean): boolean => {
  const anchor = resolvePoint(start, isAtomicNode)
  const focus = resolvePoint(end, isAtomicNode)
  if (anchor === null || focus === null) return false
  const selection = $createRangeSelection()
  selection.anchor.set(anchor.key, anchor.offset, anchor.type)
  selection.focus.set(focus.key, focus.offset, focus.type)
  $setSelection(selection)
  return true
}

const caretOffset = (isAtomicNode: (node: LexicalNode) => boolean): number => {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return 0
  return pointOffset(selection.anchor, isAtomicNode)
}

/** Replace one range with text (or owner nodes when it spans lines), keeping the caret after it. */
const applyRange = (
  editor: LexicalEditor,
  input: {
    readonly start: number
    readonly end: number
    readonly text: string
    readonly isAtomicNode: (node: LexicalNode) => boolean
    readonly parseLine: (line: string) => readonly LexicalNode[]
  },
): void => {
  editor.update(
    () => {
      if (!setRange(input.start, input.end, input.isAtomicNode)) return
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      if (input.text.includes('\n'))
        selection.insertNodes(
          input.text.split('\n').flatMap((line, index) => (index === 0 ? input.parseLine(line) : [$createLineBreakNode(), ...input.parseLine(line)])),
        )
      else if (input.text === '' && !selection.isCollapsed()) selection.removeText()
      else selection.insertText(input.text)
    },
    { discrete: true },
  )
  editor.focus()
}

/**
 * One embeddable rich-text editor: plain text with line breaks, undo history, file paste and owner-provided inline
 * nodes and projection. It owns its Lexical editor, its DOM root and its selection handling; the owner keeps the value,
 * the submit path and every domain behavior. Mount one instance per occurrence.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>((props, forwardedRef) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const parseLine = (line: string): readonly LexicalNode[] => propsRef.current.parseLine?.(line) ?? [$createTextNode(line)]
  const isAtomicNode = (node: LexicalNode): boolean => propsRef.current.isAtomicNode?.(node) ?? false
  const project = (editor: LexicalEditor): string =>
    editor.getEditorState().read(() => (propsRef.current.project === undefined ? $getRoot().getTextContent() : propsRef.current.project()))
  // Node types define one occurrence's document format; changing them remounts the owner's editor instead.
  const nodeTypes = useRef<readonly Klass<LexicalNode>[]>(props.nodes ?? [])
  const runtime = useMemo(
    () =>
      new DraftEditorRuntime({
        additionalNodes: nodeTypes.current,
        onUpdate: () => {},
        openReference: () => false,
        quoteLabels: () => ({ remove: '' }),
        lexicon: () => new Map(),
        resolveLexicon: () => undefined,
      }),
    [],
  )
  const editor = runtime.editor
  const lastText = useRef<string | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    if (propsRef.current.autoFocus === true) editor.focus()
    const unregister = mergeRegister(
      runtime.register(),
      editor.registerCommand(
        PASTE_COMMAND,
        event => {
          const clipboardData = 'clipboardData' in event ? event.clipboardData : null
          const files = [...(clipboardData?.files ?? [])]
          if (files.length === 0) return false
          event.preventDefault()
          propsRef.current.onPasteFiles?.(files)
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      ...(propsRef.current.register === undefined ? [] : [propsRef.current.register(editor)]),
      editor.registerUpdateListener(({ editorState }) => {
        const snapshot = editorState.read(() => ({ text: $getRoot().getTextContent(), caret: caretOffset(isAtomicNode) }))
        if (snapshot.text !== lastText.current) {
          lastText.current = snapshot.text
          propsRef.current.onChange?.(snapshot.text)
        }
        propsRef.current.onCaretChange?.(snapshot.caret)
      }),
    )
    return () => {
      unregister()
    }
  }, [editor, runtime])

  useLayoutEffect(() => {
    if (lastText.current === null || props.value !== lastText.current) {
      seedContents(editor, props.value, parseLine)
      lastText.current = props.value
    }
  }, [editor, props.value])

  useImperativeHandle(
    forwardedRef,
    (): RichTextEditorHandle => ({
      element: () => rootRef.current,
      focus: () => editor.focus(),
      getCaret: () => editor.getEditorState().read(() => caretOffset(isAtomicNode)),
      getSelectionRange: () =>
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          return $isRangeSelection(selection)
            ? { start: pointOffset(selection.anchor, isAtomicNode), end: pointOffset(selection.focus, isAtomicNode) }
            : { start: 0, end: 0 }
        }),
      getText: () => editor.getEditorState().read(() => $getRoot().getTextContent()),
      getProjectedText: () => project(editor),
      setCaret: offset => {
        editor.update(
          () => {
            setRange(offset, offset, isAtomicNode)
          },
          { discrete: true },
        )
        editor.focus()
      },
      replaceRange: (start, end, text) => applyRange(editor, { start, end, text, isAtomicNode, parseLine }),
      replaceText: next => {
        const current = editor.getEditorState().read(() => $getRoot().getTextContent())
        let start = 0
        while (start < current.length && start < next.length && current[start] === next[start]) start += 1
        let currentEnd = current.length
        let nextEnd = next.length
        while (currentEnd > start && nextEnd > start && current[currentEnd - 1] === next[nextEnd - 1]) {
          currentEnd -= 1
          nextEnd -= 1
        }
        if (start === currentEnd && start === nextEnd) return
        applyRange(editor, { start, end: currentEnd, text: next.slice(start, nextEnd), isAtomicNode, parseLine })
      },
      update: edit => {
        editor.update(edit, { discrete: true })
      },
    }),
    [editor],
  )

  return (
    <>
      <ComposerContentEditable
        editor={editor}
        editable
        elementRef={rootRef}
        aria-label={props.ariaLabel}
        spellCheck={props.spellCheck ?? true}
        onKeyDownCapture={props.onKeyDownCapture}
        onFocus={() => props.onFocus?.()}
        className={props.className}
        data-rich-text-editor
      />
      <DecoratorPortals editor={editor} />
    </>
  )
})

RichTextEditor.displayName = 'RichTextEditor'
