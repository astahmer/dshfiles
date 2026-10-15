import { useApi } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useMemo } from 'react'
import { editorApi } from './api.js'
import { createEditorSaveActor, editorSaveMachine, type EditorSaveClient, type EditorSaveRequest } from './editor-save-machine.js'

type SaveVariables = { readonly request: EditorSaveRequest; readonly overwrite: boolean; readonly signal: AbortSignal }
type SaveCompleted = (documentId: string, bufferVersion: number, sha256: string) => void

export const useEditorSaveMachine = (onSaved: SaveCompleted) => {
  const api = useApi(editorApi)
  const mutation = useMutation({
    mutationFn: ({ request, overwrite, signal }: SaveVariables) =>
      api.write(
        {
          sessionId: request.sessionId,
          path: request.path,
          text: request.text,
          expectedSha256: request.expectedSha256,
          overwrite,
        },
        { signal },
      ),
    onSuccess: (result, variables) => {
      if (result.status === 'saved') onSaved(variables.request.documentId, variables.request.bufferVersion, result.sha256)
    },
  })
  const { mutateAsync: saveAsync } = mutation
  const client = useMemo<EditorSaveClient>(() => ({ write: (request, overwrite, signal) => saveAsync({ request, overwrite, signal }) }), [saveAsync])
  const machine = useMemo(() => editorSaveMachine.provide({ actors: { write: createEditorSaveActor(client) } }), [client])
  const [snapshot, send] = useMachine(machine)
  return { snapshot, send }
}
