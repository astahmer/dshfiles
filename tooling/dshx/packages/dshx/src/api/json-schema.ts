import type { JsonSchemaNode, JsonSchemaType } from '@deepseek-ai/dsh-tools'
import type { StandardJSONSchemaV1 } from '@standard-schema/spec'
import type { ApiSchema, PublishedJsonSchema } from './types.js'

/** The Standard JSON Schema a contract schema publishes (zod >= 4.2 does), or undefined when it publishes none or cannot represent itself. */
export function publishedJsonSchema(schema: ApiSchema | undefined, io: 'input' | 'output'): PublishedJsonSchema | undefined {
  const standard = schema?.['~standard']
  if (standard === undefined || !('jsonSchema' in standard)) return undefined
  // SAFETY: a `~standard.jsonSchema` member is the Standard JSON Schema extension; a vendor that only shares the
  // name fails the call below, which the catch turns into "publishes nothing".
  const converter = (standard as StandardJSONSchemaV1.Props).jsonSchema
  try {
    // SAFETY: converters return a JSON Schema document. The projection reads it keyword by keyword, and DSH
    // validates the projected tool schema again when the tool registers.
    return structuredClone(converter[io]({ target: 'draft-2020-12' })) as PublishedJsonSchema
  } catch {
    return undefined
  }
}

const NODE_TYPES: readonly JsonSchemaType[] = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']
const SCALAR_TYPES: readonly JsonSchemaType[] = ['string', 'number', 'integer', 'boolean', 'null']

const nodeType = (type: PublishedJsonSchema['type']): JsonSchemaType | undefined => {
  const candidates = Array.isArray(type) ? type.filter(entry => entry !== 'null') : [type]
  return candidates.length === 1 ? NODE_TYPES.find(known => known === candidates[0]) : undefined
}

/** Object branches only: two branches that both project to `{}` would match every value and make `oneOf` unsatisfiable. */
const projectDiscriminatedUnion = (branches: readonly PublishedJsonSchema[], projected: JsonSchemaNode): JsonSchemaNode => {
  const projectedBranches = branches.map(toToolSchema)
  return projectedBranches.every(branch => branch.type === 'object' && branch.properties !== undefined) ? { ...projected, oneOf: projectedBranches } : projected
}

/**
 * Project a JSON Schema onto the subset DSH tools enforce. The projection only
 * loosens: an unsupported keyword is dropped, never guessed, and the contract's
 * own schema still validates every call at the Host boundary.
 *
 * `oneOf` is kept when every branch projects to an object: DSH enforces
 * exactly-one unions, and dropping that branch list is what left a
 * discriminated `action` property as `{}` in every tool schema.
 */
export function toToolSchema(node: PublishedJsonSchema | undefined): JsonSchemaNode {
  const projected: JsonSchemaNode = {}
  if (node === undefined) return projected
  if (node.description !== undefined) projected.description = node.description
  if (node.title !== undefined) projected.title = node.title
  if (node.oneOf !== undefined) {
    const meaningful = node.oneOf.filter(branch => branch.type !== 'null')
    if (meaningful.length === 1) return { ...toToolSchema(meaningful[0]), ...projected }
    if (meaningful.length > 1) return projectDiscriminatedUnion(meaningful, projected)
  }
  if (node.anyOf !== undefined) {
    const meaningful = node.anyOf.filter(branch => branch.type !== 'null')
    return meaningful.length === 1 ? { ...toToolSchema(meaningful[0]), ...projected } : projected
  }
  const type = nodeType(node.type)
  if (type === undefined) return projected
  projected.type = type
  if (SCALAR_TYPES.includes(type)) {
    if (node.enum !== undefined && node.enum.length > 0) projected.enum = [...node.enum]
    if (node.const !== undefined) projected.const = node.const
    return projected
  }
  if (type === 'array') {
    if (node.items !== undefined) projected.items = toToolSchema(node.items)
    return projected
  }
  const properties = node.properties ?? {}
  projected.properties = Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, toToolSchema(property)]))
  const required = (node.required ?? []).filter(key => key in properties)
  if (required.length > 0) projected.required = required
  if (node.additionalProperties === true || node.additionalProperties === false) projected.additionalProperties = node.additionalProperties
  return projected
}
