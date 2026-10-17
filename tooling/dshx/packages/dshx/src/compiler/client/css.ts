import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin, Rollup } from 'vite'
import { DshxError } from '../../diagnostics.js'

function cssSource(asset: Rollup.OutputAsset): string {
  return typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source).toString('utf8')
}

const SHARED_SHEET_OWNER = 'dshx:shared-css'

/**
 * Plugins built from the same Tailwind input emit byte-identical CSS, so the sheet is keyed by content hash and
 * injected once. Each plugin keeps an empty owned marker `style[data-plugin]` for the Host's HMR/disposal
 * bookkeeping; the shared sheet is owned by no plugin and is removed once no marker references its hash.
 */
function sharedCssHash(css: string): string {
  return createHash('sha256').update(css).digest('hex').slice(0, 16)
}

/**
 * `suppliedHash` is the sheet hash a shared-runtime supplier injects. A bundle whose own hash matches it ships no
 * sheet-derived byte at all — not the sheet, not the hash — so a class change anywhere cannot move its output; the
 * supplier's marker is the only owner of the shared sheet.
 */
function materializer(packageId: string, css: string, suppliedHash: string | undefined): string {
  if (css === '') return ''
  const styleId = `${packageId}/client.css`
  const hash = sharedCssHash(css)
  const ownsSheet = hash !== suppliedHash
  const marker = `if(document.querySelector(select("data-plugin-css",${JSON.stringify(styleId)}))===null){const marker=document.createElement("style");marker.dataset.plugin=${JSON.stringify(packageId)};marker.dataset.pluginCss=${JSON.stringify(styleId)};${ownsSheet ? 'marker.dataset.dshxCss=hash;' : ''}document.head.appendChild(marker)}`
  const sheet = ownsSheet
    ? `if(document.querySelector(select("data-dshx-shared-css",hash))===null){const sheet=document.createElement("style");sheet.dataset.plugin=${JSON.stringify(SHARED_SHEET_OWNER)};sheet.dataset.dshxSharedCss=hash;sheet.textContent=${JSON.stringify(css)};document.head.appendChild(sheet)}`
    : ''
  const hashConst = ownsSheet ? `const hash=${JSON.stringify(hash)};` : ''
  return `if(typeof document!=="undefined"){const select=(name,value)=>"style["+name+"="+JSON.stringify(value)+"]";${hashConst}${marker}${sheet}const key=Symbol.for("dshx.sharedCss.v1");if(globalThis[key]===undefined&&typeof MutationObserver!=="undefined"){globalThis[key]=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes){const removed=node.dataset?.dshxCss;if(removed!==undefined&&document.querySelector(select("data-dshx-css",removed))===null)document.querySelector(select("data-dshx-shared-css",removed))?.remove()}});globalThis[key].observe(document.head,{childList:true})}}`
}

/** Fold Vite's one native CSS asset into the lazy Client factory. */
export function clientCssPlugin(options: {
  readonly packageId: string
  readonly outDir: string
  readonly suppliedHash?: string | undefined
  readonly onSheet?: (hash: string | undefined) => void
}): Plugin {
  const { packageId, outDir } = options
  let pendingMaterializer = ''
  return {
    name: 'dshx-client-css-fold',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk' && item.isEntry)
      if (chunks.length !== 1) return
      const css = Object.entries(bundle).filter(
        (entry): entry is [string, Rollup.OutputAsset] => entry[1].type === 'asset' && entry[1].fileName.endsWith('.css'),
      )
      if (css.length > 1) {
        throw new DshxError('DSHX1102', `A DSH Client build emitted multiple CSS assets: ${css.map(([, asset]) => asset.fileName).join(', ')}.`, {
          hint: 'Keep cssCodeSplit disabled and combine styles through the standard Vite CSS graph.',
        })
      }
      const chunk = chunks[0]
      if (chunk === undefined || chunk.type !== 'chunk') return
      const source = css[0] === undefined ? '' : cssSource(css[0][1])
      options.onSheet?.(source === '' ? undefined : sharedCssHash(source))
      pendingMaterializer = materializer(packageId, source, options.suppliedHash)
      if (css[0] !== undefined) delete bundle[css[0][0]]
    },
    async writeBundle() {
      if (pendingMaterializer === '') return
      const file = resolve(outDir, 'client.js')
      const code = await readFile(file, 'utf8')
      const offset = code.lastIndexOf('return module.exports;')
      if (offset >= 0) {
        const lineStart = code.lastIndexOf('\n', offset) + 1
        const indentation = code.slice(lineStart, offset)
        // Insertion occurs after all mapped module code and immediately before the
        // generated factory return, so existing source mappings remain aligned.
        await writeFile(file, `${code.slice(0, lineStart)}${indentation}${pendingMaterializer}\n${code.slice(lineStart)}`, 'utf8')
        return
      }
      // A minified factory ends `return e.Config=…,t.exports}})`; insert before that return on the same line.
      const minifiedReturn = [...code.matchAll(/return\s[^;{}]*?[\w$]+\.exports\s*\}\s*\}\s*\)/g)].at(-1)
      if (minifiedReturn === undefined) throw new DshxError('DSHX1102', 'The lazy Client factory return marker is missing from client.js.')
      await writeFile(file, `${code.slice(0, minifiedReturn.index)}${pendingMaterializer}${code.slice(minifiedReturn.index)}`, 'utf8')
    },
  }
}
