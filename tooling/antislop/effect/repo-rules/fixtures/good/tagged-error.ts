import { Schema } from 'effect'

export class MissingThing extends Schema.TaggedError<MissingThing>()('MissingThing', {
  message: Schema.String,
}) {}
