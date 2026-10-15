import { useApi } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useMemo } from 'react'
import type { ApiClientInput } from '@dshfiles/dshx/api'
import { memoryApi } from './api.ts'
import { createNoteEditorActor, noteEditorMachine, type NoteEditorClient, type NoteEditorSeed } from './note-editor-machine.js'

type EditNoteInput = ApiClientInput<typeof memoryApi.methods.editNote>
type ForgetNoteInput = ApiClientInput<typeof memoryApi.methods.forgetNote>
type MutationVariables<Input> = { readonly input: Input; readonly signal: AbortSignal }

export const useNoteEditor = (note: NoteEditorSeed) => {
  const api = useApi(memoryApi)
  const queryClient = useQueryClient()
  const saveMutation = useMutation({
    mutationFn: ({ input, signal }: MutationVariables<EditNoteInput>) => api.editNote(input, { signal }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dshfiles-memory'] }),
  })
  const forgetMutation = useMutation({
    mutationFn: ({ input, signal }: MutationVariables<ForgetNoteInput>) => api.forgetNote(input, { signal }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dshfiles-memory'] }),
  })
  const { mutateAsync: saveAsync } = saveMutation
  const { mutateAsync: forgetAsync } = forgetMutation
  const client = useMemo<NoteEditorClient>(
    () => ({
      save: async (input, signal) => {
        await saveAsync({ input, signal })
      },
      forget: async (input, signal) => {
        await forgetAsync({ input, signal })
      },
    }),
    [forgetAsync, saveAsync],
  )
  const machine = useMemo(() => noteEditorMachine.provide({ actors: { persist: createNoteEditorActor(client) } }), [client])
  const [snapshot, send] = useMachine(machine, { input: { note } })
  return { snapshot, send }
}
