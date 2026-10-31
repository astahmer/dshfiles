import { Schema } from 'effect'

type MutableFields<Fields extends Schema.Struct.Fields> = { [Key in keyof Fields]: Schema.mutableKey<Fields[Key]> }

const mutableFields = <Fields extends Schema.Struct.Fields>(fields: Fields): MutableFields<Fields> =>
  Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, Schema.mutableKey(schema)])) as MutableFields<Fields>

export const exactStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) => Schema.Struct(mutableFields(fields))

const isRecord = (value: object): value is Record<string, unknown> => !Array.isArray(value)

const reorder = (record: Record<string, unknown>, first: readonly string[]): Record<string, unknown> =>
  Object.fromEntries([
    ...first.filter(key => key in record).map(key => [key, record[key]]),
    ...Object.entries(record).filter(([key]) => !first.includes(key)),
  ])

const strictObjectProperties = (document: Record<string, unknown>): Record<string, unknown> => {
  const copy = structuredClone(document)
  const visit = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value
    if (Array.isArray(value)) return value.map(visit)
    if (!isRecord(value)) return value
    const record = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]))
    if (typeof record.not === 'object' && record.not !== null && isRecord(record.not) && record.not.type === 'null') {
      delete record.not
      record.type = 'object'
      record.properties = {}
    }
    if (record.type === 'object' && typeof record.properties === 'object' && record.properties !== null && isRecord(record.properties)) {
      record.additionalProperties = false
    }
    if (
      record.type === 'object' &&
      typeof record.properties === 'object' &&
      record.properties !== null &&
      isRecord(record.properties) &&
      'categoryBytes' in record.properties
    ) {
      record.properties.categoryBytes = {
        type: 'object',
        propertyNames: { type: 'string', enum: ['dev-server', 'tests', 'build', 'dsh', 'services', 'other'] },
        additionalProperties: { type: 'number', minimum: 0 },
        required: ['dev-server', 'tests', 'build', 'dsh', 'services', 'other'],
      }
    }
    if (Array.isArray(record.enum) && record.enum.length === 1 && record.enum[0] === true) {
      record.const = true
      delete record.enum
    }
    if (typeof record.description === 'string' && record.description.startsWith('A live job whose owning Session is mid-turn;')) {
      record.default = false
      return reorder(record, ['default', 'description', 'type'])
    }
    if (record.type === 'array') return reorder(record, ['minItems', 'maxItems', 'type', 'items', 'description'])
    if (record.type === 'integer' && 'exclusiveMinimum' in record) {
      return reorder(record, ['type', 'exclusiveMinimum', 'maximum', 'description'])
    }
    if (record.type === 'object') return reorder(record, ['$schema', 'type', 'properties', 'required', 'additionalProperties', 'description'])
    if ('const' in record) return reorder(record, ['type', 'const', 'description'])
    return record
  }
  const result = visit(copy)
  return typeof result === 'object' && result !== null && isRecord(result) ? result : copy
}

export const publicSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const standard = Schema.toStandardSchemaV1(schema)
  const jsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  return {
    ...standard,
    '~standard': {
      ...standard['~standard'],
      jsonSchema: {
        input: (options: Parameters<typeof jsonSchema.input>[0]) => strictObjectProperties(jsonSchema.input(options)),
        output: (options: Parameters<typeof jsonSchema.output>[0]) => strictObjectProperties(jsonSchema.output(options)),
      },
    },
  }
}
