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

export class ImagePreviewRequestModel {
  /** Start one preview read; its id is what a settlement is matched against. */
  static beginImagePreview = (): number => ++lastRequest

  /** The preview the gallery read is filling, before its images are known. */
  static imagePreviewOpening = <Image>(request: number): ImagePreview<Image> => ({ status: 'opening', request })

  /** Open the viewer for one gallery read, unless another gesture replaced it. */
  static imagePreviewOpened = <Image>(
    state: ImagePreview<Image>,
    input: { readonly request: number; readonly images: readonly Image[]; readonly initialIndex: number },
  ): ImagePreview<Image> =>
    state.status === 'opening' && state.request === input.request
      ? { status: 'open', request: input.request, images: input.images, initialIndex: input.initialIndex }
      : state

  /** Fill in the sources a later read loaded, as long as the same preview is still open. */
  static imagePreviewLoaded = <Image>(
    state: ImagePreview<Image>,
    input: { readonly request: number; readonly images: readonly Image[] },
  ): ImagePreview<Image> => (state.status === 'open' && state.request === input.request ? { ...state, images: input.images } : state)

  /** Close the viewer; a read still in flight will not reopen it. */
  static imagePreviewClosed = <Image>(): ImagePreview<Image> => ({ status: 'closed' })

  /** Whether a gallery read is still the newest one; a superseded read stops before it builds the viewer. */
  static imagePreviewRequestIsCurrent = (request: number): boolean => request === lastRequest
}
