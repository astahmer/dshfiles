/**
 * Moves a bundle between the browser and the Host in chunks: one dshx API call carries at most 1 MiB, and a thread
 * with screenshots is larger. Each step forwards `signal`, so closing the dialog stops the transfer.
 */
import type { ApiClient } from '@dshfiles/dshx/api'
import type { threadTransferApi } from './api.js'

export type TransferApi = ApiClient<(typeof threadTransferApi)['methods']>

export interface DownloadedBundle {
  readonly fileName: string
  readonly blob: Blob
  readonly summary: Awaited<ReturnType<TransferApi['exportStage']>>['summary']
}

export class BundleTransfer {
  static toBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    return btoa(binary)
  }

  static fromBase64(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }

  /** Build the thread's bundle on the Host and read it back into a Blob; `progress` gets the share read so far. */
  static async download(api: TransferApi, sessionId: string, progress: (share: number) => void, signal: AbortSignal): Promise<DownloadedBundle> {
    const staged = await api.exportStage({ sessionId }, { signal })
    const parts: Uint8Array<ArrayBuffer>[] = []
    let offset = 0
    for (;;) {
      const chunk = await api.exportChunk({ transferId: staged.transferId, offset }, { signal })
      parts.push(BundleTransfer.fromBase64(chunk.data))
      offset = chunk.nextOffset
      progress(staged.bytes === 0 ? 1 : offset / staged.bytes)
      if (chunk.done) break
    }
    return { fileName: staged.fileName, blob: new Blob(parts, { type: 'application/gzip' }), summary: staged.summary }
  }

  /** Hand a Blob to the browser's own download behavior. */
  static save(bundle: DownloadedBundle): void {
    const url = URL.createObjectURL(bundle.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = bundle.fileName
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  /** Upload a picked file to the Host in order and return the staged transfer's id. */
  static async upload(api: TransferApi, file: Blob, progress: (share: number) => void, signal: AbortSignal): Promise<string> {
    const staged = await api.importStage({ bytes: file.size }, { signal })
    let offset = 0
    while (offset < file.size) {
      const end = Math.min(file.size, offset + staged.chunkBytes)
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
      const written = await api.importChunk({ transferId: staged.transferId, offset, data: BundleTransfer.toBase64(bytes) }, { signal })
      offset = written.received
      progress(offset / file.size)
    }
    return staged.transferId
  }
}
