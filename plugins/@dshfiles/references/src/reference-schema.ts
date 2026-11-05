/**
 * The wire shapes of a saved reference, with no Node or storage imports so the `api` module (and every Client that
 * reads it) can share them with the Host store.
 */
import { Schema } from 'effect'

export const nameSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,47}$/u))

export const referenceSchema = Schema.Struct({
  name: nameSchema,
  kind: Schema.Literals(['directory', 'git']),
  /** The directory or the git URL the user gave. */
  source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  /** Branch or tag a git reference was cloned at; null for the remote's default branch or a directory. */
  ref: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  /** Where the agent reads it: the directory itself, or the clone under `$DSH_HOME/references`. */
  path: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

export const attachmentSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  names: Schema.Array(nameSchema).check(Schema.isMaxLength(32)),
})
