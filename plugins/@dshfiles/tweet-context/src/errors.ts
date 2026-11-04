import { Schema } from 'effect'

export class InvalidTweetUrl extends Schema.TaggedError<InvalidTweetUrl>()('InvalidTweetUrl', {}, { dshxWireCode: 'invalid-tweet-url' }) {
  override get message(): string {
    return 'Provide an HTTPS X/Twitter post URL containing /status/<id>.'
  }
}

export class InvalidSamplingOptions extends Schema.TaggedError<InvalidSamplingOptions>()(
  'InvalidSamplingOptions',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-sampling-options' },
) {
  override get message(): string {
    return 'Video sampling options must use maxFrames 0–24 and timestamps within the 10-minute video limit.'
  }
}

const postProblems = {
  unreachable: 'Could not reach the FxEmbed post API.',
  unreadable: 'FxEmbed returned an unreadable post response.',
  unsupported: 'FxEmbed returned an unsupported or unavailable post response.',
  empty: 'The post response was empty.',
} as const

export class PostUnavailable extends Schema.TaggedError<PostUnavailable>()(
  'PostUnavailable',
  {
    reason: Schema.Literals(['unreachable', 'http-status', 'unreadable', 'unsupported', 'empty']),
    status: Schema.optional(Schema.Int),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'post-unavailable' },
) {
  override get message(): string {
    if (this.reason === 'http-status') return `FxEmbed could not fetch this post (HTTP ${String(this.status)}).`
    return postProblems[this.reason]
  }
}

const photoProblems = {
  'unsupported-url': 'The post service returned an unsupported photo URL.',
  unreachable: 'Could not fetch the X photo from pbs.twimg.com.',
  'invalid-redirect': 'The photo host returned an invalid redirect.',
  'too-many-redirects': 'The photo host redirected too many times.',
  'unsupported-type': 'The X photo response was not a supported image.',
  'too-large': 'The X photo exceeds the 10 MB download limit.',
  empty: 'The X photo response was empty.',
} as const

export class PhotoUnavailable extends Schema.TaggedError<PhotoUnavailable>()('PhotoUnavailable', {
  reason: Schema.Literals([
    'unsupported-url',
    'unreachable',
    'invalid-redirect',
    'too-many-redirects',
    'http-status',
    'unsupported-type',
    'too-large',
    'empty',
  ]),
  status: Schema.optional(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'http-status') return `X photo download failed (HTTP ${String(this.status)}).`
    return photoProblems[this.reason]
  }
}

const videoProblems = {
  'too-long': 'Videos longer than 10 minutes are not sampled.',
  'no-variant': 'No size-limited MP4 video variant is available for this post.',
  'unsupported-url': 'The post service returned an unsupported video URL.',
  unreachable: 'Could not fetch the X video from video.twimg.com.',
  'not-mp4': 'The X video response was not an MP4 file.',
  'too-large': 'The X video exceeds the 25 MB download limit.',
  empty: 'The X video response was empty.',
  'temp-directory': 'Could not prepare a private temporary directory for the X video.',
} as const

export class VideoUnavailable extends Schema.TaggedError<VideoUnavailable>()('VideoUnavailable', {
  reason: Schema.Literals(['too-long', 'no-variant', 'unsupported-url', 'unreachable', 'http-status', 'not-mp4', 'too-large', 'empty', 'temp-directory']),
  status: Schema.optional(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'http-status') return `X video download failed (HTTP ${String(this.status)}).`
    return videoProblems[this.reason]
  }
}

const samplingProblems = {
  'invalid-window': 'Video sampling start must be before its end and within the video.',
  'ffmpeg-missing': 'ffmpeg must be available on the DSH Host PATH to sample video frames.',
  'scan-failed': 'ffmpeg could not scan this X video.',
  'decode-failed': 'ffmpeg could not decode this X video.',
  'no-frames': 'ffmpeg did not produce any video frames.',
  'no-selected-frames': 'ffmpeg did not produce any selected video frames.',
  'frames-unreadable': 'The sampled video frames could not be read.',
} as const

export class FrameSamplingFailed extends Schema.TaggedError<FrameSamplingFailed>()(
  'FrameSamplingFailed',
  {
    reason: Schema.Literals(['invalid-window', 'ffmpeg-missing', 'scan-failed', 'decode-failed', 'no-frames', 'no-selected-frames', 'frames-unreadable']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'frame-sampling-failed' },
) {
  override get message(): string {
    return samplingProblems[this.reason]
  }
}

export class AttachmentSaveFailed extends Schema.TaggedError<AttachmentSaveFailed>()('AttachmentSaveFailed', {
  reason: Schema.Literals(['rejected', 'incomplete']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason === 'incomplete' ? 'The attachment store returned an incomplete image batch.' : 'The attachment store could not save the image.'
  }
}

export class AgentRequired extends Schema.TaggedError<AgentRequired>()('AgentRequired', {}, { dshxWireCode: 'agent-required' }) {
  override get message(): string {
    return 'tweet_context runs only on behalf of an Agent.'
  }
}

export type MediaError = PhotoUnavailable | VideoUnavailable | FrameSamplingFailed | AttachmentSaveFailed
