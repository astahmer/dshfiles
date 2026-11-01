import { Schema as S } from 'effect'

export class MissingThing extends S.TaggedError<MissingThing>('MissingThing', {
  message: S.String,
}) {}
