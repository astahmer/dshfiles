import { Effect, Option } from 'effect'
import type { AnnotationDraft, AnnotationTarget, SourceMatch } from './schema.js'
import { classCandidates, SourceResolver } from './source.js'

const withSource = (target: AnnotationTarget, hit: SourceMatch): AnnotationTarget => ({
  ...target,
  source: { file: hit.file, line: hit.line, column: hit.column, confidence: hit.confidence },
})

/** The source file behind one target: a CSS-module class first, then its visible text; unchanged when nothing matches. */
const sourceFor = Effect.fn('annotations find target source')(function* (target: AnnotationTarget) {
  if (target.source !== undefined) return target
  const resolver = yield* SourceResolver
  const names = classCandidates(target.selector)
  const byClass = names.length === 0 ? Option.none<SourceMatch>() : Option.fromUndefinedOr((yield* resolver.resolve(names))[0])
  if (Option.isSome(byClass)) return withSource(target, byClass.value)
  const text = target.text
  if (text === undefined || text.length < 3) return target
  const byText = Option.fromUndefinedOr((yield* resolver.resolveText([text]))[0])
  return Option.match(byText, { onNone: () => target, onSome: hit => withSource(target, hit) })
})

/** Drafts with the source file of their element filled in where the built bundles can name it. */
export const enrichDrafts = Effect.fn('annotations enrich drafts')(function* (drafts: readonly AnnotationDraft[]) {
  return yield* Effect.forEach(drafts, draft => Effect.map(sourceFor(draft.target), target => ({ ...draft, target })))
})
