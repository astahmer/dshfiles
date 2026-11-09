/** Detect executable module requests without flagging source paths, diagnostics or immutable runtime snapshot imports. */
export function containsPrivateDshxImport(code: string): boolean {
  return /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']@dshfiles\/dshx\/(?!runtime-store\/[0-9a-f]{20}\/)/.test(code)
}
