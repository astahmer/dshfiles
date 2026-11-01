import * as EffectSchema from 'effect/Schema'
import { z } from 'zod'
import { cloneProjectInputEffectSchema, resourceSnapshotSchema } from '../dist/api.js'

const snapshotZod = z
  .object({
    sampledAt: z.string().datetime(),
    platform: z.string().min(1).max(32),
    cpuCount: z.number().int().nonnegative().max(4096),
    loadAverage1m: z.number().finite().nonnegative().nullable(),
    memoryTotalBytes: z.number().int().nonnegative(),
    memoryFreeBytes: z.number().int().nonnegative(),
  })
  .strict()
  .refine(snapshot => snapshot.memoryFreeBytes <= snapshot.memoryTotalBytes, 'Free memory cannot exceed total memory.')

const idSchema = z.string().min(1).max(64)
const remotePathSchema = z
  .string()
  .trim()
  .min(2)
  .max(4096)
  .regex(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/u)
const cloneDestinationSchema = z.union([
  remotePathSchema,
  z
    .string()
    .trim()
    .min(3)
    .max(4096)
    .regex(/^~\/(?!\.\.(?:\/|$))(?!.*\/\.\.(?:\/|$)).+$/u),
])
const localProjectPathSchema = z.string().trim().min(1).max(4096)
const localProjectFilePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(path => !path.includes('\0') && !path.startsWith('/') && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..'))
const repositoryUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(
    /^(?:https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?:\.git)?|git@[A-Za-z0-9.-]+:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?:\.git)?)$/u,
  )
const cloneProjectZod = z
  .object({
    runtimeId: idSchema,
    repositoryUrl: repositoryUrlSchema,
    destinationPath: cloneDestinationSchema,
    copyFromPath: localProjectPathSchema.optional(),
    copyPaths: z.array(localProjectFilePathSchema).max(128).optional(),
    includeIgnored: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.copyFromPath === undefined) !== (input.copyPaths === undefined)) {
      context.addIssue({ code: 'custom', message: 'Local source folder and selected file list must be supplied together.' })
    }
    if (input.includeIgnored === true && input.copyFromPath === undefined) {
      context.addIssue({ code: 'custom', message: 'Scanning ignored files requires an explicit local source folder.' })
    }
  })

const snapshot = {
  sampledAt: '2026-10-31T12:00:00Z',
  platform: 'linux',
  cpuCount: 8,
  loadAverage1m: 0.5,
  memoryTotalBytes: 16_000,
  memoryFreeBytes: 8_000,
}
const clone = { runtimeId: 'runtime-1', repositoryUrl: 'https://github.com/owner/repo.git', destinationPath: '~/repo' }
const cloneWithFiles = {
  ...clone,
  copyFromPath: '/work/project',
  copyPaths: ['.env.example', 'notes.txt'],
  includeIgnored: true,
}
const cloneWithTrim = {
  ...cloneWithFiles,
  repositoryUrl: '  https://github.com/owner/repo.git  ',
  destinationPath: ' ~/repo ',
  copyFromPath: ' /work/project ',
}

const behavior = (effect, input, strict = false) => EffectSchema.decodeUnknownOption(effect, strict ? { onExcessProperty: 'error' } : {})(input)._tag === 'Some'
const assertCases = ({ name, zod, effect, valid, invalid, extra }) => {
  for (const input of valid) {
    const zodResult = zod.safeParse(input)
    const effectResult = EffectSchema.decodeUnknownResult(effect)(input)
    if (!zodResult.success || effectResult._tag !== 'Success' || JSON.stringify(zodResult.data) !== JSON.stringify(effectResult.success)) {
      throw new Error(`${name}: valid input did not round-trip through both schemas.`)
    }
  }
  for (const input of invalid) {
    if (zod.safeParse(input).success || behavior(effect, input)) throw new Error(`${name}: invalid input was not rejected by both schemas.`)
  }
  if (zod.safeParse(extra).success || behavior(effect, extra, true)) throw new Error(`${name}: strict object extra keys were not rejected by both schemas.`)
}

assertCases({
  name: 'resource snapshot',
  zod: snapshotZod,
  effect: resourceSnapshotSchema,
  valid: [snapshot, { ...snapshot, sampledAt: '2026-10-31T12:00Z' }],
  invalid: [
    { ...snapshot, memoryFreeBytes: 16_001 },
    { ...snapshot, cpuCount: -1 },
    { ...snapshot, sampledAt: '2026-02-29T12:00Z' },
    { ...snapshot, sampledAt: '2026-10-31T12:00:00+01:00' },
  ],
  extra: { ...snapshot, futureMetric: 1 },
})
assertCases({
  name: 'runtime clone input',
  zod: cloneProjectZod,
  effect: cloneProjectInputEffectSchema,
  valid: [clone, cloneWithFiles, cloneWithTrim],
  invalid: [
    { ...clone, repositoryUrl: 'file:///etc/passwd' },
    { ...clone, destinationPath: '~/../outside' },
    { ...clone, copyFromPath: '/work/project' },
    { ...cloneWithFiles, copyPaths: ['../outside'] },
  ],
  extra: { ...clone, futureOption: true },
})

const Schema = {
  ...EffectSchema,
  toJsonSchemaDocument: (schema, options) => EffectSchema.toJsonSchemaDocument(schema, { ...options, onExcessProperty: 'error' }),
}

const fixtures = [
  { name: 'resource snapshot', zod: snapshotZod, effect: resourceSnapshotSchema, input: snapshot },
  { name: 'runtime clone input', zod: cloneProjectZod, effect: cloneProjectInputEffectSchema, input: cloneWithFiles },
]

export { Schema, fixtures, z }
