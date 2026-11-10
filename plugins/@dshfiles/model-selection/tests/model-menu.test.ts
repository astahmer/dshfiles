import { describe, expect, it } from 'vitest'
import { MODEL_MENU_INITIAL, modelMenuReduce, type ModelMenuState } from '../src/native/model-menu.ts'

const open = (state: ModelMenuState = MODEL_MENU_INITIAL): ModelMenuState => modelMenuReduce(state, { type: 'show', hasCurrent: true })

describe('model menu state', () => {
  it('opens on the root rows when a model is in use and on the model list otherwise', () => {
    expect(open()).toMatchObject({ open: true, pane: 'root', query: '', highlightedIndex: null, selectionFocus: false, focusIntent: null })
    expect(modelMenuReduce(MODEL_MENU_INITIAL, { type: 'show', hasCurrent: false })).toMatchObject({ pane: 'model', focusIntent: 'drill' })
  })

  it('clears the query, highlight and focus intent on close', () => {
    const drilled = modelMenuReduce(modelMenuReduce(open(), { type: 'drill', pane: 'model' }), { type: 'query', value: 'gpt' })
    expect(drilled).toMatchObject({ pane: 'model', query: 'gpt', highlightedIndex: 0, focusIntent: 'drill' })
    expect(modelMenuReduce(drilled, { type: 'close' })).toMatchObject({
      open: false,
      pane: 'root',
      query: '',
      highlightedIndex: null,
      focusIntent: null,
    })
  })

  it('drills with the search reset, and returns to the root cell that drilled', () => {
    const drilled = modelMenuReduce(modelMenuReduce(open(), { type: 'query', value: 'gpt' }), { type: 'drill', pane: 'effort' })
    expect(drilled).toMatchObject({ pane: 'effort', query: '', highlightedIndex: null, focusIntent: 'drill' })
    expect(modelMenuReduce(drilled, { type: 'back', from: 'effort' })).toMatchObject({ pane: 'root', focusIntent: 'effort' })
  })

  it('resets the query when the search field goes away and asks for search focus when it appears', () => {
    const searching = modelMenuReduce(open(), { type: 'search-mode', show: true })
    expect(searching).toMatchObject({ search: true, focusIntent: null })
    const typed = modelMenuReduce(modelMenuReduce(searching, { type: 'drill', pane: 'model' }), { type: 'query', value: 'cla' })
    expect(modelMenuReduce(typed, { type: 'search-mode', show: false })).toMatchObject({ search: false, query: '', highlightedIndex: null })
    expect(modelMenuReduce(modelMenuReduce(typed, { type: 'search-mode', show: false }), { type: 'search-mode', show: true })).toMatchObject({
      search: true,
      focusIntent: 'drill',
    })
  })

  it('drops a focus intent once applied and keeps an equal highlight or flag reference', () => {
    const opened = open()
    expect(modelMenuReduce(opened, { type: 'focus-applied' })).toBe(opened)
    expect(modelMenuReduce(opened, { type: 'highlight', index: null })).toBe(opened)
    expect(modelMenuReduce(opened, { type: 'selection-focus', value: false })).toBe(opened)
    const waiting = modelMenuReduce(modelMenuReduce(opened, { type: 'show', hasCurrent: false }), { type: 'focus-applied' })
    expect(waiting.focusIntent).toBeNull()
  })
})
