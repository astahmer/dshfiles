export const failure = ({ code, message }) => Object.assign(new Error(message), { code })

export const validateScope = ({ organization, provider }) => {
  for (const identifier of [organization, provider]) {
    // oxlint-disable-next-line antislop/no-runtime-typeof -- The dependency-free evaluator must reject raw non-string scope input before regex coercion.
    if (typeof identifier !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(identifier))
      throw failure({ code: 'IC_INVALID_SCOPE', message: 'Invalid organization or provider identifier' })
  }
}
