import { parse, HTMLElement, NodeType } from "node-html-parser";

// The campaign document is stored as HTML (edited in a contenteditable surface).
// Headings (<h1>..<h6>) are flat siblings; a heading "owns" the sibling nodes
// that follow it until the next heading, and nests headings of greater level.

const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

export type Section = {
  level: number;
  title: string;
  key: string;
  headingHtml: string;
  contentHtml: string;
  children: Section[];
};

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

type Flat = {
  level: number;
  title: string;
  key: string;
  headingHtml: string;
  content: string[];
};

function parseFlat(html: string): Flat[] {
  const root = parse(html ?? "", { lowerCaseTagName: false });
  const flat: Flat[] = [];
  const seen = new Map<string, number>();
  let current: Flat | null = null;

  for (const node of root.childNodes) {
    const el = node.nodeType === NodeType.ELEMENT_NODE ? (node as HTMLElement) : null;
    if (el && HEADINGS.has(el.tagName)) {
      const title = el.text.trim();
      const baseSlug = slugify(title);
      const n = (seen.get(baseSlug) ?? 0) + 1;
      seen.set(baseSlug, n);
      current = {
        level: Number(el.tagName[1]),
        title,
        key: n === 1 ? baseSlug : `${baseSlug}-${n}`,
        headingHtml: el.toString(),
        content: [],
      };
      flat.push(current);
    } else if (current) {
      current.content.push(node.toString());
    }
    // text/nodes before the first heading are preamble — never shared, dropped here.
  }
  return flat;
}

export function parseDoc(html: string): Section[] {
  const flat = parseFlat(html);
  const roots: Section[] = [];
  const stack: Section[] = [];
  for (const f of flat) {
    const node: Section = {
      level: f.level,
      title: f.title,
      key: f.key,
      headingHtml: f.headingHtml,
      contentHtml: f.content.join(""),
      children: [],
    };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

export function allKeys(sections: Section[], out = new Set<string>()): Set<string> {
  for (const s of sections) {
    out.add(s.key);
    allKeys(s.children, out);
  }
  return out;
}

// ---------- Player view: only shared subtrees ----------
export function renderPlayerDoc(html: string, shared: Set<string>): string {
  const inner = playerNodes(parseDoc(html), shared, false);
  const body = inner || `<p class="text-slate-500 text-sm">Your DM hasn't shared any notes yet.</p>`;
  return `<div id="player-doc" class="note-doc">${body}</div>`;
}

function playerNodes(nodes: Section[], shared: Set<string>, inherited: boolean): string {
  let out = "";
  for (const s of nodes) {
    const eff = inherited || shared.has(s.key);
    if (eff) out += renderFull(s);
    else out += playerNodes(s.children, shared, false); // skip heading, descend
  }
  return out;
}

function renderFull(s: Section): string {
  return s.headingHtml + s.contentHtml + s.children.map(renderFull).join("");
}

// ---------- Sanitize editor HTML before persisting ----------
const ALLOWED_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6",
  "P", "BR", "UL", "OL", "LI", "STRONG", "EM", "B", "I", "U",
  "A", "CODE", "PRE", "BLOCKQUOTE",
]);

export function sanitizeDocHtml(html: string): string {
  const root = parse(html ?? "", { lowerCaseTagName: false });

  for (const el of root.querySelectorAll("script,style")) el.remove();

  // Walk a snapshot, since we mutate the tree (unwrap) as we go.
  for (const el of root.querySelectorAll("*")) {
    const tag = el.tagName?.toUpperCase();
    if (!tag) continue;
    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap disallowed element: replace it with its inner HTML.
      el.replaceWith(...el.childNodes);
      continue;
    }
    // Strip every attribute except a safe href on links.
    for (const name of Object.keys(el.attributes)) {
      if (tag === "A" && name.toLowerCase() === "href") {
        const href = el.getAttribute("href") ?? "";
        if (/^\s*javascript:/i.test(href)) el.removeAttribute("href");
      } else {
        el.removeAttribute(name);
      }
    }
  }
  return root.toString();
}
