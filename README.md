# D&D Session Tool

A lightweight web app for running tabletop D&D sessions. The DM keeps notes and
maps, shares selected ones with players, and **progressively reveals parts of a
map** (grid fog-of-war) live as the party explores — players' screens update in
real time, no refresh.

Built with **TypeScript · Bun · Hono · server-rendered JSX · Tailwind · Datastar**.

## How it works

- **No accounts.** Creating a session generates two secret links:
  - a **DM link** (`/dm/<token>`) with full edit access, and
  - a **player link** (`/play/<token>`) that shows only shared content and
    receives live reveals.
  Share the player link with your table; keep the DM link to yourself.
- **Notes** are markdown. Each note is either DM-only or shared with players.
- **Maps** are uploaded images with a DM-defined grid (columns × rows). Maps
  start fully fogged; the DM clicks a cell to toggle it or click-drags to paint
  reveals, plus *Reveal all* / *Hide all*. Each map is independently shared.
- **Live sync** is powered by Datastar over Server-Sent Events. Reveal and
  share changes broadcast to everyone connected to that session.

## Data & storage

- `bun:sqlite` single-file database (`dnd.db` by default).
- Uploaded map images are stored on disk under `uploads/`.

## Running

```sh
bun install
bun run dev      # builds Tailwind, runs the server with --watch
# or
bun run start    # builds Tailwind, runs once
```

Then open http://localhost:3000 and create a session.

### Configuration (environment variables)

| Var          | Default     | Purpose                         |
| ------------ | ----------- | ------------------------------- |
| `PORT`       | `3000`      | Listen port                     |
| `HOST`       | `0.0.0.0`   | Bind address                    |
| `DB_PATH`    | `dnd.db`    | SQLite database file            |
| `UPLOAD_DIR` | `uploads`   | Directory for map image uploads |

No `localhost` assumptions — deploy behind any host/tunnel and share the links.

## Project layout

```
src/index.ts      Hono server + all routes (sessions, notes, maps, SSE)
src/db.ts         bun:sqlite schema + query helpers
src/realtime.ts   per-session SSE pub/sub + Datastar event formatting
src/views.tsx     server-rendered JSX pages and the fog overlay component
src/markdown.ts   markdown -> sanitized HTML
public/vendor/    Datastar bundle + DM fog-painting script
```

## Out of scope (for now)

Player tokens/figures on maps, presence/chat/dice, edit history/undo, and
multiple simultaneous DMs are intentionally deferred.
