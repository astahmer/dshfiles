import { ImageLightbox, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { CodeFences } from '@dshfiles/chat/code-fences'
import { defineClient } from '@dshfiles/dshx/client'
import type { ReactNode } from 'react'
import { createMermaidFence } from './mermaid-fence.tsx'
import { createRendererLoader } from './renderer-loader.js'
import { createDiagramSanitizers } from './sanitize.js'
import './client.css'

const LIGHTBOX_LABELS = { dialog: 'Mermaid diagram', close: 'Close' }

const Lightbox = (props: { readonly src: string; readonly alt: string; readonly onClose: () => void }): ReactNode => (
  <ImageLightbox src={props.src} alt={props.alt} labels={LIGHTBOX_LABELS} onClose={props.onClose} />
)

export default defineClient({
  name: '@dshfiles/mermaid-diagrams',
  setup(_ctx, _decorate, metadata) {
    // The page's one renderer loader and sanitizers: created here, at the Client's composition boundary.
    const MermaidFence = createMermaidFence({
      loader: createRendererLoader(window.location.origin, document),
      sanitizers: createDiagramSanitizers(window),
      writeClipboard,
      Lightbox,
    })
    metadata?.plugin?.add(CodeFences, { id: 'mermaid-diagrams', languages: ['mermaid'], Component: MermaidFence })
  },
})
