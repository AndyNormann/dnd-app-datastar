import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";

const DB_PATH = process.env.DB_PATH ?? "dnd.db";

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dm_token    TEXT NOT NULL UNIQUE,
    player_token TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body_md     TEXT NOT NULL DEFAULT '',
    shared      INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS maps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    image_path  TEXT NOT NULL,
    cols        INTEGER NOT NULL,
    rows        INTEGER NOT NULL,
    revealed    TEXT NOT NULL DEFAULT '',
    shared      INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
  );
`);

export type Session = {
  id: number;
  dm_token: string;
  player_token: string;
  name: string;
  created_at: number;
};

export type Note = {
  id: number;
  session_id: number;
  title: string;
  body_md: string;
  shared: number;
  position: number;
  updated_at: number;
};

export type MapRow = {
  id: number;
  session_id: number;
  title: string;
  image_path: string;
  cols: number;
  rows: number;
  revealed: string; // comma-separated revealed cell indices
  shared: number;
  position: number;
  updated_at: number;
};

export function token(): string {
  return randomBytes(16).toString("base64url");
}

export const now = () => Date.now();

// --- Sessions ---
export function createSession(name: string): Session {
  const dm = token();
  const player = token();
  const stmt = db.query<Session, [string, string, string, number]>(
    `INSERT INTO sessions (dm_token, player_token, name, created_at)
     VALUES (?, ?, ?, ?) RETURNING *`,
  );
  return stmt.get(dm, player, name, now())!;
}

export function sessionByDm(t: string): Session | null {
  return db.query<Session, [string]>(`SELECT * FROM sessions WHERE dm_token = ?`).get(t);
}

export function sessionByPlayer(t: string): Session | null {
  return db
    .query<Session, [string]>(`SELECT * FROM sessions WHERE player_token = ?`)
    .get(t);
}

// --- Notes ---
export function listNotes(sessionId: number, onlyShared = false): Note[] {
  const where = onlyShared ? "AND shared = 1" : "";
  return db
    .query<Note, [number]>(
      `SELECT * FROM notes WHERE session_id = ? ${where} ORDER BY position, id`,
    )
    .all(sessionId);
}

export function getNote(sessionId: number, id: number): Note | null {
  return db
    .query<Note, [number, number]>(`SELECT * FROM notes WHERE session_id = ? AND id = ?`)
    .get(sessionId, id);
}

export function createNote(sessionId: number, title: string): Note {
  return db
    .query<Note, [number, string, number]>(
      `INSERT INTO notes (session_id, title, updated_at) VALUES (?, ?, ?) RETURNING *`,
    )
    .get(sessionId, title, now())!;
}

export function updateNote(
  sessionId: number,
  id: number,
  fields: { title?: string; body_md?: string; shared?: number },
): void {
  const cur = getNote(sessionId, id);
  if (!cur) return;
  db.query(
    `UPDATE notes SET title = ?, body_md = ?, shared = ?, updated_at = ?
     WHERE session_id = ? AND id = ?`,
  ).run(
    fields.title ?? cur.title,
    fields.body_md ?? cur.body_md,
    fields.shared ?? cur.shared,
    now(),
    sessionId,
    id,
  );
}

export function deleteNote(sessionId: number, id: number): void {
  db.query(`DELETE FROM notes WHERE session_id = ? AND id = ?`).run(sessionId, id);
}

// --- Maps ---
export function listMaps(sessionId: number, onlyShared = false): MapRow[] {
  const where = onlyShared ? "AND shared = 1" : "";
  return db
    .query<MapRow, [number]>(
      `SELECT * FROM maps WHERE session_id = ? ${where} ORDER BY position, id`,
    )
    .all(sessionId);
}

export function getMap(sessionId: number, id: number): MapRow | null {
  return db
    .query<MapRow, [number, number]>(`SELECT * FROM maps WHERE session_id = ? AND id = ?`)
    .get(sessionId, id);
}

export function createMap(
  sessionId: number,
  title: string,
  imagePath: string,
  cols: number,
  rows: number,
): MapRow {
  return db
    .query<MapRow, [number, string, string, number, number, number]>(
      `INSERT INTO maps (session_id, title, image_path, cols, rows, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(sessionId, title, imagePath, cols, rows, now())!;
}

export function setMapShared(sessionId: number, id: number, shared: number): void {
  db.query(`UPDATE maps SET shared = ?, updated_at = ? WHERE session_id = ? AND id = ?`).run(
    shared,
    now(),
    sessionId,
    id,
  );
}

export function setMapRevealed(sessionId: number, id: number, revealed: Set<number>): void {
  const csv = [...revealed].sort((a, b) => a - b).join(",");
  db.query(`UPDATE maps SET revealed = ?, updated_at = ? WHERE session_id = ? AND id = ?`).run(
    csv,
    now(),
    sessionId,
    id,
  );
}

export function deleteMap(sessionId: number, id: number): void {
  db.query(`DELETE FROM maps WHERE session_id = ? AND id = ?`).run(sessionId, id);
}

export function revealedSet(map: MapRow): Set<number> {
  const s = new Set<number>();
  if (map.revealed.trim() === "") return s;
  for (const part of map.revealed.split(",")) {
    const n = Number(part);
    if (Number.isInteger(n)) s.add(n);
  }
  return s;
}
