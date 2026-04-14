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
 *   - Tag name:        `HomePage`
 *   - Tag#id:          `AppButton#actionBtn`
 *   - #id:             `#titleLabel`
 *   - Descendant:      `HomePage HomeHeroCarousel`
 *   - Child:           `LayoutGroup > AppLabel`
 *   - nth-child:       `AppButton:nth-child(1)`
 *   - Adjacent sibling: `CollectionModule + CollectionModule`
 */
export function findElements(root: UiNode, selector: string): UiNode[] {
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
  if (node.attrs.focused === 'true') return node;
  for (const child of node.children) {
    const found = findFocused(child);
    if (found) return found;
  }
  return undefined;
}

/* ---- Tokenizer ---- */

interface SelectorToken {
  type: 'node' | 'child' | 'adjacent';
  tag?: string;
  id?: string;
  nthChild?: number;
  attrs?: { key: string; value?: string }[];
}

function splitSelector(selector: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inBrackets = false;
  let inQuotes = false;
  for (const ch of selector.trim()) {
    if (ch === '[' && !inQuotes) { inBrackets = true; current += ch; continue; }
    if (ch === ']' && !inQuotes) { inBrackets = false; current += ch; continue; }
    if (ch === '"' && inBrackets) { inQuotes = !inQuotes; current += ch; continue; }
    if (/\s/.test(ch) && !inBrackets) {
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

    // Extract attribute selectors [key="value"] or [key] from the token
    const attrs: { key: string; value?: string }[] = [];
    const attrRe = /\[([A-Za-z][A-Za-z0-9_-]*)(?:="([^"]*)")?\]/g;
    let attrMatch: RegExpExecArray | null;
    let remainder = part;
    while ((attrMatch = attrRe.exec(part)) !== null) {
      attrs.push({ key: attrMatch[1], value: attrMatch[2] });
    }
    remainder = part.replace(attrRe, '');

    const match = remainder.match(
      /^(\*|[A-Za-z][A-Za-z0-9_]*)?(?:#([A-Za-z0-9_:\\-]+))?(?::nth-child\((\d+)\))?$/
    );
    if (!match) {
      tokens.push({ type: 'node', tag: remainder || undefined, ...(attrs.length ? { attrs } : {}) });
      continue;
    }

    const [, tag, id, nth] = match;
    tokens.push({
      type: 'node',
      tag: tag === '*' ? undefined : tag,
      id: id?.replace(/\\\\/g, '\\'),
      nthChild: nth ? parseInt(nth, 10) : undefined,
      ...(attrs.length ? { attrs } : {}),
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

  const isLastPart = partIndex === parts.length - 1;
  const results: UiNode[] = [];

  if (matchesToken(node, token)) {
    if (isLastPart) {
      results.push(node);
    } else {
      for (const child of node.children) {
        results.push(...matchParts(child, parts, partIndex + 1, false));
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
    if (idx !== token.nthChild - 1) return false;
  }
  if (token.attrs) {
    for (const attr of token.attrs) {
      if (attr.value !== undefined) {
        if (node.attrs[attr.key] !== attr.value) return false;
      } else {
        if (!(attr.key in node.attrs)) return false;
      }
    }
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
