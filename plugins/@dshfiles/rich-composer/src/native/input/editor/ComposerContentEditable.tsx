/**
 * The composer's contenteditable host: binds one shell-owned Lexical editor
 * to a resident div. Session-maybe by design — a null editor renders the
 * same DOM inert (the no-session Workspace-trigger state), so switching
 * between the two never swaps the element tree. Editability has ONE writer:
 * this component reflects the `editable` prop onto the editor; nothing else
 * calls setEditable.
 */
import { useLayoutEffect, useRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import type { LexicalEditor } from 'lexical'

// One shell editor has one physical root. During legacy-view retirement, return
// that root to its previous mounted host instead of leaving the canonical view
// detached. Leases own DOM attachment only; the editor and draft stay shell-owned.
const rootLeases = new WeakMap<LexicalEditor, Array<{ readonly element: HTMLDivElement }>>()
const leaseRoot = (editor: LexicalEditor, element: HTMLDivElement): (() => void) => {
  const leases = rootLeases.get(editor) ?? []
  const lease = { element }
  leases.push(lease)
  rootLeases.set(editor, leases)
  editor.setRootElement(element)
  return () => {
    const index = leases.indexOf(lease)
    if (index < 0) return
    leases.splice(index, 1)
    // Disposing an older occurrence must not detach a newer live root.
    if (editor.getRootElement() === element) {
      const previous = leases.findLast(candidate => candidate.element.isConnected)
      editor.setRootElement(previous?.element ?? null)
      if (previous !== undefined) editor.setEditable(previous.element.getAttribute('contenteditable') === 'true')
    }
    if (leases.length === 0) rootLeases.delete(editor)
  }
}

/** Host props: the editor binding plus the div passthroughs the bar owns. */
export interface ComposerContentEditableProps extends HTMLAttributes<HTMLDivElement> {
  /** The shell-owned editor; null renders the same div unbound and inert. */
  readonly editor: LexicalEditor | null
  /** Whether the user may edit (readOnly/disabled states fold in here). */
  readonly editable: boolean
}

/**
 * Render the composer's editable surface.
 * @param props - editor binding, editability, and div passthroughs.
 * @returns the resident contenteditable div.
 */
export function ComposerContentEditable({ editor, editable, ...rest }: ComposerContentEditableProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (editor === null || el === null) return
    return leaseRoot(editor, el)
  }, [editor])
  useLayoutEffect(() => {
    if (editor !== null) editor.setEditable(editable)
  }, [editor, editable])
  return (
    <div
      ref={ref}
      // Lexical's setRootElement never touches contenteditable; the binding
      // renders it, and setEditable above keeps the editor's own gate in step.
      contentEditable={editor !== null && editable}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-composer-input
      {...rest}
    />
  )
}
