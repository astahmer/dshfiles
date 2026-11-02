import { tmpdir } from 'node:os'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { AttachmentExportFailed } from './errors.js'

const DATA_URL = /^data:([^;,]+);base64,([\s\S]+)$/

const extensionOf = (mediaType: string): string => {
  const subtype = mediaType.split('/')[1] ?? 'bin'
  const known = new Map([
    ['plain', 'txt'],
    ['svg+xml', 'svg'],
    ['octet-stream', 'bin'],
  ])
  return known.get(subtype) ?? (subtype.replace(/[^a-z0-9]/gi, '') || 'bin')
}

const make = (root: string | undefined) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = root ?? path.join(tmpdir(), 'dsh-backlog-attachments')
    const write = Effect.fn('backlog attachment export')(function* (input: { readonly id: number; readonly attachmentId: string; readonly dataUrl: string }) {
      const failed = (cause?: unknown) => new AttachmentExportFailed({ itemId: input.id, attachmentId: input.attachmentId, cause })
      const match = DATA_URL.exec(input.dataUrl)
      if (match === null || match[1] === undefined || match[2] === undefined) return yield* failed()
      const target = path.join(directory, `${String(input.id)}-${input.attachmentId}.${extensionOf(match[1])}`)
      yield* fileSystem.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(failed))
      yield* fileSystem.writeFile(target, Buffer.from(match[2], 'base64')).pipe(Effect.mapError(failed))
      return target
    })
    return AttachmentExport.of({ write })
  })

/**
 * Writes one attachment to a temporary file next to every other export, so an agent can hand the path to an image or
 * file reader instead of a data URL it cannot open. The name is derived from the two ids, never from the user's file
 * name, and a later export of the same attachment replaces the previous copy.
 */
export class AttachmentExport extends Context.Service<
  AttachmentExport,
  {
    readonly write: (input: { readonly id: number; readonly attachmentId: string; readonly dataUrl: string }) => Effect.Effect<string, AttachmentExportFailed>
  }
>()('@dshfiles/backlog/AttachmentExport') {
  static readonly layer = Layer.effect(AttachmentExport, make(undefined))
  static readonly layerAt = (root: string) => Layer.effect(AttachmentExport, make(root))
}
