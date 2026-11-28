import { ThreadWorkStatusModel } from './thread-status-client.js'

/** This bundle's one projection store: the thread list publishes into it and the client entry provides it to readers. */
export const threadWorkStatusStore = ThreadWorkStatusModel.createStore()
