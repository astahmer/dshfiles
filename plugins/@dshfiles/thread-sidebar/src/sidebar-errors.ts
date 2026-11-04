import { Schema } from 'effect'

/** The thread attention records could not be read or written in the Host storage domain. */
export class AttentionStorageFailed extends Schema.TaggedError<AttentionStorageFailed>()(
  'AttentionStorageFailed',
  { operation: Schema.Literals(['open', 'record', 'acknowledge', 'clear', 'mark', 'migrate', 'trim']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'attention-storage-failed' },
) {
  override get message(): string {
    return `Thread attention could not ${this.operation === 'open' ? 'open its storage' : `save the ${this.operation} change`}. Retry, or restart DSH if it keeps failing.`
  }
}

/** One of the plugin's small state files under `<DSH home>/runtime` could not be read or replaced. */
export class RuntimeStateFailed extends Schema.TaggedError<RuntimeStateFailed>()(
  'RuntimeStateFailed',
  { file: Schema.Literals(['recoveries', 'inflight-turns', 'navigation']), operation: Schema.Literals(['read', 'write']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'runtime-state-failed' },
) {
  override get message(): string {
    return `The thread-sidebar ${this.file} state could not be ${this.operation === 'read' ? 'read' : 'saved'}. Check that the DSH runtime folder is writable, then retry.`
  }
}

/** A stored state file exists but does not match any version this Host reads. */
export class RuntimeStateInvalid extends Schema.TaggedError<RuntimeStateInvalid>()(
  'RuntimeStateInvalid',
  { file: Schema.Literals(['recoveries', 'inflight-turns']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'runtime-state-invalid' },
) {
  override get message(): string {
    return `The thread-sidebar ${this.file} state file is not valid. Remove it from the DSH runtime folder to start over.`
  }
}

/** A turn boundary could not be written to the in-flight marker file; a crash during that turn would show no resume row. */
export class InflightMarkerWriteFailed extends Schema.TaggedError<InflightMarkerWriteFailed>()('InflightMarkerWriteFailed', {
  sessionId: Schema.String,
  boundary: Schema.Literals(['start', 'end']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The in-flight marker of ${this.sessionId} could not be ${this.boundary === 'start' ? 'recorded' : 'cleared'}.`
  }
}

/** The Host is not running under the dsh-web supervisor, so it cannot restart itself. */
export class RestartUnavailable extends Schema.TaggedError<RestartUnavailable>()(
  'RestartUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'restart-unavailable' },
) {
  override get message(): string {
    return 'This DSH process is not running under the managed restart launcher. Start DSH with the dsh-web supervisor, or restart it by hand.'
  }
}

/** The supervisor's restart request file could not be written. */
export class RestartRequestFailed extends Schema.TaggedError<RestartRequestFailed>()(
  'RestartRequestFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'restart-request-failed' },
) {
  override get message(): string {
    return 'Could not schedule a safe DSH restart. Retry, or restart DSH by hand.'
  }
}

/** The running threads could not be recorded before a restart, so the restart was called off. */
export class RestartRecordFailed extends Schema.TaggedError<RestartRecordFailed>()('RestartRecordFailed', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return 'The managed restart was canceled because running-thread recovery could not be saved.'
  }
}

/** A Host service this plugin needs for one verb is missing from the running DSH. */
export class HostCapabilityMissing extends Schema.TaggedError<HostCapabilityMissing>()(
  'HostCapabilityMissing',
  { capability: Schema.Literals(['session-persistence', 'session-controller']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'host-capability-missing' },
) {
  override get message(): string {
    return this.capability === 'session-persistence'
      ? 'Session persistence is unavailable on this DSH, so running threads cannot be recorded before a restart.'
      : 'This DSH has no Session controller, so a thread cannot be resumed. Open the thread and send a message instead.'
  }
}

/** A Host call failed; the cause stays in the Host log. */
export class HostCallFailed extends Schema.TaggedError<HostCallFailed>()(
  'HostCallFailed',
  { operation: Schema.String.check(Schema.isMaxLength(64)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'host-call-failed' },
) {
  override get message(): string {
    return `The Host could not ${this.operation}. Retry in a moment.`
  }
}

/** A Host verb behind a thread or project action failed; the actions read the Host's own error code from `cause`. */
export class ThreadHostCallFailed extends Schema.TaggedError<ThreadHostCallFailed>()('ThreadHostCallFailed', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return 'A Host call behind a thread action failed.'
  }
}

/** The thread-sidebar settings could not be written. */
export class SidebarSettingsWriteFailed extends Schema.TaggedError<SidebarSettingsWriteFailed>()(
  'SidebarSettingsWriteFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'settings-write-failed' },
) {
  override get message(): string {
    return 'The thread-sidebar settings could not be saved. Retry, or reload the page if another tab changed them.'
  }
}
