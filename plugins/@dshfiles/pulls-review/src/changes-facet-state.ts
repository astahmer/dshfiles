import type { PatchLineSelection } from '@dshfiles/plugin-ui/diff'
import type { ChangesScope } from './changes-scope.js'

/** What the Changes facet remembers about the thread it shows; another thread starts from scratch. */
export interface FacetSessionState {
  readonly sessionId: string | undefined
  readonly scope: ChangesScope | undefined
  readonly seq: number | undefined
  readonly focusPath: string | null
  readonly selection: PatchLineSelection | null
  readonly comment: string
  readonly commentNotice: string | null
}

export type FacetSessionPatch = Partial<Omit<FacetSessionState, 'sessionId'>>

const initial = (sessionId: string | undefined): FacetSessionState => ({
  sessionId,
  scope: undefined,
  seq: undefined,
  focusPath: null,
  selection: null,
  comment: '',
  commentNotice: null,
})

const forSession = (state: FacetSessionState, sessionId: string | undefined): FacetSessionState => (state.sessionId === sessionId ? state : initial(sessionId))

const update = (state: FacetSessionState, input: { readonly sessionId: string | undefined; readonly patch: FacetSessionPatch }): FacetSessionState => ({
  ...forSession(state, input.sessionId),
  ...input.patch,
})

export const FacetSessionStateModel = { initial, forSession, update }
