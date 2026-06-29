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

  -- The legacy per-note model was replaced by a single campaign document.
  DROP TABLE IF EXISTS notes;

  CREATE TABLE IF NOT EXISTS campaign_docs (
    session_id  INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    body_html   TEXT NOT NULL DEFAULT '',
    shared_keys TEXT NOT NULL DEFAULT '',
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

// Migrate older campaign_docs rows (which stored markdown in body_md) to the
// HTML-backed column. Adding an existing column throws; ignore that.
try {
  db.exec(`ALTER TABLE campaign_docs ADD COLUMN body_html TEXT NOT NULL DEFAULT ''`);
} catch {
  /* column already exists */
}

export type Session = {
  id: number;
  dm_token: string;
  player_token: string;
  name: string;
  created_at: number;
};

export type CampaignDoc = {
  session_id: number;
  body_html: string;
  shared_keys: string; // newline-separated shared heading keys
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

// --- Campaign document ---
export function getDoc(sessionId: number): CampaignDoc {
  const existing = db
    .query<CampaignDoc, [number]>(`SELECT * FROM campaign_docs WHERE session_id = ?`)
    .get(sessionId);
  if (existing) return existing;
  return db
    .query<CampaignDoc, [number, number]>(
      `INSERT INTO campaign_docs (session_id, updated_at) VALUES (?, ?) RETURNING *`,
    )
    .get(sessionId, now())!;
}

export function setDocHtml(sessionId: number, html: string): void {
  getDoc(sessionId); // ensure the row exists
  db.query(`UPDATE campaign_docs SET body_html = ?, updated_at = ? WHERE session_id = ?`).run(
    html,
    now(),
    sessionId,
  );
}

export function sharedKeySet(doc: CampaignDoc): Set<string> {
  const s = new Set<string>();
  for (const line of doc.shared_keys.split("\n")) {
    const k = line.trim();
    if (k) s.add(k);
  }
  return s;
}

export function setSharedKeys(sessionId: number, keys: Set<string>): void {
  getDoc(sessionId);
  db.query(`UPDATE campaign_docs SET shared_keys = ?, updated_at = ? WHERE session_id = ?`).run(
    [...keys].join("\n"),
    now(),
    sessionId,
  );
}

export function toggleSharedKey(sessionId: number, key: string): void {
  const keys = sharedKeySet(getDoc(sessionId));
  keys.has(key) ? keys.delete(key) : keys.add(key);
  setSharedKeys(sessionId, keys);
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
