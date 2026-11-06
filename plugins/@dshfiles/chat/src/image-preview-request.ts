/** What the Chat image viewer shows: closed, waiting for the gallery, or the gallery itself. */
export type ImagePreview<Image> =
  | { readonly status: 'closed' }
  | { readonly status: 'opening'; readonly request: number }
  | {
      readonly status: 'open'
      readonly request: number
      readonly images: readonly Image[]
      readonly initialIndex: number
    }

let lastRequest = 0

/** Start one preview read; its id is what a settlement is matched against. */
export const beginImagePreview = (): number => ++lastRequest

/** The preview the gallery read is filling, before its images are known. */
export const imagePreviewOpening = <Image>(request: number): ImagePreview<Image> => ({ status: 'opening', request })

/** Open the viewer for one gallery read, unless another gesture replaced it. */
export const imagePreviewOpened = <Image>(
  state: ImagePreview<Image>,
  input: { readonly request: number; readonly images: readonly Image[]; readonly initialIndex: number },
): ImagePreview<Image> =>
  state.status === 'opening' && state.request === input.request
    ? { status: 'open', request: input.request, images: input.images, initialIndex: input.initialIndex }
    : state

/** Fill in the sources a later read loaded, as long as the same preview is still open. */
export const imagePreviewLoaded = <Image>(
  state: ImagePreview<Image>,
  input: { readonly request: number; readonly images: readonly Image[] },
): ImagePreview<Image> => (state.status === 'open' && state.request === input.request ? { ...state, images: input.images } : state)

/** Close the viewer; a read still in flight will not reopen it. */
export const imagePreviewClosed = <Image>(): ImagePreview<Image> => ({ status: 'closed' })

/** Whether a gallery read is still the newest one; a superseded read stops before it builds the viewer. */
export const imagePreviewRequestIsCurrent = (request: number): boolean => request === lastRequest
