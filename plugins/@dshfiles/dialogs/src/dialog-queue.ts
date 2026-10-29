import {
  createSource,
  type AlertInput,
  type ConfirmInput,
  type DialogsService,
  type PromptInput,
  type SelectInput,
  type Subscribable,
} from '@dshfiles/dshx/client'

type Request<Kind extends string, Input, Answer> = {
  readonly id: number
  readonly kind: Kind
  readonly input: Input
  readonly settle: (answer: Answer) => void
}

export type DialogRequest =
  | Request<'confirm', ConfirmInput, boolean>
  | Request<'alert', AlertInput, void>
  | Request<'prompt', PromptInput, string | undefined>
  | Request<'select', SelectInput<string>, string | undefined>

export interface DialogQueue {
  readonly service: DialogsService
  /** The one open request; the rest wait in arrival order. */
  readonly current: Subscribable<DialogRequest | undefined>
  /** Answers every open and waiting request as cancelled, for when the plugin ends. */
  dispose(): void
}

export const cancelRequest = (request: DialogRequest): void => {
  switch (request.kind) {
    case 'confirm':
      return request.settle(false)
    case 'alert':
      return request.settle()
    case 'prompt':
    case 'select':
      return request.settle(undefined)
  }
}

/** One dialog open at a time: a request asked while another is open waits until every earlier one settles. */
export const createDialogQueue = (): DialogQueue => {
  const waiting: DialogRequest[] = []
  const current = createSource<DialogRequest | undefined>(undefined)
  let nextId = 0

  const advance = (): void => current.set(waiting[0])

  const enqueue = <Answer>(build: (id: number, settle: (answer: Answer) => void) => DialogRequest): Promise<Answer> =>
    new Promise<Answer>(resolve => {
      const id = nextId++
      let settled = false
      const settle = (answer: Answer): void => {
        if (settled) return
        settled = true
        const index = waiting.findIndex(request => request.id === id)
        if (index !== -1) waiting.splice(index, 1)
        resolve(answer)
        advance()
      }
      waiting.push(build(id, settle))
      advance()
    })

  const service: DialogsService = {
    confirm: input => enqueue<boolean>((id, settle) => ({ id, kind: 'confirm', input, settle })),
    alert: input => enqueue<void>((id, settle) => ({ id, kind: 'alert', input, settle })),
    prompt: input => enqueue<string | undefined>((id, settle) => ({ id, kind: 'prompt', input, settle })),
    select: <Value extends string>(input: SelectInput<Value>) =>
      enqueue<Value | undefined>((id, settle) => ({
        id,
        kind: 'select',
        input,
        settle: answer => settle(input.options.find(option => option.value === answer)?.value),
      })),
  }

  const dispose = (): void => {
    for (const request of [...waiting]) cancelRequest(request)
  }

  return { service, current, dispose }
}
