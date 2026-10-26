import { z } from 'zod'

/** Package metadata is JSON, including fields unknown to DSHX that repairs must preserve. */
export type JsonDocumentValue = string | number | boolean | null | JsonDocumentValue[] | JsonDocumentObject
export interface JsonDocumentObject {
  [key: string]: JsonDocumentValue | undefined
}

const valueSchema: z.ZodType<JsonDocumentValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(valueSchema), z.record(z.string(), valueSchema)]),
)

/** Decode at file boundaries; keep field diagnostics and lossless repair in their owning models. */
export class JsonDocumentModel {
  // Validate without replacing the document: z.record's parsed output drops an own
  // __proto__ key, which package repairs and target discovery must retain as metadata.
  static readonly valueSchema = z.custom<JsonDocumentValue>(value => valueSchema.safeParse(value).success)

  static parse(source: string): JsonDocumentValue {
    return JsonDocumentModel.valueSchema.parse(JSON.parse(source))
  }

  static isObject(value: JsonDocumentValue | undefined): value is JsonDocumentObject {
    return value instanceof Object && !Array.isArray(value)
  }

  static string(value: JsonDocumentValue | undefined): string | undefined {
    const parsed = z.string().safeParse(value)
    return parsed.success ? parsed.data : undefined
  }

  static stringArray(value: JsonDocumentValue | undefined): string[] | undefined {
    const parsed = z.array(z.string()).safeParse(value)
    return parsed.success ? parsed.data : undefined
  }
}
