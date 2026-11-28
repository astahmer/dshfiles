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

export class AgentRequired extends Schema.TaggedError<AgentRequired>()(
  'AgentRequired',
  { tool: Schema.optional(Schema.Literals(['tweet_context', 'animation_frames'])) },
  { dshxWireCode: 'agent-required' },
) {
  override get message(): string {
    return `${this.tool ?? 'tweet_context'} runs only on behalf of an Agent.`
  }
}

const sourceProblems = {
  'not-found': (path: string) => `No file at ${path}. Check the path; a relative path resolves from the thread's folder.`,
  inaccessible: (path: string) => `The DSH Host cannot open ${path}. Check that the Host user may read the file and its folders, then retry.`,
  'not-a-file': (path: string) => `${path} is not a regular file. Pass a video or GIF file, not a folder.`,
  'too-large': (path: string) =>
    `${path} is over the 100 MB limit. Trim it first, for example \`ffmpeg -ss <start> -t <seconds> -i <input> -c copy clip.mp4\`, then pass the clip.`,
  unreadable: (path: string) => `ffmpeg could not read ${path} as a video or GIF. Export it as MP4, WebM, MOV or GIF and retry.`,
  'no-video': (path: string) => `${path} has no video stream. Pass a screen recording, a video or an animated GIF.`,
  'no-working-directory': () => 'The thread has no usable folder to resolve a relative path. Pass an absolute path, or set the thread folder and retry.',
} as const

/** The reference file cannot be used as given; the message says what to pass instead. */
export class AnimationSourceUnavailable extends Schema.TaggedError<AnimationSourceUnavailable>()(
  'AnimationSourceUnavailable',
  {
    reason: Schema.Literals(['not-found', 'inaccessible', 'not-a-file', 'too-large', 'unreadable', 'no-video', 'no-working-directory']),
    path: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'animation-source-unavailable' },
) {
  override get message(): string {
    return sourceProblems[this.reason](JSON.stringify(this.path))
  }
}

const windowProblems = {
  negative: 'startSeconds and endSeconds count from the start of the clip; use 0 or more.',
  'start-after-end': 'endSeconds must be after startSeconds.',
  'start-outside-clip': 'startSeconds is at or past the end of the clip; pick a start inside it.',
  'too-long': 'The window is longer than 60 seconds; narrow startSeconds/endSeconds to the animation you want.',
} as const

export class InvalidAnimationWindow extends Schema.TaggedError<InvalidAnimationWindow>()(
  'InvalidAnimationWindow',
  { reason: Schema.Literals(['negative', 'start-after-end', 'start-outside-clip', 'too-long']), durationSeconds: Schema.optional(Schema.Number) },
  { dshxWireCode: 'invalid-animation-window' },
) {
  override get message(): string {
    const duration = this.durationSeconds === undefined ? '' : ` The clip lasts ${String(this.durationSeconds)} s.`
    return `${windowProblems[this.reason]}${duration}`
  }
}

const animationSamplingProblems = {
  'ffmpeg-missing':
    'ffmpeg must be on the DSH Host PATH to read animations. Install it (for example `brew install ffmpeg` or `apt install ffmpeg`), then retry.',
  'probe-failed': 'ffmpeg could not inspect this file within its time limit. Retry, or export a shorter clip.',
  'scan-failed': 'ffmpeg could not scan this window within its time and memory limits. Narrow startSeconds/endSeconds, or export a smaller clip.',
  'decode-failed': 'ffmpeg could not extract the key frames within its limits. Narrow startSeconds/endSeconds or lower maxFrames, then retry.',
  'no-frames': 'ffmpeg decoded no frames in this window. Check startSeconds/endSeconds against the clip duration.',
  'frames-unreadable':
    'The extracted frames could not be read from the Host temporary folder. Retry; if it persists, check free space in the temporary folder.',
} as const

export class AnimationSamplingFailed extends Schema.TaggedError<AnimationSamplingFailed>()(
  'AnimationSamplingFailed',
  {
    reason: Schema.Literals(['ffmpeg-missing', 'probe-failed', 'scan-failed', 'decode-failed', 'no-frames', 'frames-unreadable']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'animation-sampling-failed' },
) {
  override get message(): string {
    return animationSamplingProblems[this.reason]
  }
}

export type MediaError = PhotoUnavailable | VideoUnavailable | FrameSamplingFailed | AttachmentSaveFailed
