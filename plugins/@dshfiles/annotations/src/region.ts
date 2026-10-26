import { annotationTargetSchema, type AnnotationSurface, type AnnotationTarget } from './schema.js'
import { AnnotationRedaction } from './redact.js'
import { ElementDescriptor } from './descriptor.js'

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
  if (AnnotationRedaction.privateAncestor(element) !== undefined) return null
  if (AnnotationRedaction.sensitiveField(element)) return null
  const attributes = AnnotationRedaction.safeAttributes(element)
  const styles = AnnotationRedaction.safeStyles(element)
  const text = AnnotationRedaction.elementText(element)
  const target: AnnotationTarget = {
    surface,
    url: AnnotationRedaction.redactUrl(url),
    selector: ElementDescriptor.elementSelector(element),
    tag: element.tagName.toLowerCase(),
    rect: normalize(rect),
  }
  if (text !== undefined) target.text = text
  if (attributes !== undefined) target.attributes = attributes
  if (styles !== undefined) target.styles = styles
  const parsed = annotationTargetSchema.safeParse(target)
  return parsed.success ? parsed.data : null
}
