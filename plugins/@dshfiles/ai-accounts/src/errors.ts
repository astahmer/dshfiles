import { Schema } from 'effect'
import { AccountOrderModel } from './account-order-model.js'

/** Another credential or profile operation holds one of these accounts; the new one is refused, not queued. */
export class AccountOperationBusy extends Schema.TaggedError<AccountOperationBusy>()(
  'AccountOperationBusy',
  { instanceIds: Schema.Array(Schema.String), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'account-busy' },
) {
  override get message(): string {
    return 'An account operation is already running. Wait for it to finish before changing its credentials or profile.'
  }
}

/** A connection or sign-in still owns the account, so it cannot be signed out yet. */
export class AccountSignInActive extends Schema.TaggedError<AccountSignInActive>()(
  'AccountSignInActive',
  { instanceId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'account-sign-in-active' },
) {
  override get message(): string {
    return 'Close the active account connection or sign-in before signing this account out.'
  }
}

export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()(
  'AccountNotFound',
  { instanceId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'account-not-found' },
) {
  override get message(): string {
    return 'This saved account is no longer available.'
  }
}

/** The account exists but cannot do what was asked: keyed import on a Codex account, a thread switch to Cursor. */
export class AccountUnsuitable extends Schema.TaggedError<AccountUnsuitable>()(
  'AccountUnsuitable',
  {
    instanceId: Schema.String,
    reason: Schema.Literals(['not-keyed', 'invalid-key-env', 'cannot-run-models', 'no-route']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'account-unsuitable' },
) {
  override get message(): string {
    if (this.reason === 'not-keyed') return 'This keyed account is no longer available.'
    if (this.reason === 'invalid-key-env') return 'Save a valid API-key variable ending in _API_KEY first.'
    if (this.reason === 'cannot-run-models') return 'Choose an enabled account that can run models on this Host.'
    return 'This account has no active model route. Connect the account first.'
  }
}

export class LoginIntentInactive extends Schema.TaggedError<LoginIntentInactive>()(
  'LoginIntentInactive',
  { instanceId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'login-intent-inactive' },
) {
  override get message(): string {
    return 'This account sign-in intent is no longer active.'
  }
}

const sessionScopeMessages = {
  'fast-mode-agent-session': 'Fast mode requires an active Agent session.',
  'fast-mode-other-session': 'Agents can only access Fast mode for their own session.',
  'fast-mode-session': 'Fast mode requires a session ID.',
  'serving-agent-session': 'Serving account metadata requires an active Agent session.',
  'serving-other-session': 'Agents can only read serving account metadata for their own session.',
  'serving-session': 'Serving account metadata requires a session ID.',
} as const

/** The caller named no session, or an Agent named another Agent's session. */
export class SessionScopeRefused extends Schema.TaggedError<SessionScopeRefused>()(
  'SessionScopeRefused',
  {
    reason: Schema.Literals([
      'fast-mode-agent-session',
      'fast-mode-other-session',
      'fast-mode-session',
      'serving-agent-session',
      'serving-other-session',
      'serving-session',
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'session-scope-refused' },
) {
  override get message(): string {
    return sessionScopeMessages[this.reason]
  }
}

/** Raw credential values are typed only in the browser. */
export class BrowserOnlyCredential extends Schema.TaggedError<BrowserOnlyCredential>()(
  'BrowserOnlyCredential',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'browser-only' },
) {
  override get message(): string {
    return 'Raw credential entry is browser-only. Use Secret Catalog import instead.'
  }
}

export class SetupMethodRetired extends Schema.TaggedError<SetupMethodRetired>()(
  'SetupMethodRetired',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'setup-method-retired' },
) {
  override get message(): string {
    return 'This account setup method is retired. Use prepareAccountConnection on an updated client; no account was saved.'
  }
}

const secretCatalogMessages = {
  inactive: 'Secret Catalog is not active.',
  outdated: 'Pending credential import requires an updated Secret Catalog Host with exact-scope resolution.',
  'scope-folder': 'Choose a folder for that credential scope.',
  ambiguous: 'That Secret Catalog entry is unavailable or ambiguous.',
  unreadable: 'The selected Secret Catalog entry could not be read.',
} as const

export class SecretCatalogUnavailable extends Schema.TaggedError<SecretCatalogUnavailable>()(
  'SecretCatalogUnavailable',
  { reason: Schema.Literals(['inactive', 'outdated', 'scope-folder', 'ambiguous', 'unreadable']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'secret-catalog-unavailable' },
) {
  override get message(): string {
    return secretCatalogMessages[this.reason]
  }
}

const serviceMessages = {
  'session-controller': 'Session model selection is unavailable.',
  'model-fallback-storage': 'Model fallback storage is unavailable.',
} as const

/** A Host service the call needs is not loaded. */
export class HostServiceUnavailable extends Schema.TaggedError<HostServiceUnavailable>()(
  'HostServiceUnavailable',
  { service: Schema.Literals(['session-controller', 'model-fallback-storage']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'service-unavailable' },
) {
  override get message(): string {
    return serviceMessages[this.service]
  }
}

/** The plugin that owns an API this call depends on is not loaded. */
export class OwnerApiMissing extends Schema.TaggedError<OwnerApiMissing>()(
  'OwnerApiMissing',
  { owner: Schema.String, apiId: Schema.String, method: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'owner-missing' },
) {
  override get message(): string {
    return `${this.owner} is not loaded, so ${this.apiId}.${this.method} is unavailable.`
  }
}

/** The previewed target went stale before the switch was confirmed. */
export class ThreadSelectionChanged extends Schema.TaggedError<ThreadSelectionChanged>()(
  'ThreadSelectionChanged',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'selection-changed' },
) {
  override get message(): string {
    return 'The thread selection or account catalog changed. Review the new target before switching.'
  }
}

const conflictMessages = {
  'identity-saved': () => 'This account identity is already saved.',
  removed: () => 'This saved account was removed.',
  'connection-changed': () => 'The saved account connection settings changed. Start again.',
  'connection-inactive': () => 'This account connection is no longer active.',
  'name-taken': (instanceId: string) => `An account named '${instanceId}' already exists.`,
  'not-saved': () => 'Connect a new account before saving its settings; this saved account no longer exists.',
  missing: (instanceId: string) => `Account '${instanceId}' is no longer available.`,
} as const

/** The accounts file no longer matches what the edit was based on. */
export class AccountConflict extends Schema.TaggedError<AccountConflict>()(
  'AccountConflict',
  {
    instanceId: Schema.String,
    reason: Schema.Literals(['identity-saved', 'removed', 'connection-changed', 'connection-inactive', 'name-taken', 'not-saved', 'missing']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'account-conflict' },
) {
  override get message(): string {
    return conflictMessages[this.reason](this.instanceId)
  }
}

/** A priority move named a missing account, crossed provider groups, or was based on a stale order. */
export class AccountOrderRejected extends Schema.TaggedError<AccountOrderRejected>()(
  'AccountOrderRejected',
  { reason: Schema.Literals(['missing', 'cross-provider', 'stale']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'account-order-rejected' },
) {
  override get message(): string {
    return AccountOrderModel.rejectionMessage(this.reason)
  }
}

/** The accounts file could not be written; the previous file stays in place. */
export class AccountStoreWriteFailed extends Schema.TaggedError<AccountStoreWriteFailed>()(
  'AccountStoreWriteFailed',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'account-store-write-failed' },
) {
  override get message(): string {
    return 'The accounts file could not be saved. Check that the DSH home is writable, then retry.'
  }
}

/** Every failure the account APIs expose to their callers. */
export const AccountsWireError = Schema.Union([
  AccountOperationBusy,
  AccountSignInActive,
  AccountNotFound,
  AccountUnsuitable,
  LoginIntentInactive,
  SessionScopeRefused,
  BrowserOnlyCredential,
  SetupMethodRetired,
  SecretCatalogUnavailable,
  HostServiceUnavailable,
  OwnerApiMissing,
  ThreadSelectionChanged,
  AccountConflict,
  AccountOrderRejected,
  AccountStoreWriteFailed,
])
