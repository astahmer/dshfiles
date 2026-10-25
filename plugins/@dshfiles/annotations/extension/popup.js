const endpoint = document.querySelector('#endpoint')
const token = document.querySelector('#token')
const status = document.querySelector('#status')

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3080/api/dshfiles-annotations/ingest'

const show = text => {
  if (status !== null) status.textContent = text
}

const ingestUrl = () => endpoint?.value.trim() || DEFAULT_ENDPOINT
const pairUrl = () => ingestUrl().replace(/\/ingest$/, '/pair')
const dshUrl = () => {
  try {
    return new URL(ingestUrl()).origin
  } catch {
    return ''
  }
}

const restored = await chrome.storage.local.get(['endpoint', 'token'])
if (endpoint !== null) endpoint.value = restored.endpoint ?? DEFAULT_ENDPOINT
if (token !== null && typeof restored.token === 'string') token.value = restored.token

document.querySelector('#pair')?.addEventListener('click', async () => {
  if (endpoint !== null) await chrome.storage.local.set({ endpoint: ingestUrl() })
  show('Asking DSH… click "Pair extension" there if you have not already.')
  try {
    const response = await fetch(pairUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (response.status === 409) {
      show('DSH is not waiting: open the annotations panel there and click "Pair extension".')
      return
    }
    if (!response.ok) {
      show(`DSH refused pairing (${response.status}).`)
      return
    }
    const body = await response.json()
    await chrome.storage.local.set({ token: body.token })
    if (token !== null) token.value = body.token
    show('Paired. Annotate this tab now.')
  } catch {
    show(`Could not reach DSH at ${dshUrl() || 'the configured URL'}. Is it running?`)
  }
})

document.querySelector('#save')?.addEventListener('click', async () => {
  await chrome.storage.local.set({ endpoint: ingestUrl(), token: token?.value ?? '' })
  show('Saved. DSH must be running to accept annotations.')
})

document.querySelector('#pick')?.addEventListener('click', async () => {
  show('Starting the picker…')
  const response = await chrome.runtime.sendMessage({ kind: 'annotations:start-pick' })
  show(response?.ok === true ? 'Picker armed: click an element in the page.' : `Could not start: ${response?.error ?? 'unknown error'}`)
})

chrome.runtime.onMessage.addListener(message => {
  if (message?.kind !== 'annotations:submitted') return
  show(message.ok === true ? 'Sent to DSH. Attach it to a thread there.' : `DSH refused it: ${message.error}`)
})
