/**
 * Roku SceneGraph UI tree parser and selector engine.
 *
 * Parses XML from ECP's /query/app-ui into a queryable tree.
 */

import { XMLParser } from 'fast-xml-parser';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface UiNode {
  tag: string;
  name?: string;
  attrs: Record<string, string>;
  children: UiNode[];
  parent?: UiNode;
}

/* ------------------------------------------------------------------ */
/*  XML → UiNode parsing                                              */
/* ------------------------------------------------------------------ */

const uiParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
});

const WRAPPER_NODES = new Set([
  'app-ui',
  'status',
  'error',
  'topscreen',
  'plugin',
  'screen',
]);

export function parseUiXml(xml: string): UiNode {
  const raw = uiParser.parse(xml);
  const root = convertOrdered(raw);
  if (!root) throw new Error('Failed to parse UI XML');
  return unwrap(root);
}

function convertOrdered(nodes: Record<string, unknown>[], parent?: UiNode): UiNode | undefined {
  for (const entry of nodes) {
    // Skip processing instructions and text nodes
    if ('?xml' in entry || '#text' in entry) continue;

    const tagName = Object.keys(entry).find((k) => k !== ':@');
    if (!tagName) continue;

    const attrs: Record<string, string> = {};
    const rawAttrs = entry[':@'] as Record<string, string> | undefined;
    if (rawAttrs) {
      for (const [key, value] of Object.entries(rawAttrs)) {
        attrs[key.replace(/^@_/, '')] = String(value);
      }
    }

    const node: UiNode = {
      tag: tagName,
      attrs,
      children: [],
      parent,
    };
    node.name = attrs.name ?? attrs.id;

    const childEntries = entry[tagName];
    if (Array.isArray(childEntries)) {
      for (const childEntry of childEntries) {
        if (typeof childEntry === 'object' && childEntry !== null && !('#text' in childEntry)) {
          const child = convertOrdered([childEntry], node);
          if (child) node.children.push(child);
        }
      }
    }

    return node;
  }
  return undefined;
}

function unwrap(node: UiNode): UiNode {
  if (WRAPPER_NODES.has(node.tag) && node.children.length > 0) {
    for (const child of node.children) {
      if (!WRAPPER_NODES.has(child.tag)) {
        return child;
      }
      const unwrapped = unwrap(child);
      if (unwrapped !== child) return unwrapped;
    }
    return unwrap(node.children[node.children.length - 1]);
  }
  return node;
}

/* ------------------------------------------------------------------ */
/*  Selector matching                                                 */
/* ------------------------------------------------------------------ */

/**
 * Find elements matching a CSS-like selector.
 *
 * Supported syntax:
 *   - Tag name:         `HomePage`
 *   - Tag#id:           `AppButton#actionBtn`
 *   - #id:              `#titleLabel`
 *   - Descendant:       `HomePage BannerWidget`
 *   - Child:            `LayoutGroup > AppLabel`
 *   - nth-child:        `AppButton:nth-child(1)`
 *   - Adjacent sibling: `ContentRow + ContentRow`
 *   - Attribute value:   `[focused="true"]`, `Tag[attr="value"]`
 *   - Attribute substr:  `[text*="Log"]`
 *   - Attribute starts:  `[text^="Episode"]`
 *   - Attribute ends:    `[uri$=".png"]`
 *   - Attribute exists:  `[visible]`
 *   - Combined:          `Tag#id[attr="value"]`
 *   - :has():            `AppButton:has(AppLabel[text="Log Out"])`
 *   - :not():            `AppButton:not([focused="true"])`
 *   - :first-child:      `AppButton:first-child`
 *   - :last-child:       `AppButton:last-child`
 *   - :only-child:       `AppButton:only-child`
 *   - :empty:            `LayoutGroup:empty`
 *   - :nth-child(An+B):  `:nth-child(odd)`, `:nth-child(even)`, `:nth-child(2n+1)`
 *   - General sibling:   `A ~ B` (all following siblings)
 *   - Comma groups:      `PosterCard, ThumbnailCard`
 *   - Universal:         `*`, `HomePage *:has(...)`
 */
export function findElements(root: UiNode, selector: string): UiNode[] {
  const groups = splitCommaGroups(selector);
  if (groups.length > 1) {
    const results: UiNode[] = [];
    for (const group of groups) {
      results.push(...matchParts(root, tokenizeSelector(group), 0, false));
    }
    return [...new Set(results)];
  }
  const parts = tokenizeSelector(selector);
  return matchParts(root, parts, 0, false);
}

export function findElement(
  root: UiNode,
  selector: string
): UiNode | undefined {
  return findElements(root, selector)[0];
}

export function findFocused(node: UiNode): UiNode | undefined {
  if (node.attrs.focused === 'true') {
    // Keep looking deeper — Roku marks the whole chain as focused
    for (const child of node.children) {
      const deeper = findFocused(child);
      if (deeper) return deeper;
    }
    // No focused child — this is the leaf
    return node;
  }
  for (const child of node.children) {
    const found = findFocused(child);
    if (found) return found;
  }
  return undefined;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute absolute screen position for a node by accumulating parent translations.
 *
 * Roku's bounds attribute is local to the parent container. This walks up
 * the parent chain adding each parent's translation unless inheritParentTransform
 * is "false".
 */
export function getRect(node: UiNode | undefined | null): Rect | undefined {
  if (!node) return undefined;
  const bounds = parseBounds(node.attrs.bounds);
  if (!bounds) return undefined;

  let { x, y } = bounds;
  let current = node.parent;
  while (current) {
    if (node.attrs.inheritParentTransform === 'false') break;
    const translation = parseTranslation(current.attrs.translation);
    if (translation) {
      x += translation.x;
      y += translation.y;
    }
    if (current.attrs.inheritParentTransform === 'false') break;
    current = current.parent;
  }

  return { x, y, width: bounds.width, height: bounds.height };
}

function parseBounds(value: string | undefined): { x: number; y: number; width: number; height: number } | undefined {
  if (!value) return undefined;
  const m = value.match(/\{?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}?/);
  if (!m) return undefined;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]), width: parseFloat(m[3]), height: parseFloat(m[4]) };
}

function parseTranslation(value: string | undefined): { x: number; y: number } | undefined {
  if (!value) return undefined;
  const m = value.match(/\[?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]?/);
  if (!m) return undefined;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/* ---- Tokenizer ---- */

interface SelectorToken {
  type: 'node' | 'child' | 'adjacent' | 'sibling';
  tag?: string;
  id?: string;
  nthChild?: number | 'odd' | 'even' | { a: number; b: number };
  firstChild?: boolean;
  lastChild?: boolean;
  onlyChild?: boolean;
  empty?: boolean;
  attrs?: { key: string; value?: string; op?: 'exact' | 'contains' | 'starts' | 'ends' }[];
  has?: SelectorToken[];
  not?: SelectorToken[];
}

function splitCommaGroups(selector: string): string[] {
  const groups: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of selector) {
    if (ch === '(') { depth++; current += ch; continue; }
    if (ch === ')') { depth--; current += ch; continue; }
    if (ch === ',' && depth === 0) {
      if (current.trim()) groups.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) groups.push(current.trim());
  return groups;
}

function splitSelector(selector: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inBrackets = false;
  let inQuotes = false;
  let parenDepth = 0;
  for (const ch of selector.trim()) {
    if (ch === '(' && !inQuotes) { parenDepth++; current += ch; continue; }
    if (ch === ')' && !inQuotes) { parenDepth--; current += ch; continue; }
    if (ch === '[' && !inQuotes && parenDepth === 0) { inBrackets = true; current += ch; continue; }
    if (ch === ']' && !inQuotes && parenDepth === 0) { inBrackets = false; current += ch; continue; }
    if ((ch === '"' || ch === "'") && (inBrackets || parenDepth > 0)) { inQuotes = !inQuotes; current += ch; continue; }
    if (/\s/.test(ch) && !inBrackets && parenDepth === 0) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function tokenizeSelector(selector: string): SelectorToken[] {
  const tokens: SelectorToken[] = [];
  const raw = splitSelector(selector);

  for (let i = 0; i < raw.length; i++) {
    const part = raw[i];

    if (part === '>') {
      tokens.push({ type: 'child' });
      continue;
    }
    if (part === '+') {
      tokens.push({ type: 'adjacent' });
      continue;
    }
    if (part === '~') {
      tokens.push({ type: 'sibling' });
      continue;
    }

    // Extract :has(...) and :not(...) pseudo-selectors
    let has: SelectorToken[] | undefined;
    let not: SelectorToken[] | undefined;
    let tokenBody = part;
    const hasMatch = tokenBody.match(/:has\((.+)\)$/);
    if (hasMatch) {
      has = tokenizeSelector(hasMatch[1]);
      tokenBody = tokenBody.slice(0, hasMatch.index!);
    }
    const notMatch = tokenBody.match(/:not\((.+)\)$/);
    if (notMatch) {
      not = tokenizeSelector(notMatch[1]);
      tokenBody = tokenBody.slice(0, notMatch.index!);
    }

    // Extract pseudo-class flags
    let firstChild: boolean | undefined;
    let lastChild: boolean | undefined;
    let onlyChild: boolean | undefined;
    let empty: boolean | undefined;
    if (tokenBody.includes(':first-child')) {
      firstChild = true;
      tokenBody = tokenBody.replace(':first-child', '');
    }
    if (tokenBody.includes(':last-child')) {
      lastChild = true;
      tokenBody = tokenBody.replace(':last-child', '');
    }
    if (tokenBody.includes(':only-child')) {
      onlyChild = true;
      tokenBody = tokenBody.replace(':only-child', '');
    }
    if (tokenBody.includes(':empty')) {
      empty = true;
      tokenBody = tokenBody.replace(':empty', '');
    }

    // Extract attribute selectors [key="value"], [key*="value"], [key^="value"], [key$="value"], or [key]
    const attrs: { key: string; value?: string; op?: 'exact' | 'contains' | 'starts' | 'ends' }[] = [];
    const attrRe = /\[([A-Za-z][A-Za-z0-9_-]*)(?:([*^$])?=(?:"([^"]*)"|'([^']*)'))?]/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(tokenBody)) !== null) {
      const opChar = attrMatch[2];
      const value = attrMatch[3] ?? attrMatch[4];
      const op = opChar === '*' ? 'contains' as const
        : opChar === '^' ? 'starts' as const
        : opChar === '$' ? 'ends' as const
        : value !== undefined ? 'exact' as const
        : undefined;
      attrs.push({ key: attrMatch[1], value, op });
    }
    const remainder = tokenBody.replace(attrRe, '');

    const match = remainder.match(
      /^(\*|[A-Za-z][A-Za-z0-9_]*)?(?:#([A-Za-z0-9_:\\-]+))?(?::nth-child\(([^)]+)\))?$/
    );
    if (!match) {
      tokens.push({ type: 'node', tag: remainder || undefined,
        ...(attrs.length ? { attrs } : {}), ...(has ? { has } : {}), ...(not ? { not } : {}),
        ...(firstChild ? { firstChild } : {}), ...(lastChild ? { lastChild } : {}),
        ...(onlyChild ? { onlyChild } : {}), ...(empty ? { empty } : {}),
      });
      continue;
    }

    const [, tag, id, nthRaw] = match;
    let nthChild: SelectorToken['nthChild'];
    if (nthRaw) {
      if (nthRaw === 'odd') nthChild = 'odd';
      else if (nthRaw === 'even') nthChild = 'even';
      else if (/^\d+$/.test(nthRaw)) nthChild = parseInt(nthRaw, 10);
      else {
        const anb = nthRaw.match(/^(\d*)n(?:\+(\d+))?$/);
        if (anb) nthChild = { a: anb[1] ? parseInt(anb[1], 10) : 1, b: anb[2] ? parseInt(anb[2], 10) : 0 };
      }
    }
    tokens.push({
      type: 'node',
      tag: tag === '*' ? undefined : tag,
      id: id?.replace(/\\\\/g, '\\'),
      ...(nthChild !== undefined ? { nthChild } : {}),
      ...(firstChild ? { firstChild } : {}),
      ...(lastChild ? { lastChild } : {}),
      ...(onlyChild ? { onlyChild } : {}),
      ...(empty ? { empty } : {}),
      ...(attrs.length ? { attrs } : {}),
      ...(has ? { has } : {}),
      ...(not ? { not } : {}),
    });
  }

  return tokens;
}

/* ---- Matching engine ---- */

function matchParts(
  node: UiNode,
  parts: SelectorToken[],
  partIndex: number,
  directChildOnly: boolean
): UiNode[] {
  if (partIndex >= parts.length) return [];

  const token = parts[partIndex];

  if (token.type === 'child') {
    return matchParts(node, parts, partIndex + 1, true);
  }
  if (token.type === 'adjacent') {
    return matchAdjacentSibling(node, parts, partIndex + 1);
  }
  if (token.type === 'sibling') {
    return matchGeneralSibling(node, parts, partIndex + 1);
  }

  const isLastPart = partIndex === parts.length - 1;
  const results: UiNode[] = [];

  if (matchesToken(node, token)) {
    if (isLastPart) {
      results.push(node);
    } else {
      const nextToken = parts[partIndex + 1];
      if (nextToken?.type === 'adjacent') {
        // Adjacent sibling: check immediate next sibling of this node
        if (node.parent) {
          const siblings = node.parent.children;
          const idx = siblings.indexOf(node);
          if (idx >= 0 && idx < siblings.length - 1) {
            const next = siblings[idx + 1];
            results.push(...matchParts(next, parts, partIndex + 2, false));
          }
        }
      } else if (nextToken?.type === 'sibling') {
        // General sibling: check all following siblings
        if (node.parent) {
          const siblings = node.parent.children;
          const idx = siblings.indexOf(node);
          for (let i = idx + 1; i < siblings.length; i++) {
            results.push(...matchParts(siblings[i], parts, partIndex + 2, false));
          }
        }
      } else {
        for (const child of node.children) {
          results.push(...matchParts(child, parts, partIndex + 1, false));
        }
      }
    }
  }

  if (!directChildOnly) {
    for (const child of node.children) {
      results.push(...matchParts(child, parts, partIndex, false));
    }
  }

  return [...new Set(results)];
}

function matchAdjacentSibling(
  contextNode: UiNode,
  parts: SelectorToken[],
  nextPartIndex: number
): UiNode[] {
  if (nextPartIndex >= parts.length) return [];
  const results: UiNode[] = [];

  const allNodes = collectAll(contextNode);
  for (const node of allNodes) {
    if (!node.parent) continue;
    const siblings = node.parent.children;
    const idx = siblings.indexOf(node);
    if (idx < 0 || idx >= siblings.length - 1) continue;
    const nextSibling = siblings[idx + 1];
    const token = parts[nextPartIndex];
    if (token.type === 'node' && matchesToken(nextSibling, token)) {
      if (nextPartIndex === parts.length - 1) {
        results.push(nextSibling);
      }
    }
  }
  return [...new Set(results)];
}

function matchGeneralSibling(
  contextNode: UiNode,
  parts: SelectorToken[],
  nextPartIndex: number,
): UiNode[] {
  if (nextPartIndex >= parts.length) return [];
  const results: UiNode[] = [];
  const token = parts[nextPartIndex];

  const allNodes = collectAll(contextNode);
  for (const node of allNodes) {
    if (!node.parent) continue;
    const siblings = node.parent.children;
    const idx = siblings.indexOf(node);
    if (idx < 0) continue;
    for (let i = idx + 1; i < siblings.length; i++) {
      if (token.type === 'node' && matchesToken(siblings[i], token)) {
        if (nextPartIndex === parts.length - 1) {
          results.push(siblings[i]);
        }
      }
    }
  }
  return [...new Set(results)];
}

function matchesToken(node: UiNode, token: SelectorToken): boolean {
  if (token.tag && node.tag !== token.tag) return false;
  if (token.id) {
    const nodeId = node.attrs.name ?? node.attrs.id;
    if (nodeId !== token.id) return false;
  }
  if (token.nthChild !== undefined) {
    if (!node.parent) return false;
    const siblings = node.parent.children.filter(
      (c) => !token.tag || c.tag === token.tag
    );
    const idx = siblings.indexOf(node);
    if (typeof token.nthChild === 'number') {
      if (idx !== token.nthChild - 1) return false;
    } else if (token.nthChild === 'odd') {
      if (idx % 2 !== 0) return false;  // 0-indexed: 0,2,4 = 1st,3rd,5th
    } else if (token.nthChild === 'even') {
      if (idx % 2 !== 1) return false;  // 0-indexed: 1,3,5 = 2nd,4th,6th
    } else {
      const { a, b } = token.nthChild;
      const pos = idx + 1;  // 1-indexed
      if (a === 0) {
        if (pos !== b) return false;
      } else {
        const n = (pos - b) / a;
        if (n < 0 || !Number.isInteger(n)) return false;
      }
    }
  }
  if (token.firstChild) {
    if (!node.parent) return false;
    if (node.parent.children[0] !== node) return false;
  }
  if (token.lastChild) {
    if (!node.parent) return false;
    if (node.parent.children[node.parent.children.length - 1] !== node) return false;
  }
  if (token.onlyChild) {
    if (!node.parent) return false;
    if (node.parent.children.length !== 1) return false;
  }
  if (token.empty) {
    if (node.children.length !== 0) return false;
  }
  if (token.attrs) {
    for (const attr of token.attrs) {
      if (attr.value !== undefined) {
        const actual = node.attrs[attr.key];
        if (actual === undefined) return false;
        if (attr.op === 'contains') {
          if (!actual.includes(attr.value)) return false;
        } else if (attr.op === 'starts') {
          if (!actual.startsWith(attr.value)) return false;
        } else if (attr.op === 'ends') {
          if (!actual.endsWith(attr.value)) return false;
        } else {
          if (actual !== attr.value) return false;
        }
      } else {
        if (!(attr.key in node.attrs)) return false;
      }
    }
  }
  if (token.has) {
    const hasTokens = token.has;
    const firstHasToken = hasTokens[0];
    let hasMatch = false;

    if (firstHasToken?.type === 'adjacent' && node.parent) {
      // :has(+ X) — check this node's next sibling
      const siblings = node.parent.children;
      const idx = siblings.indexOf(node);
      if (idx >= 0 && idx < siblings.length - 1) {
        hasMatch = matchParts(siblings[idx + 1], hasTokens, 1, false).length > 0;
      }
    } else if (firstHasToken?.type === 'sibling' && node.parent) {
      // :has(~ X) — check all following siblings
      const siblings = node.parent.children;
      const idx = siblings.indexOf(node);
      for (let i = idx + 1; i < siblings.length && !hasMatch; i++) {
        hasMatch = matchParts(siblings[i], hasTokens, 1, false).length > 0;
      }
    } else {
      // :has(selector) — check descendants
      const descendants = collectAll(node).slice(1);
      hasMatch = descendants.some(d => matchParts(d, hasTokens, 0, false).length > 0);
    }

    if (!hasMatch) return false;
  }
  if (token.not) {
    const notToken = token.not[0];
    if (notToken && matchesToken(node, notToken)) return false;
  }
  return true;
}

function collectAll(node: UiNode): UiNode[] {
  const result: UiNode[] = [node];
  for (const child of node.children) {
    result.push(...collectAll(child));
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Tree formatting (plain text)                                      */
/* ------------------------------------------------------------------ */

export interface FormatOptions {
  maxDepth?: number;
  attrs?: string[];
  allAttrs?: boolean;
}

const KEY_ATTRS = new Set([
  'focused',
  'text',
  'name',
  'visible',
  'opacity',
]);

export function formatTree(
  node: UiNode,
  options: FormatOptions = {},
  depth = 0
): string {
  const lines: string[] = [];
  printNode(node, options, depth, lines);
  return lines.join('\n');
}

function printNode(
  node: UiNode,
  options: FormatOptions,
  depth: number,
  lines: string[]
): void {
  if (options.maxDepth !== undefined && depth > options.maxDepth) return;

  const indent = '  '.repeat(depth);
  const attrFilter = options.attrs
    ? new Set(options.attrs)
    : options.allAttrs
      ? null
      : KEY_ATTRS;

  const attrParts: string[] = [];
  for (const [key, value] of Object.entries(node.attrs)) {
    if (attrFilter && !attrFilter.has(key)) continue;
    const truncated =
      key === 'text' && value.length > 80
        ? value.slice(0, 77) + '...'
        : value;
    attrParts.push(`${key}="${truncated}"`);
  }

  const attrStr = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';
  const childCount = node.children.length;
  const countStr = childCount > 0 ? ` (${childCount} children)` : '';

  lines.push(`${indent}${node.tag}${attrStr}${countStr}`);

  for (const child of node.children) {
    printNode(child, options, depth + 1, lines);
  }
}
