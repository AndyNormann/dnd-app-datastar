import { renderMarkdown } from "./markdown.ts";

// A heading and the content directly beneath it (up to its first sub-heading),
// plus nested sub-headings as children.
export type Section = {
  level: number;
  title: string;
  key: string;
  bodyMd: string;
  children: Section[];
};

export type ParsedDoc = {
  preambleMd: string; // content before the first heading
  sections: Section[]; // top-level heading tree
};

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

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

// Parse markdown into a tree of heading sections. Headings inside fenced code
// blocks are ignored. Keys are slugs disambiguated by document order so the
// share toggle and both render passes always agree.
export function parseDoc(md: string): ParsedDoc {
  const lines = (md ?? "").split("\n");
  const seen = new Map<string, number>();

  type Flat = { level: number; title: string; key: string; body: string[] };
  const flat: Flat[] = [];
  const preamble: string[] = [];
  let current: Flat | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : line.match(HEADING_RE);
    if (m) {
      const title = m[2];
      const base = slugify(title);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const key = n === 1 ? base : `${base}-${n}`;
      current = { level: m[1].length, title, key, body: [] };
      flat.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }

  // Build the tree from the flat heading list using a level stack.
  const roots: Section[] = [];
  const stack: Section[] = [];
  for (const f of flat) {
    const node: Section = {
      level: f.level,
      title: f.title,
      key: f.key,
      bodyMd: f.body.join("\n").trim(),
      children: [],
    };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return { preambleMd: preamble.join("\n").trim(), sections: roots };
}

// All heading keys present in the document (used to prune stale shared keys).
export function allKeys(sections: Section[], out = new Set<string>()): Set<string> {
  for (const s of sections) {
    out.add(s.key);
    allKeys(s.children, out);
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// ---------- DM outline (editable, with share toggles) ----------
export function renderDmOutline(
  doc: ParsedDoc,
  shared: Set<string>,
  base: string,
): string {
  const preamble = doc.preambleMd
    ? `<div class="note-body">${renderMarkdown(doc.preambleMd)}</div>`
    : "";
  const body = doc.sections.length
    ? doc.sections.map((s) => dmSection(s, shared, base, false)).join("")
    : `<p class="text-slate-500 text-sm">No headings yet — add some <code>#</code> headings and Save.</p>`;
  return `<div id="dm-outline">${preamble}${body}</div>`;
}

function dmSection(s: Section, shared: Set<string>, base: string, inherited: boolean): string {
  const direct = shared.has(s.key);
  const eff = inherited || direct;
  const badge = direct
    ? `<span class="ml-2 rounded bg-emerald-700/70 px-2 py-0.5 text-xs text-emerald-100">Shared</span>`
    : inherited
      ? `<span class="ml-2 rounded bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-300">via parent</span>`
      : `<span class="ml-2 rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300">DM only</span>`;
  const btnLabel = direct ? "Unshare" : "Share";
  const shareBtn = `<button type="button" class="rounded bg-sky-700 px-2 py-0.5 text-xs hover:bg-sky-600" data-on-click="@post('${base}/notes/share?key=${encodeURIComponent(s.key)}')">${btnLabel}</button>`;
  const bodyHtml = s.bodyMd ? `<div class="note-body">${renderMarkdown(s.bodyMd)}</div>` : "";
  const children = s.children.map((c) => dmSection(c, shared, base, eff)).join("");
  return `
    <details open class="note-section">
      <summary class="note-summary"><span class="note-title">${esc(s.title)}</span>${badge}</summary>
      <div class="note-controls">${shareBtn}</div>
      ${bodyHtml}
      ${children}
    </details>`;
}

// ---------- Player outline (only shared subtrees) ----------
export function renderPlayerDoc(doc: ParsedDoc, shared: Set<string>): string {
  const html = playerNodes(doc.sections, shared, false);
  const inner = html
    ? html
    : `<p class="text-slate-500 text-sm">Your DM hasn't shared any notes yet.</p>`;
  return `<div id="player-doc" class="note-doc">${inner}</div>`;
}

function playerNodes(nodes: Section[], shared: Set<string>, inherited: boolean): string {
  let out = "";
  for (const s of nodes) {
    const eff = inherited || shared.has(s.key);
    if (eff) out += playerSectionFull(s);
    else out += playerNodes(s.children, shared, false); // skip heading, descend
  }
  return out;
}

function playerSectionFull(s: Section): string {
  const bodyHtml = s.bodyMd ? `<div class="note-body">${renderMarkdown(s.bodyMd)}</div>` : "";
  const children = s.children.map(playerSectionFull).join("");
  return `
    <details open class="note-section">
      <summary class="note-summary"><span class="note-title">${esc(s.title)}</span></summary>
      ${bodyHtml}
      ${children}
    </details>`;
}
