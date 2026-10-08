import tailwindcss from '@tailwindcss/vite'

/** Client Vite plugins every plugin-ui consumer needs; call once per build (dshx rejects reused instances). */
export const pluginUiVite = (): ReturnType<typeof tailwindcss> => tailwindcss()
