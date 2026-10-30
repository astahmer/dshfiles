import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ImageReferenceOverlay } from './image-reference-overlay.js'
import type { ComposerFile } from './composer-files.js'

const image: ComposerFile = {
  id: 'image-one',
  kind: 'image',
  name: 'one.png',
  mediaType: 'image/png',
  bytes: 1,
  dataUrl: 'data:image/png;base64,AA==',
}

describe('ImageReferenceOverlay', () => {
  it('renders attached image references in the primary color', () => {
    const overlay = renderToStaticMarkup(
      <ImageReferenceOverlay text="Compare @Image 1 and @Image 2" files={[image]} className="dshx:text-sm" overlayRef={{ current: null }} />,
    )

    expect(overlay).toContain('<span data-dshfiles-image-reference="true">@Image 1</span>')
    expect(overlay).toContain('<span> and @Image 2</span>')
  })
})
