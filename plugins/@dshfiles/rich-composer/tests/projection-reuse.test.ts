// @vitest-environment jsdom
import { $getRoot, $isElementNode } from 'lexical'
import { describe, expect, it, vi } from 'vitest'
import type { DraftEditorRuntime as Runtime } from '../src/native/input/editor/runtime.js'

// The DSH client packages are external in the real bundle and resolve from the app's module table,
// so a unit test stubs the primitives face the chip renderer reads instead of its icon set.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ ReferenceIconRegular: () => null }))

const { DraftEditorRuntime } = await import('../src/native/input/editor/runtime.js')

const runtimeFor = () => {
  const holder: { current?: Runtime } = {}
  const runtime = new DraftEditorRuntime({
    onUpdate: () => holder.current?.refreshProjection(),
    openReference: () => false,
    lexicon: () => new Map(),
    resolveLexicon: () => undefined,
  })
  holder.current = runtime
  const unregister = runtime.register()
  return { runtime, unregister }
}

const moveCaretTo = (runtime: Runtime, blockIndex: number, offset: number): void => {
  runtime.editor.update(
    () => {
      const block = $getRoot().getChildAtIndex(blockIndex)
      if ($isElementNode(block)) block.select(offset, offset)
    },
    { discrete: true },
  )
}

describe('composer projection reuse', () => {
  it('reuses the content half while only the caret moves', () => {
    const { runtime, unregister } = runtimeFor()
    runtime.setDraft(Array.from({ length: 200 }, (_unused, index) => `line ${String(index)}`).join('\n'))
    const first = runtime.projection
    expect(first.detectText.split('\n')).toHaveLength(200)

    for (let index = 0; index < 100; index += 1) moveCaretTo(runtime, index % 200, 0)
    moveCaretTo(runtime, 5, 0)

    const moved = runtime.projection
    // The same objects can only come from a reused walk: a rebuilt projection allocates new ones.
    expect(moved.detectText).toBe(first.detectText)
    expect(moved.clipboardText).toBe(first.clipboardText)
    expect(moved.occurrences).toBe(first.occurrences)
    // 'line 0' is six characters plus one newline per preceding block.
    expect(moved.caret).toBe(5 * 7)
    unregister()
  })

  it('walks again once the document text changes', () => {
    const { runtime, unregister } = runtimeFor()
    runtime.setDraft('alpha\nbeta')
    const before = runtime.projection
    moveCaretTo(runtime, 1, 0)
    expect(runtime.projection.detectText).toBe(before.detectText)

    runtime.paste('Z')

    const after = runtime.projection
    // Regression guard: a content commit must never serve the previous walk (Lexical reuses the
    // RootNode instance across such commits, so the revision counter — not node identity — keys it).
    expect(after.detectText).not.toBe(before.detectText)
    expect(after.detectText).toContain('Z')
    expect(after.detectText.length).toBeGreaterThan(before.detectText.length)
    unregister()
  })

  it('keeps repeated references as separate occurrences', () => {
    const { runtime, unregister } = runtimeFor()
    const reference = { source: 'image-attachment', ref: 'image-1', label: 'Image 1', appearance: 'file' as const, clipboardText: '[Image 1]' }
    expect(runtime.insertReference({ start: 0, end: 0 }, reference, '')).toBe(true)
    const firstLength = runtime.projection.detectText.length
    expect(runtime.insertReference({ start: firstLength, end: firstLength }, reference, '')).toBe(true)

    const occurrences = runtime.projection.occurrences
    expect(occurrences).toHaveLength(2)
    expect(occurrences.map(occurrence => [occurrence.source, occurrence.ref])).toEqual([
      ['image-attachment', 'image-1'],
      ['image-attachment', 'image-1'],
    ])
    expect(occurrences[0]?.occurrenceId).not.toBe(occurrences[1]?.occurrenceId)
    expect(occurrences[1]?.offset).toBeGreaterThan(occurrences[0]?.offset ?? -1)
    unregister()
  })

  it('keeps chip occurrences and their ids while only the caret moves', () => {
    const { runtime, unregister } = runtimeFor()
    runtime.setDraft('see ')
    const inserted = runtime.insertReference(
      { start: 4, end: 4 },
      { source: 'reference', ref: 'ref-1', label: 'One', appearance: 'session', clipboardText: '@[One](dsh-session:x)' },
      '',
    )
    expect(inserted).toBe(true)
    const first = runtime.projection
    expect(first.occurrences).toHaveLength(1)

    for (let index = 0; index < 50; index += 1) moveCaretTo(runtime, 0, index % 3)

    const moved = runtime.projection
    expect(moved.occurrences).toBe(first.occurrences)
    expect(moved.occurrences[0]?.occurrenceId).toBe(first.occurrences[0]?.occurrenceId)
    expect(moved.detectText).toBe(first.detectText)
    unregister()
  })
})
