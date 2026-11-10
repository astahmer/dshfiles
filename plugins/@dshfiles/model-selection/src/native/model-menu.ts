/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
export type ModelMenuPane = 'root' | 'model' | 'effort'

/** Where focus should land after the render that changed the pane; null once applied. */
export type ModelMenuFocusIntent = 'drill' | 'model' | 'effort'

export interface ModelMenuState {
  readonly open: boolean
  readonly pane: ModelMenuPane
  readonly query: string
  readonly highlightedIndex: number | null
  readonly selectionFocus: boolean
  /** Whether the model list renders its search field; owned here so the search reset is one transition. */
  readonly search: boolean
  readonly focusIntent: ModelMenuFocusIntent | null
}

export type ModelMenuEvent =
  | { readonly type: 'show'; readonly hasCurrent: boolean }
  | { readonly type: 'close' }
  | { readonly type: 'drill'; readonly pane: Exclude<ModelMenuPane, 'root'> }
  | { readonly type: 'back'; readonly from: Exclude<ModelMenuPane, 'root'> }
  | { readonly type: 'query'; readonly value: string }
  | { readonly type: 'highlight'; readonly index: number | null }
  | { readonly type: 'selection-focus'; readonly value: boolean }
  | { readonly type: 'search-mode'; readonly show: boolean }
  | { readonly type: 'focus-applied' }

export const MODEL_MENU_INITIAL: ModelMenuState = {
  open: false,
  pane: 'root',
  query: '',
  highlightedIndex: null,
  selectionFocus: false,
  search: false,
  focusIntent: null,
}

const withPane = (state: ModelMenuState, pane: ModelMenuPane, intent: ModelMenuFocusIntent | null): ModelMenuState => ({
  ...state,
  pane,
  query: '',
  highlightedIndex: null,
  focusIntent: intent,
})

export const modelMenuReduce = (state: ModelMenuState, event: ModelMenuEvent): ModelMenuState => {
  switch (event.type) {
    case 'show':
      return {
        ...state,
        open: true,
        // A catalog with a current model opens on the root rows; one without
        // opens on the model list so the gesture still reaches a choice.
        pane: event.hasCurrent ? 'root' : 'model',
        query: '',
        highlightedIndex: null,
        selectionFocus: false,
        focusIntent: event.hasCurrent ? null : 'drill',
      }
    case 'close':
      return {
        ...state,
        open: false,
        pane: 'root',
        query: '',
        highlightedIndex: null,
        focusIntent: null,
      }
    case 'drill':
      return withPane(state, event.pane, 'drill')
    case 'back':
      return withPane(state, 'root', event.from)
    case 'query':
      return { ...state, query: event.value, highlightedIndex: 0 }
    case 'highlight':
      return state.highlightedIndex === event.index ? state : { ...state, highlightedIndex: event.index }
    case 'selection-focus':
      return state.selectionFocus === event.value ? state : { ...state, selectionFocus: event.value }
    case 'search-mode': {
      if (state.search === event.show) return state
      const focusedPane = event.show && state.pane === 'model' ? { focusIntent: 'drill' as const } : {}
      if (event.show) return { ...state, search: true, ...focusedPane }
      return { ...state, search: false, query: '', highlightedIndex: null }
    }
    case 'focus-applied':
      return state.focusIntent === null ? state : { ...state, focusIntent: null }
  }
}
