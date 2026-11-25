/** A file reference as written: a path with an optional `:24`, `:24:3`, `#L24` or `#L24-L30` line suffix. */
const FILE_REFERENCE = /^(.*?)(?::(\d+)(?:[:-]\d+)?|#L(\d+)(?:-L?\d+)?)?$/

export interface FileReferenceParts {
  readonly path: string
  readonly line: string | undefined
}

/** dshfiles: dependency-free, so the prose chips and the file-reference links share one reading of `name.ts:24`. */
export const parseFileReference = (value: string): FileReferenceParts => {
  const match = FILE_REFERENCE.exec(value.trim())
  const path = match?.[1] ?? value
  return { path: path === '' ? value : path, line: match?.[2] ?? match?.[3] }
}
