/**
 * `exactOptionalPropertyTypes` forbids assigning an explicit `undefined` to an optional property, while boundary
 * decoders (zod objects over SQLite rows and log lines) legitimately produce that shape. One narrow helper keeps the
 * optional-field spread out of every decoder.
 */

type DefinedShape<Shape> = {
  [Key in keyof Shape as Shape[Key] extends undefined ? never : Key]: Exclude<Shape[Key], undefined>
}

export const withoutUndefined = <const Shape extends object>(value: Shape): DefinedShape<Shape> => {
  // SAFETY: the filter drops exactly the keys whose value is undefined, which is what the mapped type removes.
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as DefinedShape<Shape>
}
