import { Descriptor } from './descriptor.js'
import type { Annotation, AnnotationStaleReason } from './schema.js'

export interface StaleCheck {
  readonly id: string
  readonly revision: number
  readonly reason: AnnotationStaleReason
}

const OPEN_STATUSES = new Set(['pending', 'acknowledged'])

/**
 * Re-checks a thread's open annotations against the live document. A target whose
 * selector no longer matches, or whose text changed, is reported stale — never
 * resolved: the user still decides what happens to it.
 */
export const staleAnnotations = ({
  annotations,
  scope,
  url,
}: {
  readonly annotations: readonly Annotation[]
  readonly scope: Document
  readonly url: string
}): StaleCheck[] => {
  const route = new URL(url).pathname
  const checks: StaleCheck[] = []
  for (const annotation of annotations) {
    if (!OPEN_STATUSES.has(annotation.status)) continue
    if (annotation.target.surface !== 'dsh') continue
    if (annotation.target.url.length > 0) {
      try {
        if (new URL(annotation.target.url).pathname !== route) checks.push({ id: annotation.id, revision: annotation.revision, reason: 'route-changed' })
      } catch {
        checks.push({ id: annotation.id, revision: annotation.revision, reason: 'route-changed' })
      }
    }
    const element = scope.querySelector(annotation.target.selector)
    if (element === null) {
      checks.push({ id: annotation.id, revision: annotation.revision, reason: 'element-missing' })
      continue
    }
    if (!Descriptor.matchesTarget({ element, target: annotation.target })) {
      checks.push({ id: annotation.id, revision: annotation.revision, reason: 'text-changed' })
    }
  }
  return checks
}
