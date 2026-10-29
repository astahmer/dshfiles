import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const MAX_CONTEXT_POSTS = 13
const MAX_CONTEXT_IMAGES = 8
const MAX_CONTEXT_IMAGE_BYTES = 16 * 1024 * 1024
const imageSchema = z
  .object({
    name: z.string().min(1).max(200),
    attachmentId: z.string().min(1).max(128),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    bytes: z.number().int().positive().max(MAX_CONTEXT_IMAGE_BYTES),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
  })
  .strict()

const postSchema = z
  .object({
    url: z.string().url().max(2_048),
    author: z.string().min(1).max(300),
    username: z.string().min(1).max(100),
    postedAt: z.string().max(128).optional(),
    text: z.string().max(12_000),
  })
  .strict()

const outputSchema = z
  .object({
    posts: z.array(postSchema).max(MAX_CONTEXT_POSTS),
    images: z.array(imageSchema).max(MAX_CONTEXT_IMAGES),
    warnings: z.array(z.string().max(500)).max(64),
  })
  .strict()

export const tweetContextBacklogApi = defineApi({
  id: 'tweet-context-backlog',
  version: 1,
  owner: '@dshfiles/tweet-context',
  methods: {
    retrieve: method({
      input: z.object({ url: z.string().url().max(2_048) }).strict(),
      output: outputSchema,
      description:
        'Retrieve bounded public tweet text and saved image references for a Backlog item. Sends the post ID to FxEmbed, returns up to 13 post records and 8 image references capped at 16 MiB total. Host integration only; not an Agent tool.',
    }),
  },
})

export type TweetContextBacklogResult = z.infer<typeof outputSchema>

export const TweetContextBacklogLimits = {
  maxPosts: MAX_CONTEXT_POSTS,
  maxImages: MAX_CONTEXT_IMAGES,
  maxImageBytes: MAX_CONTEXT_IMAGE_BYTES,
}
