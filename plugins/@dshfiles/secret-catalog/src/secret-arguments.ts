import { Schema } from 'effect'

/**
 * The client-side form grammar. These messages are user-visible, and each field reports one failing rule so the form
 * names the first thing to fix instead of every rule the value breaks.
 */
export class SecretArgumentRules {
  /** The first alias rule a value breaks, so a form reports one actionable message per field. */
  static readonly aliasIssue = (value: string): string | undefined => {
    if (value.length === 0) return 'Enter an alias.'
    if (value.length > 128) return 'An alias is at most 128 characters.'
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(value)) return 'Start with a letter or _, then use letters, digits, _ or -.'
    return undefined
  }

  /** The first environment rule a value breaks. */
  static readonly environmentIssue = (value: string): string | undefined => {
    if (value.length === 0) return 'Enter an environment.'
    if (value.length > 256) return 'An environment is at most 256 characters.'
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) return 'Use letters, digits, _ or -.'
    return undefined
  }

  /** Free text passed after a `secret` flag; a leading dash would be read as another flag. */
  static readonly optionValueIssue = (maxLength: number, value: string): string | undefined => {
    if (value.length > maxLength) return `A value is at most ${maxLength} characters.`
    if (value.startsWith('-')) return 'A value cannot start with "-".'
    return undefined
  }
}

export const aliasSchema = Schema.String.check(Schema.makeFilter(SecretArgumentRules.aliasIssue))

export const environmentSchema = Schema.String.check(Schema.makeFilter(SecretArgumentRules.environmentIssue))

export const optionValueSchema = (maxLength: number) =>
  Schema.String.check(Schema.makeFilter((value: string) => SecretArgumentRules.optionValueIssue(maxLength, value)))

export const updateMetadataFields = {
  name: Schema.optionalKey(optionValueSchema(512)),
  source: Schema.optionalKey(optionValueSchema(2048)),
  tags: Schema.optionalKey(optionValueSchema(1024)),
}

export const createMetadataFields = {
  ...updateMetadataFields,
  type: Schema.optionalKey(optionValueSchema(64)),
  field: Schema.optionalKey(optionValueSchema(256)),
}

export const updateMetadataSchema = Schema.Struct(updateMetadataFields)
export const createMetadataSchema = Schema.Struct(createMetadataFields)
