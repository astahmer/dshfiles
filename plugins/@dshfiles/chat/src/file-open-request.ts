import type { OpenFileOptions } from './native/contract/slots.ts'

/** The in-page Host open-path gesture: idle, one path opening (possibly retried), or the refusal to show. */
export type FileOpenRequest =
  | { readonly status: 'idle' }
  | {
      readonly status: 'opening'
      readonly request: number
      readonly path: string
      readonly options: OpenFileOptions | undefined
      /** The refusal still on screen while a retry runs; absent for a fresh gesture. */
      readonly refusal: string | undefined
    }
  | { readonly status: 'refused'; readonly path: string; readonly message: string }

let lastRequest = 0

/** Start one open: its id is what a settlement is matched against, so an older path cannot close a newer one. */
export const beginFileOpen = (input: {
  readonly path: string
  readonly options: OpenFileOptions | undefined
  readonly refusal?: string | undefined
}): FileOpenRequest => ({
  status: 'opening',
  request: ++lastRequest,
  path: input.path,
  options: input.options,
  refusal: input.refusal,
})

/** Settle one open: success clears the gesture, a refusal keeps its dialog, a superseded gesture is ignored. */
export const settleFileOpen = (state: FileOpenRequest, input: { readonly request: number; readonly message: string | undefined }): FileOpenRequest => {
  if (state.status !== 'opening' || state.request !== input.request) return state
  return input.message === undefined ? { status: 'idle' } : { status: 'refused', path: state.path, message: input.message }
}

/** Close the refusal (or the busy state) without settling the request that produced it. */
export const idleFileOpen = (): FileOpenRequest => ({ status: 'idle' })
