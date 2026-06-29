import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { randomBytes } from "node:crypto";
import { extname, join } from "node:path";
import { mkdir } from "node:fs/promises";

import {
  createSession,
  sessionByDm,
  sessionByPlayer,
  getDoc,
  setDocBody,
  sharedKeySet,
  setSharedKeys,
  toggleSharedKey,
  listMaps,
  getMap,
  createMap,
  setMapShared,
  setMapRevealed,
  deleteMap,
  revealedSet,
  type Session,
} from "./db.ts";
import { subscribe, broadcast, patchElements } from "./realtime.ts";
import { parseDoc, allKeys, renderDmOutline, renderPlayerDoc } from "./notesdoc.ts";
import {
  HomePage,
  DmDashboard,
  CampaignEditorPage,
  DmMapPage,
  PlayerDashboard,
  PlayerNotesPage,
  PlayerMapPage,
  FogOverlay,
  NotFound,
} from "./views.tsx";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";
await mkdir(UPLOAD_DIR, { recursive: true });

const app = new Hono();

// deno-lint-ignore no-explicit-any
const page = (c: any, node: any) => c.html("<!DOCTYPE html>" + node.toString());

const origin = (c: { req: { url: string } }) => new URL(c.req.url).origin;

// --- Static assets ---
app.use("/app.css", serveStatic({ path: "./public/app.css" }));
app.use("/vendor/*", serveStatic({ root: "./public" }));
app.use("/uploads/*", serveStatic({ root: "./" }));

// --- Home / session creation ---
app.get("/", (c) => page(c, HomePage({})));

app.post("/sessions", async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim() || "Untitled session";
  const s = createSession(name);
  return c.redirect(`/dm/${s.dm_token}`);
});

// ---------- DM routes ----------
function dmOr404(c: { req: { param: (k: string) => string } }): Session | null {
  return sessionByDm(c.req.param("t"));
}

app.get("/dm/:t", (c) => {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  return page(
    c,
    DmDashboard({
      origin: origin(c),
      session: s,
      maps: listMaps(s.id),
    }),
  );
});

// DM live event stream
app.get("/dm/:t/events", (c) => sseStream(c, dmOr404(c)));

// Campaign document
app.get("/dm/:t/notes", (c) => {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  const doc = getDoc(s.id);
  const outline = renderDmOutline(parseDoc(doc.body_md), sharedKeySet(doc), `/dm/${s.dm_token}`);
  return page(c, CampaignEditorPage({ session: s, bodyMd: doc.body_md, outlineHtml: outline }));
});

app.post("/dm/:t/notes", async (c) => {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  const body = await c.req.parseBody();
  const md = String(body.body_md ?? "");
  setDocBody(s.id, md);
  // Drop shared keys for headings that no longer exist.
  const parsed = parseDoc(md);
  const exist = allKeys(parsed.sections);
  const pruned = new Set([...sharedKeySet(getDoc(s.id))].filter((k) => exist.has(k)));
  setSharedKeys(s.id, pruned);
  broadcastPlayerDoc(s);
  return c.redirect(`/dm/${s.dm_token}/notes`);
});

app.post("/dm/:t/notes/share", (c) => {
  const s = dmOr404(c);
  if (!s) return c.text("not found", 404);
  const key = c.req.query("key");
  if (!key) return c.text("missing key", 400);
  toggleSharedKey(s.id, key);
  // Update players live, and return the refreshed DM outline to the DM client.
  broadcastPlayerDoc(s);
  const doc = getDoc(s.id);
  const outline = renderDmOutline(parseDoc(doc.body_md), sharedKeySet(doc), `/dm/${s.dm_token}`);
  return new Response(patchElements(outline), {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
});

// Maps
app.post("/dm/:t/maps", async (c) => {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  const body = await c.req.parseBody();
  const file = body.image;
  if (!(file instanceof File)) return c.text("Image required", 400);
  const cols = clampInt(body.cols, 1, 100, 20);
  const rows = clampInt(body.rows, 1, 100, 15);
  const title = String(body.title ?? "Untitled map").trim() || "Untitled map";

  const ext = (extname(file.name) || ".png").toLowerCase();
  const filename = `${randomBytes(12).toString("hex")}${ext}`;
  await Bun.write(join(UPLOAD_DIR, filename), file);

  createMap(s.id, title, filename, cols, rows);
  return c.redirect(`/dm/${s.dm_token}`);
});

app.get("/dm/:t/maps/:id", (c) => {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  const map = getMap(s.id, Number(c.req.param("id")));
  if (!map) return page(c, NotFound({}));
  return page(c, DmMapPage({ session: s, map }));
});

// Reveal: JSON { cells: number[], action: "toggle"|"reveal"|"hide" }
app.post("/dm/:t/maps/:id/reveal", async (c) => {
  const s = dmOr404(c);
  if (!s) return c.text("not found", 404);
  const id = Number(c.req.param("id"));
  const map = getMap(s.id, id);
  if (!map) return c.text("not found", 404);

  const { cells, action } = await c.req.json<{ cells: number[]; action: string }>();
  const set = revealedSet(map);
  const total = map.cols * map.rows;
  for (const raw of cells ?? []) {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i >= total) continue;
    if (action === "hide") set.delete(i);
    else if (action === "reveal") set.add(i);
    else set.has(i) ? set.delete(i) : set.add(i);
  }
  setMapRevealed(s.id, id, set);
  broadcastFog(s, id);
  return c.body(null, 204);
});

app.post("/dm/:t/maps/:id/reveal-all", (c) => bulkReveal(c, true));
app.post("/dm/:t/maps/:id/hide-all", (c) => bulkReveal(c, false));

function bulkReveal(c: any, reveal: boolean) {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  const id = Number(c.req.param("id"));
  const map = getMap(s.id, id);
  if (!map) return page(c, NotFound({}));
  const set = new Set<number>();
  if (reveal) for (let i = 0; i < map.cols * map.rows; i++) set.add(i);
  setMapRevealed(s.id, id, set);
  broadcastFog(s, id);
  return c.redirect(`/dm/${s.dm_token}/maps/${id}`);
}

app.post("/dm/:t/maps/:id/share", async (c) => {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  const id = Number(c.req.param("id"));
  const body = await c.req.parseBody();
  setMapShared(s.id, id, body.shared === "1" ? 1 : 0);
  broadcastMapsList(s);
  return c.redirect(`/dm/${s.dm_token}/maps/${id}`);
});

app.post("/dm/:t/maps/:id/delete", (c) => {
  const s = dmOr404(c);
  if (!s) return page(c, NotFound({}));
  deleteMap(s.id, Number(c.req.param("id")));
  broadcastMapsList(s);
  return c.redirect(`/dm/${s.dm_token}`);
});

// ---------- Player routes ----------
function playerOr404(c: { req: { param: (k: string) => string } }): Session | null {
  return sessionByPlayer(c.req.param("t"));
}

app.get("/play/:t", (c) => {
  const s = playerOr404(c);
  if (!s) return page(c, NotFound({}));
  return page(c, PlayerDashboard({ session: s, maps: listMaps(s.id, true) }));
});

app.get("/play/:t/events", (c) => sseStream(c, playerOr404(c)));

app.get("/play/:t/notes", (c) => {
  const s = playerOr404(c);
  if (!s) return page(c, NotFound({}));
  return page(c, PlayerNotesPage({ session: s, docHtml: playerDocHtml(s) }));
});

app.get("/play/:t/maps/:id", (c) => {
  const s = playerOr404(c);
  if (!s) return page(c, NotFound({}));
  const map = getMap(s.id, Number(c.req.param("id")));
  if (!map || !map.shared) return page(c, NotFound({}));
  return page(c, PlayerMapPage({ session: s, map }));
});

// ---------- Shared helpers ----------
function sseStream(c: any, s: Session | null) {
  if (!s) return c.text("not found", 404);
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          /* closed */
        }
      };
      send(": connected\n\n");
      const unsub = subscribe(s.id, send);
      const ping = setInterval(() => send(": ping\n\n"), 25000);
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function broadcastFog(s: Session, mapId: number) {
  const map = getMap(s.id, mapId);
  if (!map) return;
  broadcast(s.id, patchElements(FogOverlay({ map }).toString()));
}

function playerDocHtml(s: Session) {
  const doc = getDoc(s.id);
  return renderPlayerDoc(parseDoc(doc.body_md), sharedKeySet(doc));
}

function broadcastPlayerDoc(s: Session) {
  // Players viewing the campaign notes get the refreshed #player-doc fragment.
  broadcast(s.id, patchElements(playerDocHtml(s)));
}

function broadcastMapsList(s: Session) {
  const maps = listMaps(s.id, true);
  const html = renderPlayerMapsList(s, maps);
  broadcast(s.id, patchElements(html));
}

function renderPlayerMapsList(s: Session, maps: ReturnType<typeof listMaps>) {
  const base = `/play/${s.player_token}`;
  const items = maps.length
    ? maps
        .map(
          (m) =>
            `<li class="p-3"><a href="${base}/maps/${m.id}" class="text-sky-300 hover:underline">${esc(m.title)}</a></li>`,
        )
        .join("")
    : `<li class="p-3 text-slate-500 text-sm">Nothing shared yet.</li>`;
  return `<ul id="player-maps" class="divide-y divide-slate-800 rounded border border-slate-800">${items}</ul>`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!;
  });
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

export default { port, hostname, fetch: app.fetch, idleTimeout: 0 };

console.log(`D&D session tool listening on http://${hostname}:${port}`);
