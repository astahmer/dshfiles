export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (!url.includes('cordis-plugin-loader')) return result
  if (result.format !== 'module' && result.format !== 'commonjs') return result
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8')
  if (!source.includes('this.ctx.logger.error(error)')) return result
  const patched = source.replace(
    'this.ctx.logger.error(error);',
    'this.ctx.logger.error(error); console.error("[PROBE] loader import failed for", this.options.name, "\\n", error && error.stack ? error.stack : error);',
  )
  console.error('[PROBE] patched cordis-plugin-loader')
  return { ...result, source: patched }
}
