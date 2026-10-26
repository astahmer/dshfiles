import type { StandardSchemaV1 } from '@standard-schema/spec'

const CONFIG_VALIDATION_ERROR = 'Invalid plugin configuration.'

type SchemaOutput<Schema extends StandardSchemaV1> = StandardSchemaV1.InferOutput<Schema>

const safePath = (path: NonNullable<StandardSchemaV1.Issue['path']>): ReadonlyArray<string | number> =>
  path.flatMap(segment => {
    const key = typeof segment === 'object' && segment !== null ? segment.key : segment
    return typeof key === 'string' || typeof key === 'number' ? [key] : []
  })

const redactResult = <Output>(result: StandardSchemaV1.Result<Output>): StandardSchemaV1.Result<Output> => {
  try {
    if (result.issues === undefined) return result
    return {
      issues: result.issues.map(issue => ({
        message: CONFIG_VALIDATION_ERROR,
        ...(issue.path !== undefined && { path: safePath(issue.path) }),
      })),
    }
  } catch {
    return { issues: [{ message: CONFIG_VALIDATION_ERROR }] }
  }
}

export const redactConfigSchema = <Schema extends StandardSchemaV1>(schema: Schema): StandardSchemaV1<unknown, SchemaOutput<Schema>> => {
  const standard = schema['~standard']
  const safeStandard: StandardSchemaV1<unknown, SchemaOutput<Schema>>['~standard'] = {
    ...standard,
    validate(value, options) {
      let result: ReturnType<typeof standard.validate>
      try {
        result = standard.validate(value, options)
      } catch {
        return { issues: [{ message: CONFIG_VALIDATION_ERROR }] }
      }
      if (result instanceof Promise) {
        return result.then(redactResult, () => ({ issues: [{ message: CONFIG_VALIDATION_ERROR }] }))
      }
      try {
        return redactResult(result)
      } catch {
        return { issues: [{ message: CONFIG_VALIDATION_ERROR }] }
      }
    },
  }
  return { '~standard': safeStandard }
}
