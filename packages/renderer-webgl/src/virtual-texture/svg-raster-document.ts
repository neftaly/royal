import type { ParsedSvgTextureSource } from "../texture/svg-source";

/** Freeze viewport lengths without rewriting quoted strings or fragment IDs. */
export const freezeSvgViewportUnits = (text: string, width: number, height: number): string =>
  text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|(?<![\w#.-])([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(vw|vh|vmin|vmax)\b/giu,
    (match, amount: string | undefined, unit: string | undefined) => {
      if (amount === undefined || unit === undefined) return match;
      const axis = unit.toLowerCase();
      const size = axis === "vw" ? width : axis === "vh" ? height
        : axis === "vmin" ? Math.min(width, height) : Math.max(width, height);
      return `${Number(amount) * size / 100}px`;
    });

const selectors = (text: string): string[] => {
  const result: string[] = [];
  let depth = 0, start = 0, quote = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\\") { index++; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) { result.push(text.slice(start, index)); start = index + 1; }
  }
  result.push(text.slice(start));
  return result;
};

const lengthAttributes = new Set([
  "style", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height",
  "dx", "dy", "refx", "refy", "markerwidth", "markerheight", "stroke-width", "stroke-dasharray",
  "stroke-dashoffset", "font-size", "letter-spacing", "word-spacing", "kerning", "baseline-shift",
  "startoffset", "textlength", "transform-origin",
]);

const prepared = new WeakMap<ParsedSvgTextureSource, SVGSVGElement>();
const unchanged = new WeakSet<ParsedSvgTextureSource>();

/** Snapshot selector matches before inserting an immutable SVG into a crop root. */
export const svgRasterArtwork = (source: ParsedSvgTextureSource, width: number, height: number): SVGSVGElement => {
  if (unchanged.has(source)) return source.document.documentElement.cloneNode(true) as SVGSVGElement;
  const retained = prepared.get(source);
  if (retained !== undefined) return retained.cloneNode(true) as SVGSVGElement;
  const original = source.document.documentElement;
  const root = original.cloneNode(true) as SVGSVGElement;
  const originals = [original, ...Array.from(original.querySelectorAll?.("*") ?? [])];
  const clones = [root, ...Array.from(root.querySelectorAll?.("*") ?? [])];
  let marker = "data-royal-svg-match";
  while (originals.some(element => element.hasAttribute?.(marker))) marker += "-x";
  let ruleIndex = 0;
  let changed = false;
  const rewrite = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if ("selectorText" in rule) {
        const style = rule as CSSStyleRule;
        const frozen: string[] = [];
        for (const selector of selectors(style.selectorText)) {
          const token = String(ruleIndex++);
          const matches = new Set(source.document.querySelectorAll(selector));
          originals.forEach((element, index) => {
            if (!matches.has(element)) return;
            const clone = clones[index]!;
            clone.setAttribute(marker, `${clone.getAttribute(marker) ?? ""} ${token}`.trim());
          });
          // The impossible original branch retains specificity; :where adds none.
          frozen.push(`:is(${selector}:not(*), :where([${marker}~="${token}"]))`);
        }
        style.selectorText = frozen.join(",");
      }
      if ("cssRules" in rule) rewrite((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const element of clones) {
    for (const attribute of Array.from(element.attributes ?? [])) {
      if (!lengthAttributes.has(attribute.name.toLowerCase())) continue;
      const value = freezeSvgViewportUnits(attribute.value, width, height);
      if (value !== attribute.value) { element.setAttribute(attribute.name, value); changed = true; }
    }
    if (element.localName === "style") {
      changed = true;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(freezeSvgViewportUnits(element.textContent ?? "", width, height));
      rewrite(sheet.cssRules);
      element.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join("\n");
    }
  }
  if (!changed) { unchanged.add(source); return root; }
  prepared.set(source, root);
  return root.cloneNode(true) as SVGSVGElement;
};
