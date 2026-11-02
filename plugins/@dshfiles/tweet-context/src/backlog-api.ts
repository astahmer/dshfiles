import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { urlString } from './schema.js'

const MAX_CONTEXT_POSTS = 13
const MAX_CONTEXT_IMAGES = 8
const MAX_CONTEXT_IMAGE_BYTES = 16 * 1024 * 1024

const imageSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  mediaType: Schema.Literals(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_CONTEXT_IMAGE_BYTES)),
  width: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(20_000)),
  height: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(20_000)),
})

const postSchema = Schema.Struct({
  url: urlString,
  author: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
  username: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  postedAt: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
  text: Schema.String.check(Schema.isMaxLength(12_000)),
})

const outputSchema = Schema.Struct({
  posts: Schema.Array(postSchema).check(Schema.isMaxLength(MAX_CONTEXT_POSTS)),
  images: Schema.Array(imageSchema).check(Schema.isMaxLength(MAX_CONTEXT_IMAGES)),
  warnings: Schema.Array(Schema.String.check(Schema.isMaxLength(500))).check(Schema.isMaxLength(64)),
})

export const tweetContextBacklogOutputSchema = outputSchema

export const tweetContextBacklogApi = defineApi({
  id: 'tweet-context-backlog',
  version: 1,
  owner: '@dshfiles/tweet-context',
  methods: {
    retrieve: method({
      input: Schema.Struct({ url: urlString }),
      output: outputSchema,
      description:
        'Retrieve bounded public tweet text and saved image references for a Backlog item. Sends the post ID to FxEmbed, returns up to 13 post records and 8 image references capped at 16 MiB total. Host integration only; not an Agent tool.',
    }),
  },
})

export type TweetContextBacklogResult = typeof outputSchema.Type

export const TweetContextBacklogLimits = {
  maxPosts: MAX_CONTEXT_POSTS,
  maxImages: MAX_CONTEXT_IMAGES,
  maxImageBytes: MAX_CONTEXT_IMAGE_BYTES,
}
