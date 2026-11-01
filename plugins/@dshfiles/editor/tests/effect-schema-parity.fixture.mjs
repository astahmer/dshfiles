import * as EffectSchema from 'effect/Schema'
import { z } from 'zod'
import { fileLinkParamsSchema, goToLineRequestSchema, openFileRequestSchema } from '../src/open-file.ts'
import { listingSchema, searchSchema } from '../src/session-screen.ts'

const Schema = {
  ...EffectSchema,
  toJsonSchemaDocument: (schema, options) => EffectSchema.toJsonSchemaDocument(schema, { ...options, onExcessProperty: 'error' }),
}

const zodOpenFileRequest = z.object({
  path: z.string().min(1).max(4096),
  line: z.number().int().positive().optional(),
  cwd: z.string().min(1).max(4096).optional(),
})
const zodGoToLineRequest = z.object({ line: z.number().int().positive() })
const zodFileLinkParams = z.object({ line: z.number().int().positive().optional() }).optional()
const zodListing = z.object({
  ok: z.literal(true),
  value: z.object({ entries: z.array(z.object({ name: z.string(), type: z.enum(['file', 'directory', 'other']) })) }),
})
const zodSearch = z.object({ ok: z.literal(true), value: z.array(z.object({ path: z.string(), kind: z.enum(['file', 'directory']) })) })

const fixtures = [
  { name: 'open-file request', zod: zodOpenFileRequest, effect: openFileRequestSchema, input: { path: 'src/open-file.ts', line: 12 } },
  { name: 'go-to-line request', zod: zodGoToLineRequest, effect: goToLineRequestSchema, input: { line: 3 } },
  { name: 'file-link params', zod: zodFileLinkParams, effect: fileLinkParamsSchema, input: { line: 3 } },
  {
    name: 'workspace file listing',
    zod: zodListing,
    effect: listingSchema,
    input: { ok: true, value: { entries: [{ name: 'src', type: 'directory' }] } },
  },
  { name: 'workspace file search', zod: zodSearch, effect: searchSchema, input: { ok: true, value: [{ path: 'src/a.ts', kind: 'file' }] } },
]

export { Schema, fixtures, z }
