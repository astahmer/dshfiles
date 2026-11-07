import DOMPurify from 'dompurify'

/** Turns pele's SVG markup into the fragment pele mounts. */
export interface DiagramSanitizers {
  /** Diagrams without math labels. */
  readonly plain: (svg: string) => Node
  /** Diagrams whose `$$…$$` labels pele wraps as KaTeX MathML in a `<foreignObject>`. */
  readonly math: (svg: string) => Node
}

/** MathML elements KaTeX emits, without annotation (the resolver removes it), semantics (a wrapper) and mglyph (an image). */
const KATEX_MATHML_TAGS = new Set([
  'math',
  'menclose',
  'mfrac',
  'mi',
  'mlabeledtr',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mroot',
  'mrow',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
])
/** Presentation attributes KaTeX sets on those elements; the profiles already cover class, style, width and height. */
const KATEX_MATHML_ATTRIBUTES = new Set([
  'accent',
  'accentunder',
  'columnalign',
  'columnlines',
  'columnspacing',
  'depth',
  'displaystyle',
  'fence',
  'largeop',
  'linebreak',
  'linethickness',
  'lspace',
  'mathbackground',
  'mathcolor',
  'mathsize',
  'mathvariant',
  'maxsize',
  'minsize',
  'notation',
  'rowlines',
  'rowspacing',
  'rspace',
  'scriptlevel',
  'separator',
  'stretchy',
  'voffset',
])

/**
 * Diagrams are model output, which can quote untrusted text (a web page, an issue). pele escapes labels, and links and
 * images are off, so this is defense in depth against anything that could navigate, run script or fetch remote content:
 * the profiles t3code applies to pele's SVG (`MermaidDiagram.tsx`, MIT).
 * @param window - the page window DOMPurify binds to.
 */
export const createDiagramSanitizers = (window: Window & typeof globalThis): DiagramSanitizers => {
  const purifier = DOMPurify(window)
  return {
    plain: svg =>
      purifier.sanitize(svg, {
        FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'],
        FORBID_TAGS: ['a', 'image', 'foreignObject', 'style'],
        USE_PROFILES: { svg: true, svgFilters: true },
        RETURN_DOM_FRAGMENT: true,
      }),
    math: svg =>
      purifier.sanitize(svg, {
        // DOMPurify still accepts <math> only under an HTML parent and checks every MathML child's namespace.
        ADD_TAGS: ['foreignObject', ...KATEX_MATHML_TAGS],
        ADD_ATTR: (attribute, tagName) => KATEX_MATHML_TAGS.has(tagName) && KATEX_MATHML_ATTRIBUTES.has(attribute),
        HTML_INTEGRATION_POINTS: { foreignobject: true },
        FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'],
        FORBID_TAGS: ['a', 'img', 'image', 'script', 'style'],
        USE_PROFILES: { svg: true, svgFilters: true, html: true },
        RETURN_DOM_FRAGMENT: true,
      }),
  }
}
