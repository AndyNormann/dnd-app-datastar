import type { FC } from "hono/jsx";
import type { Session, Note, MapRow } from "./db.ts";
import { revealedSet } from "./db.ts";
import { renderMarkdown } from "./markdown.ts";

const DATASTAR = "/vendor/datastar.js";

type ViewKind = "dm" | "play" | "plain";

export const Layout: FC<{ title: string; view: ViewKind; sseUrl?: string }> = ({
  title,
  view,
  sseUrl,
  children,
}) => (
  <html lang="en" class="h-full bg-slate-900 text-slate-100">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/app.css" />
      <script type="module" src={DATASTAR} />
    </head>
    <body
      class={`h-full min-h-full ${view}-view`}
      data-on-load={sseUrl ? `@get('${sseUrl}')` : undefined}
    >
      <div class="mx-auto max-w-5xl p-4 sm:p-6">{children}</div>
    </body>
  </html>
);

export const HomePage: FC = () => (
  <Layout title="D&D Session Tool" view="plain">
    <h1 class="text-3xl font-bold mb-2">D&D Session Tool</h1>
    <p class="text-slate-400 mb-6">
      Create a session to keep notes and maps, then share live with your players.
    </p>
    <form method="post" action="/sessions" class="flex gap-2">
      <input
        name="name"
        required
        placeholder="Session name (e.g. The Sunless Citadel)"
        class="flex-1 rounded bg-slate-800 px-3 py-2 outline-none focus:ring-2 ring-sky-500"
      />
      <button class="rounded bg-sky-600 px-4 py-2 font-medium hover:bg-sky-500">
        Create
      </button>
    </form>
  </Layout>
);

const ShareLinks: FC<{ origin: string; session: Session }> = ({ origin, session }) => (
  <div class="mb-6 grid gap-3 sm:grid-cols-2">
    <div class="rounded border border-slate-700 bg-slate-800 p-3">
      <div class="text-xs uppercase tracking-wide text-amber-400 mb-1">DM link (keep secret)</div>
      <code class="block break-all text-sm text-slate-300">
        {origin}/dm/{session.dm_token}
      </code>
    </div>
    <div class="rounded border border-slate-700 bg-slate-800 p-3">
      <div class="text-xs uppercase tracking-wide text-emerald-400 mb-1">Player link (share)</div>
      <code class="block break-all text-sm text-slate-300">
        {origin}/play/{session.player_token}
      </code>
    </div>
  </div>
);

const SharedBadge: FC<{ shared: number }> = ({ shared }) =>
  shared ? (
    <span class="rounded bg-emerald-700/60 px-2 py-0.5 text-xs text-emerald-100">Shared</span>
  ) : (
    <span class="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300">DM only</span>
  );

export const DmDashboard: FC<{
  origin: string;
  session: Session;
  notes: Note[];
  maps: MapRow[];
}> = ({ origin, session, notes, maps }) => {
  const base = `/dm/${session.dm_token}`;
  return (
    <Layout title={`DM · ${session.name}`} view="dm" sseUrl={`${base}/events`}>
      <h1 class="text-2xl font-bold mb-1">{session.name}</h1>
      <p class="text-slate-400 mb-4 text-sm">Dungeon Master view</p>
      <ShareLinks origin={origin} session={session} />

      <section class="mb-8">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xl font-semibold">Notes</h2>
          <form method="post" action={`${base}/notes`}>
            <button class="rounded bg-sky-600 px-3 py-1.5 text-sm hover:bg-sky-500">
              + New note
            </button>
          </form>
        </div>
        <ul class="divide-y divide-slate-800 rounded border border-slate-800">
          {notes.length === 0 && <li class="p-3 text-slate-500 text-sm">No notes yet.</li>}
          {notes.map((n) => (
            <li class="flex items-center justify-between p-3">
              <a href={`${base}/notes/${n.id}`} class="text-sky-300 hover:underline">
                {n.title}
              </a>
              <SharedBadge shared={n.shared} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xl font-semibold">Maps</h2>
        </div>
        <form
          method="post"
          action={`${base}/maps`}
          enctype="multipart/form-data"
          class="mb-3 grid gap-2 rounded border border-slate-800 p-3 sm:grid-cols-[1fr_auto_auto_auto]"
        >
          <input
            name="title"
            required
            placeholder="Map title"
            class="rounded bg-slate-800 px-3 py-2 outline-none focus:ring-2 ring-sky-500"
          />
          <input
            name="cols"
            type="number"
            min="1"
            max="100"
            value="20"
            title="Columns"
            class="w-20 rounded bg-slate-800 px-2 py-2"
          />
          <input
            name="rows"
            type="number"
            min="1"
            max="100"
            value="15"
            title="Rows"
            class="w-20 rounded bg-slate-800 px-2 py-2"
          />
          <input name="image" type="file" accept="image/*" required class="text-sm" />
          <button class="rounded bg-sky-600 px-3 py-2 text-sm hover:bg-sky-500 sm:col-span-4">
            Upload map
          </button>
        </form>
        <ul class="divide-y divide-slate-800 rounded border border-slate-800">
          {maps.length === 0 && <li class="p-3 text-slate-500 text-sm">No maps yet.</li>}
          {maps.map((m) => (
            <li class="flex items-center justify-between p-3">
              <a href={`${base}/maps/${m.id}`} class="text-sky-300 hover:underline">
                {m.title}
              </a>
              <span class="flex items-center gap-3 text-sm text-slate-400">
                {m.cols}×{m.rows}
                <SharedBadge shared={m.shared} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
};

export const NoteEditorPage: FC<{ session: Session; note: Note }> = ({ session, note }) => {
  const base = `/dm/${session.dm_token}`;
  return (
    <Layout title={`Edit · ${note.title}`} view="dm">
      <a href={base} class="text-sm text-sky-300 hover:underline">
        ← Back
      </a>
      <form method="post" action={`${base}/notes/${note.id}`} class="mt-3 grid gap-3">
        <input
          name="title"
          value={note.title}
          required
          class="rounded bg-slate-800 px-3 py-2 text-lg font-semibold outline-none focus:ring-2 ring-sky-500"
        />
        <textarea
          name="body_md"
          rows={18}
          placeholder="Write markdown…"
          class="rounded bg-slate-800 px-3 py-2 font-mono text-sm outline-none focus:ring-2 ring-sky-500"
        >
          {note.body_md}
        </textarea>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="shared" value="1" checked={!!note.shared} />
          Share with players
        </label>
        <div class="flex gap-2">
          <button class="rounded bg-sky-600 px-4 py-2 hover:bg-sky-500">Save</button>
          <button
            formaction={`${base}/notes/${note.id}/delete`}
            class="rounded bg-rose-700 px-4 py-2 hover:bg-rose-600"
          >
            Delete
          </button>
        </div>
      </form>
      <div class="mt-6">
        <div class="text-xs uppercase tracking-wide text-slate-500 mb-1">Preview</div>
        <div
          class="prose prose-invert max-w-none rounded border border-slate-800 p-4"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body_md) }}
        />
      </div>
    </Layout>
  );
};

/** The fog overlay element broadcast to all viewers. Styling differs by the
 *  ancestor .dm-view / .play-view context (see styles.css). */
export const FogOverlay: FC<{ map: MapRow }> = ({ map }) => {
  const revealed = revealedSet(map);
  const total = map.cols * map.rows;
  const cells = [];
  for (let i = 0; i < total; i++) {
    cells.push(<div class="cell" data-i={i} data-revealed={revealed.has(i) ? "1" : "0"} />);
  }
  return (
    <div
      id={`fog-${map.id}`}
      class="fog-grid"
      style={`grid-template-columns: repeat(${map.cols}, 1fr); grid-template-rows: repeat(${map.rows}, 1fr);`}
    >
      {cells}
    </div>
  );
};

const MapStage: FC<{ map: MapRow }> = ({ map }) => (
  <div class="relative inline-block max-w-full select-none">
    <img src={`/uploads/${map.image_path}`} alt={map.title} class="block max-w-full h-auto" />
    <FogOverlay map={map} />
  </div>
);

export const DmMapPage: FC<{ session: Session; map: MapRow }> = ({ session, map }) => {
  const base = `/dm/${session.dm_token}`;
  return (
    <Layout title={`Map · ${map.title}`} view="dm" sseUrl={`${base}/events`}>
      <a href={base} class="text-sm text-sky-300 hover:underline">
        ← Back
      </a>
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold">{map.title}</h1>
        <SharedBadge shared={map.shared} />
      </div>
      <p class="text-slate-400 text-sm mb-3">
        Drag a box to reveal an area; click a cell to toggle. Players see shared maps live.
      </p>

      <div class="mb-3 flex flex-wrap gap-2">
        <form method="post" action={`${base}/maps/${map.id}/reveal-all`}>
          <button class="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">
            Reveal all
          </button>
        </form>
        <form method="post" action={`${base}/maps/${map.id}/hide-all`}>
          <button class="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">
            Hide all
          </button>
        </form>
        <form method="post" action={`${base}/maps/${map.id}/share`}>
          <input type="hidden" name="shared" value={map.shared ? "0" : "1"} />
          <button class="rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600">
            {map.shared ? "Stop sharing" : "Share with players"}
          </button>
        </form>
        <form method="post" action={`${base}/maps/${map.id}/delete`}>
          <button class="rounded bg-rose-700 px-3 py-1.5 text-sm hover:bg-rose-600">
            Delete
          </button>
        </form>
      </div>

      <div
        id="stage"
        class="relative inline-block max-w-full"
        data-reveal-url={`${base}/maps/${map.id}/reveal`}
        data-cols={map.cols}
        data-rows={map.rows}
      >
        <MapStage map={map} />
        <div id="selbox" class="selbox" hidden />
      </div>
      <script type="module" src="/vendor/dm-paint.js" />
    </Layout>
  );
};

export const PlayerDashboard: FC<{ session: Session; notes: Note[]; maps: MapRow[] }> = ({
  session,
  notes,
  maps,
}) => {
  const base = `/play/${session.player_token}`;
  return (
    <Layout title={session.name} view="play" sseUrl={`${base}/events`}>
      <h1 class="text-2xl font-bold mb-1">{session.name}</h1>
      <p class="text-slate-400 mb-4 text-sm">Player view</p>

      <section class="mb-8">
        <h2 class="text-xl font-semibold mb-2">Maps</h2>
        <ul id="player-maps" class="divide-y divide-slate-800 rounded border border-slate-800">
          {maps.length === 0 && (
            <li class="p-3 text-slate-500 text-sm">Nothing shared yet.</li>
          )}
          {maps.map((m) => (
            <li class="p-3">
              <a href={`${base}/maps/${m.id}`} class="text-sky-300 hover:underline">
                {m.title}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 class="text-xl font-semibold mb-2">Notes</h2>
        <ul id="player-notes" class="divide-y divide-slate-800 rounded border border-slate-800">
          {notes.length === 0 && (
            <li class="p-3 text-slate-500 text-sm">Nothing shared yet.</li>
          )}
          {notes.map((n) => (
            <li class="p-3">
              <a href={`${base}/notes/${n.id}`} class="text-sky-300 hover:underline">
                {n.title}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
};

export const PlayerNotePage: FC<{ session: Session; note: Note }> = ({ session, note }) => (
  <Layout title={note.title} view="play">
    <a href={`/play/${session.player_token}`} class="text-sm text-sky-300 hover:underline">
      ← Back
    </a>
    <h1 class="mt-2 text-2xl font-bold mb-3">{note.title}</h1>
    <div
      class="prose prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body_md) }}
    />
  </Layout>
);

export const PlayerMapPage: FC<{ session: Session; map: MapRow }> = ({ session, map }) => (
  <Layout title={map.title} view="play" sseUrl={`/play/${session.player_token}/events`}>
    <a href={`/play/${session.player_token}`} class="text-sm text-sky-300 hover:underline">
      ← Back
    </a>
    <h1 class="mt-2 text-2xl font-bold mb-3">{map.title}</h1>
    <MapStage map={map} />
  </Layout>
);

export const NotFound: FC<{ message?: string }> = ({ message }) => (
  <Layout title="Not found" view="plain">
    <h1 class="text-2xl font-bold mb-2">Not found</h1>
    <p class="text-slate-400">{message ?? "That link is invalid or has expired."}</p>
    <a href="/" class="mt-4 inline-block text-sky-300 hover:underline">
      ← Home
    </a>
  </Layout>
);
