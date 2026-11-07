/** Ask the shared reference card (input-trigger's entity registry) to show one Backlog item under an element. */
import { EntityPreview } from '@dshfiles/input-trigger/entity-registry'

import { BacklogReference } from './backlog-reference.js'

export const previewBacklogReference = (ref: string, element: Element): boolean =>
  BacklogReference.parse(ref) !== undefined && EntityPreview.request({ kind: BacklogReference.entityKind, id: ref }, element)
