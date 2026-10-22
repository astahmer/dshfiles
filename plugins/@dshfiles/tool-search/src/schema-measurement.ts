export const serializedSchemaBytes = (schemaJson: string): number => Buffer.byteLength(schemaJson, 'utf8')
