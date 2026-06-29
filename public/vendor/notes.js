// Inline campaign-notes behavior for both the DM editor (#doc, contenteditable)
// and the player view (#player-doc, read-only). Adds a "#" collapse handle to
// every heading, and on the DM side a share checkbox; autosaves the document.

function slugify(title) {
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

const isHeading = (el) => el && /^H[1-6]$/.test(el.tagName);
const levelOf = (el) => Number(el.tagName[1]);

// Heading text excluding any injected chrome.
function headingTitle(h) {
  const clone = h.cloneNode(true);
  clone.querySelectorAll("[data-chrome]").forEach((n) => n.remove());
  return clone.textContent.trim();
}

// Content + nested headings that belong to a heading: following siblings up to
// the next heading of the same or higher level.
function ownedSiblings(h) {
  const lvl = levelOf(h);
  const out = [];
  let n = h.nextElementSibling;
  while (n) {
    if (isHeading(n) && levelOf(n) <= lvl) break;
    out.push(n);
    n = n.nextElementSibling;
  }
  return out;
}

function toggleCollapse(h) {
  const collapsed = h.classList.toggle("collapsed");
  for (const el of ownedSiblings(h)) el.style.display = collapsed ? "none" : "";
}

function setupDoc(container, editable, saveUrl, shareUrl) {
  const shared = new Set(
    editable ? JSON.parse(container.dataset.sharedKeys || "[]") : [],
  );

  // Recompute checkbox checked/disabled from the shared set + inheritance.
  function refreshShareStates(headings, keys) {
    const stack = [];
    headings.forEach((h, i) => {
      const lvl = levelOf(h);
      while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
      const ancestorShared = stack.some((a) => shared.has(a.key));
      const direct = shared.has(keys[i]);
      const cb = h.querySelector("[data-chrome] input[type=checkbox]");
      if (cb) {
        cb.checked = direct || ancestorShared;
        cb.disabled = ancestorShared; // controlled by a shared parent
      }
      stack.push({ lvl, key: keys[i] });
    });
  }

  function decorate() {
    const headings = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    const seen = new Map();
    const keys = headings.map((h) => {
      const base = slugify(headingTitle(h));
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : `${base}-${n}`;
    });

    headings.forEach((h, i) => {
      if (h.querySelector(":scope > [data-chrome]")) return; // already decorated
      const chrome = document.createElement("span");
      chrome.dataset.chrome = "1";
      chrome.contentEditable = "false";
      chrome.className = "note-chrome";

      const hash = document.createElement("button");
      hash.type = "button";
      hash.className = "note-hash";
      hash.textContent = "#".repeat(levelOf(h));
      hash.title = "Collapse / expand";
      hash.addEventListener("click", (e) => {
        e.preventDefault();
        toggleCollapse(h);
      });
      chrome.appendChild(hash);

      if (editable) {
        const key = keys[i];
        const label = document.createElement("label");
        label.className = "note-share";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.addEventListener("change", () => onShare(key, cb));
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" share"));
        chrome.appendChild(label);
      }

      h.insertBefore(chrome, h.firstChild);
    });

    if (editable) refreshShareStates(headings, keys);
  }

  function serialize() {
    const clone = container.cloneNode(true);
    clone.querySelectorAll("[data-chrome]").forEach((n) => n.remove());
    clone.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
    clone.querySelectorAll(".collapsed").forEach((n) => n.classList.remove("collapsed"));
    return clone.innerHTML;
  }

  function save() {
    return fetch(saveUrl, {
      method: "POST",
      headers: { "content-type": "text/html" },
      body: serialize(),
    });
  }

  function onShare(key, cb) {
    // Persist the current text first so the heading/key exists server-side.
    save()
      .then(() =>
        fetch(`${shareUrl}?key=${encodeURIComponent(key)}`, { method: "POST" }),
      )
      .then(() => {
        if (cb.checked) shared.add(key);
        else shared.delete(key);
        const headings = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")];
        const seen = new Map();
        const keys = headings.map((h) => {
          const b = slugify(headingTitle(h));
          const n = (seen.get(b) ?? 0) + 1;
          seen.set(b, n);
          return n === 1 ? b : `${b}-${n}`;
        });
        refreshShareStates(headings, keys);
      });
  }

  if (editable) {
    let timer;
    container.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => save().then(decorate), 700);
    });
    container.addEventListener("beforeinput", (e) => onBeforeInput(e, container, decorate));
    container.addEventListener("keydown", (e) => onEnter(e, container));
    wireToolbar(container);
  } else {
    // Player view is replaced wholesale on each SSE update — redecorate then.
    const obs = new MutationObserver(() => decorate());
    obs.observe(container, { childList: true, subtree: true });
  }

  decorate();
}

// The top-level block element of #doc that contains the given node.
function blockOf(container, node) {
  let el = node && node.nodeType === 3 ? node.parentNode : node;
  while (el && el !== container && el.parentNode !== container) el = el.parentNode;
  return el && el !== container ? el : null;
}

// Markdown-style heading shortcut: typing "#"…"######" + space at the start of a
// block converts it to the matching heading.
function onBeforeInput(e, container, decorate) {
  if (e.inputType !== "insertText" || e.data !== " ") return;
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
  const block = blockOf(container, sel.focusNode);
  if (!block || /^H[1-6]$/.test(block.tagName)) return;

  // Text from the block's start up to the caret.
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setEnd(sel.focusNode, sel.focusOffset);
  const before = r.toString();
  const m = before.match(/^(#{1,6})$/);
  if (!m) return;

  e.preventDefault();
  const level = m[1].length;

  // Strip the leading hashes from the block's first text node.
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) first.data = first.data.replace(/^#{1,6}/, "");

  const h = document.createElement("h" + level);
  while (block.firstChild) h.appendChild(block.firstChild);
  block.replaceWith(h);

  const caret = document.createRange();
  caret.setStart(h, 0);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);

  decorate();
  container.dispatchEvent(new Event("input", { bubbles: true })); // trigger autosave
}

// Pressing Enter in a heading starts a fresh paragraph below it (Notion-style),
// so the next line is normal text — and a new "#" shortcut works there.
function onEnter(e, container) {
  if (e.key !== "Enter" || e.shiftKey) return;
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return;
  const block = blockOf(container, sel.focusNode);
  if (!block || !/^H[1-6]$/.test(block.tagName)) return;
  e.preventDefault();
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  block.after(p);
  const r = document.createRange();
  r.setStart(p, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  container.dispatchEvent(new Event("input", { bubbles: true }));
}

// Minimal formatting toolbar using execCommand (sufficient in Chromium).
function wireToolbar(doc) {
  for (const btn of document.querySelectorAll(".note-tool")) {
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep selection
    btn.addEventListener("click", () => {
      doc.focus();
      const cmd = btn.dataset.cmd;
      if (cmd === "bold") document.execCommand("bold");
      else if (cmd === "ul") document.execCommand("insertUnorderedList");
      else if (cmd === "p") document.execCommand("formatBlock", false, "P");
      else document.execCommand("formatBlock", false, cmd.toUpperCase()); // h1/h2/h3
    });
  }
}

const dmDoc = document.getElementById("doc");
const playerDoc = document.getElementById("player-doc");
if (dmDoc) setupDoc(dmDoc, true, dmDoc.dataset.saveUrl, dmDoc.dataset.shareUrl);
if (playerDoc) setupDoc(playerDoc, false);
