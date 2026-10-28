// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { afterEach, describe, expect, it } from 'vitest'
import { ComposerContentEditable } from './native/input/editor/ComposerContentEditable.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted = new Set<Root>()
afterEach(() => {
  for (const root of mounted) act(() => root.unmount())
  mounted.clear()
  document.body.replaceChildren()
})

describe('shell editor root ownership', () => {
  it.each([true, false])('restores canonical editability=%s together with its root after a differently locked duplicate retires', canonicalEditable => {
    const editor = createEditor({
      namespace: 'canonical-editability',
      onError: error => {
        throw error
      },
    })
    const mount = (editable: boolean) => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      mounted.add(root)
      act(() => root.render(<ComposerContentEditable editor={editor} editable={editable} />))
      return { root, element: container.querySelector('[data-composer-input]') }
    }
    const canonical = mount(canonicalEditable)
    const legacy = mount(!canonicalEditable)
    expect(editor.isEditable()).toBe(!canonicalEditable)
    act(() => legacy.root.unmount())
    mounted.delete(legacy.root)
    expect(editor.getRootElement()).toBe(canonical.element)
    expect(editor.isEditable()).toBe(canonicalEditable)
    expect(canonical.element?.getAttribute('contenteditable')).toBe(String(canonicalEditable))
  })

  it('returns the same live editor and draft to the canonical view when its newer legacy duplicate retires', () => {
    const editor = createEditor({
      namespace: 'canonical-draft',
      onError: error => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('canonical draft')))
      },
      { discrete: true },
    )
    const mount = (label: string) => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      mounted.add(root)
      act(() => root.render(<ComposerContentEditable editor={editor} editable aria-label={label} />))
      return { root, element: container.querySelector('[data-composer-input]') }
    }
    const canonical = mount('Canonical conversation')
    const legacy = mount('Legacy current conversation')
    expect(editor.getRootElement()).toBe(legacy.element)
    act(() => legacy.root.unmount())
    mounted.delete(legacy.root)
    expect(editor.getRootElement()).toBe(canonical.element)
    expect(canonical.element?.textContent).toBe('canonical draft')
    editor.update(
      () => {
        $getRoot().selectEnd().insertText(' continues')
      },
      { discrete: true },
    )
    expect(canonical.element?.textContent).toBe('canonical draft continues')
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('canonical draft continues')
    act(() => canonical.root.unmount())
    mounted.delete(canonical.root)
    expect(editor.getRootElement()).toBeNull()
  })

  it('a retired view cannot detach a newer view of the same live editor or erase its rendered draft', () => {
    const editor = createEditor({
      namespace: 'retained-draft',
      onError: error => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('preserved draft A')))
      },
      { discrete: true },
    )
    const mount = () => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      mounted.add(root)
      act(() => root.render(<ComposerContentEditable editor={editor} editable />))
      return { root, element: container.querySelector('[data-composer-input]') }
    }
    const retired = mount()
    const current = mount()
    expect(editor.getRootElement()).toBe(current.element)
    expect(current.element?.textContent).toBe('preserved draft A')
    act(() => retired.root.unmount())
    mounted.delete(retired.root)
    expect(editor.getRootElement()).toBe(current.element)
    expect(current.element?.textContent).toBe('preserved draft A')
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('preserved draft A')
    act(() => current.root.unmount())
    mounted.delete(current.root)
    expect(editor.getRootElement()).toBeNull()
  })
})
