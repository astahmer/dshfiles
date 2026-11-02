import { Schema } from 'effect'

export class McpServerNotFound extends Schema.TaggedError<McpServerNotFound>()(
  'McpServerNotFound',
  { id: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-server-not-found' },
) {
  override get message(): string {
    return 'MCP server was not found.'
  }
}

export class OAuthNotSupported extends Schema.TaggedError<OAuthNotSupported>()(
  'OAuthNotSupported',
  { id: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-oauth-not-supported' },
) {
  override get message(): string {
    return 'This server does not use OAuth sign-in.'
  }
}

export class OAuthRegistrationUnsupported extends Schema.TaggedError<OAuthRegistrationUnsupported>()(
  'OAuthRegistrationUnsupported',
  { id: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-oauth-registration-unsupported' },
) {
  override get message(): string {
    return 'This provider requires a pre-registered OAuth client. Store its token as a credential reference header instead.'
  }
}

/** Discovery, registration or the code exchange was refused; `reason` is the OAuth model's own bounded message. */
export class OAuthFlowFailed extends Schema.TaggedError<OAuthFlowFailed>()(
  'OAuthFlowFailed',
  {
    step: Schema.Literals(['discover', 'register', 'exchange', 'redirect', 'request']),
    reason: Schema.String.check(Schema.isMaxLength(240)),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'mcp-oauth-failed' },
) {
  override get message(): string {
    return this.reason
  }
}

/** A server edit the manager refuses; `reason` is the manager's own fixed sentence, never provider or user text. */
export class ServerChangeRejected extends Schema.TaggedError<ServerChangeRejected>()(
  'ServerChangeRejected',
  { reason: Schema.String.check(Schema.isMaxLength(240)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-server-change-rejected' },
) {
  override get message(): string {
    return this.reason
  }
}

export class RegistrySearchDisabled extends Schema.TaggedError<RegistrySearchDisabled>()(
  'RegistrySearchDisabled',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-registry-search-disabled' },
) {
  override get message(): string {
    return 'Public MCP Registry search is turned off in Settings.'
  }
}

export class RegistrySearchFailed extends Schema.TaggedError<RegistrySearchFailed>()(
  'RegistrySearchFailed',
  { reason: Schema.Literals(['request', 'status', 'too-large']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-registry-search-failed' },
) {
  override get message(): string {
    if (this.reason === 'too-large') return 'Registry response is too large.'
    return 'Registry request failed.'
  }
}

export class ManagerConfigUnavailable extends Schema.TaggedError<ManagerConfigUnavailable>()(
  'ManagerConfigUnavailable',
  { reason: Schema.Literals(['row-missing', 'invalid', 'write']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-config-unavailable' },
) {
  override get message(): string {
    if (this.reason === 'row-missing') return 'MCP manager profile row is unavailable.'
    if (this.reason === 'invalid') return 'MCP manager configuration is invalid.'
    return 'The MCP manager configuration could not be saved.'
  }
}

export class CredentialStoreFailed extends Schema.TaggedError<CredentialStoreFailed>()(
  'CredentialStoreFailed',
  { operation: Schema.Literals(['delete', 'write']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mcp-credentials-unavailable' },
) {
  override get message(): string {
    return 'The MCP sign-in credentials could not be updated.'
  }
}

/** The local start command did not resolve or spawn. */
export class LocalStartFailed extends Schema.TaggedError<LocalStartFailed>()('LocalStartFailed', {
  id: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The local MCP start command could not be launched.'
  }
}

/** The native MCP client fiber did not start. */
export class ClientStartFailed extends Schema.TaggedError<ClientStartFailed>()('ClientStartFailed', {
  id: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The native MCP client could not be started.'
  }
}

export class ExecutableUnresolved extends Schema.TaggedError<ExecutableUnresolved>()('ExecutableUnresolved', {
  command: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The ${this.command} executable could not be resolved.`
  }
}
