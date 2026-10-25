import { annotationTargetSchema, type AnnotationSurface, type AnnotationTarget } from './schema.js'
import { Redact } from './redact.js'
import { Descriptor } from './descriptor.js'

export interface DragRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const normalize = (rect: DragRect): DragRect => ({
  x: Math.round(Math.min(rect.x, rect.x + rect.width)),
  y: Math.round(Math.min(rect.y, rect.y + rect.height)),
  width: Math.round(Math.abs(rect.width)),
  height: Math.round(Math.abs(rect.height)),
})

export const describeRegion = ({
  element,
  surface,
  url,
  rect,
}: {
  readonly element: Element
  readonly surface: AnnotationSurface
  readonly url: string
  readonly rect: DragRect
}): AnnotationTarget | null => {
  if (Redact.privateAncestor(element) !== undefined) return null
  if (Redact.sensitiveField(element)) return null
  const attributes = Redact.safeAttributes(element)
  const styles = Redact.safeStyles(element)
  const text = Redact.elementText(element)
  const parsed = annotationTargetSchema.safeParse({
    surface,
    url: Redact.redactUrl(url),
    selector: Descriptor.elementSelector(element),
    tag: element.tagName.toLowerCase(),
    rect: normalize(rect),
    ...(text !== undefined && { text }),
    ...(attributes !== undefined && { attributes }),
    ...(styles !== undefined && { styles }),
  })
  return parsed.success ? parsed.data : null
}
