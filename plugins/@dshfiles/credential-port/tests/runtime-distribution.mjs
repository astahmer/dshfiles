import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatSecretReference, parseSecretReference, secretCredentialLabelSchema } from '@dshfiles/credential-port'
import { Schema } from 'effect'
import { SecretReferenceResolver, secretReferenceTextSchemaEffect } from '@dshfiles/credential-port/effect'

// Ordinary Node, not Vite: a TypeScript loader must not conceal missing runtime siblings.
test('the public credential port loads built JavaScript with working sibling imports', () => {
  assert.ok(import.meta.resolve('@dshfiles/credential-port').endsWith('/dist/index.js'))
  const parsed = parseSecretReference('secret:SYNTHETIC_SESSION')
  assert.deepEqual(parsed, { alias: 'SYNTHETIC_SESSION', environment: 'prod' })
  assert.equal(formatSecretReference(parsed), 'secret:SYNTHETIC_SESSION')
  assert.equal(secretCredentialLabelSchema.parse('secret:SYNTHETIC_SESSION@prod'), 'secret:SYNTHETIC_SESSION')
  assert.ok(import.meta.resolve('@dshfiles/credential-port/effect').endsWith('/dist/effect.js'))
  assert.equal(Schema.decodeUnknownSync(secretReferenceTextSchemaEffect)('secret:SYNTHETIC_SESSION'), 'secret:SYNTHETIC_SESSION')
  assert.equal(SecretReferenceResolver.key, '@dshfiles/credential-port/SecretReferenceResolver')
})
