import type { NoteDto, SavedFilterDto } from "../../shared/api";
import { domainFilterSchema, type DomainFilter, type UserStatus } from "../../shared/filters";
import { toNoteDto, type NoteDbRow } from "../db/rows";
import { AppError, errorMessage, notFound } from "../utils/errors";
import { nowIso } from "../utils/time";

/** Shortlist, user statuses, notes and saved filters. */

// ---------------------------------------------------------------------------
// Shortlist (favourites) and statuses
// ---------------------------------------------------------------------------

export async function addToShortlist(db: D1Database, domainIds: number[]): Promise<number> {
  const ids = JSON.stringify([...new Set(domainIds)]);
  const timestamp = nowIso();
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO favourites (domain_id, created_at)
         SELECT id, ?2 FROM domains WHERE id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(ids, timestamp),
    db
      .prepare(
        `UPDATE domains SET user_status = 'shortlisted', updated_at = ?2
         WHERE id IN (SELECT value FROM json_each(?1)) AND user_status IN ('none', 'ignored')`,
      )
      .bind(ids, timestamp),
  ]);
  return insert?.meta.changes ?? 0;
}

export async function removeFromShortlist(db: D1Database, domainId: number): Promise<void> {
  const timestamp = nowIso();
  await db.batch([
    db.prepare("DELETE FROM favourites WHERE domain_id = ?").bind(domainId),
    db
      .prepare("UPDATE domains SET user_status = 'none', updated_at = ?2 WHERE id = ?1 AND user_status = 'shortlisted'")
      .bind(domainId, timestamp),
  ]);
}

/**
 * Sets the user status for many domains. "none"/"ignored" remove the domain
 * from the shortlist; every other status keeps (or adds) it there.
 */
export async function setUserStatus(db: D1Database, domainIds: number[], status: UserStatus): Promise<number> {
  const ids = JSON.stringify([...new Set(domainIds)]);
  const timestamp = nowIso();
  const onShortlist = status !== "none" && status !== "ignored";
  const [update] = await db.batch([
    db
      .prepare("UPDATE domains SET user_status = ?2, updated_at = ?3 WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(ids, status, timestamp),
    onShortlist
      ? db
          .prepare(
            `INSERT OR IGNORE INTO favourites (domain_id, created_at)
             SELECT id, ?2 FROM domains WHERE id IN (SELECT value FROM json_each(?1))`,
          )
          .bind(ids, timestamp)
      : db.prepare("DELETE FROM favourites WHERE domain_id IN (SELECT value FROM json_each(?1))").bind(ids),
  ]);
  return update?.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Notes (stored as plain text; rendered as text by React, never as HTML)
// ---------------------------------------------------------------------------

async function assertDomain(db: D1Database, domainId: number): Promise<void> {
  const row = await db.prepare("SELECT id FROM domains WHERE id = ?").bind(domainId).first();
  if (!row) throw notFound("Domain");
}

export async function listNotes(db: D1Database, domainId: number): Promise<NoteDto[]> {
  const { results } = await db
    .prepare("SELECT * FROM notes WHERE domain_id = ? ORDER BY created_at DESC, id DESC LIMIT 200")
    .bind(domainId)
    .all<NoteDbRow>();
  return results.map(toNoteDto);
}

export async function addNote(db: D1Database, domainId: number, note: string): Promise<NoteDto> {
  await assertDomain(db, domainId);
  const timestamp = nowIso();
  const row = await db
    .prepare("INSERT INTO notes (domain_id, note, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) RETURNING *")
    .bind(domainId, note, timestamp)
    .first<NoteDbRow>();
  if (!row) throw new Error("Failed to create note");
  return toNoteDto(row);
}

export async function updateNote(db: D1Database, domainId: number, noteId: number, note: string): Promise<NoteDto> {
  const row = await db
    .prepare("UPDATE notes SET note = ?3, updated_at = ?4 WHERE id = ?1 AND domain_id = ?2 RETURNING *")
    .bind(noteId, domainId, note, nowIso())
    .first<NoteDbRow>();
  if (!row) throw notFound("Note");
  return toNoteDto(row);
}

export async function deleteNote(db: D1Database, domainId: number, noteId: number): Promise<void> {
  const result = await db.prepare("DELETE FROM notes WHERE id = ? AND domain_id = ?").bind(noteId, domainId).run();
  if ((result.meta.changes ?? 0) === 0) throw notFound("Note");
}

// ---------------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------------

interface SavedFilterRow {
  id: number;
  name: string;
  configuration_json: string;
  created_at: string;
  updated_at: string;
}

function toSavedFilter(row: SavedFilterRow): SavedFilterDto {
  let configuration: DomainFilter = {};
  try {
    const parsed = domainFilterSchema.safeParse(JSON.parse(row.configuration_json));
    if (parsed.success) configuration = parsed.data;
  } catch {
    configuration = {};
  }
  return { id: row.id, name: row.name, configuration, createdAt: row.created_at, updatedAt: row.updated_at };
}

function uniqueNameError(error: unknown): never {
  if (/UNIQUE constraint failed/i.test(errorMessage(error))) {
    throw new AppError(409, "duplicate_name", "A saved filter with this name already exists.");
  }
  throw error;
}

export async function listSavedFilters(db: D1Database): Promise<SavedFilterDto[]> {
  const { results } = await db.prepare("SELECT * FROM saved_filters ORDER BY name ASC").all<SavedFilterRow>();
  return results.map(toSavedFilter);
}

export async function createSavedFilter(db: D1Database, name: string, configuration: DomainFilter): Promise<SavedFilterDto> {
  const timestamp = nowIso();
  try {
    const row = await db
      .prepare(
        `INSERT INTO saved_filters (name, configuration_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         RETURNING *`,
      )
      .bind(name, JSON.stringify(configuration), timestamp)
      .first<SavedFilterRow>();
    if (!row) throw new Error("Failed to save filter");
    return toSavedFilter(row);
  } catch (error) {
    return uniqueNameError(error);
  }
}

export async function updateSavedFilter(
  db: D1Database,
  id: number,
  name: string,
  configuration: DomainFilter,
): Promise<SavedFilterDto> {
  try {
    const row = await db
      .prepare("UPDATE saved_filters SET name = ?2, configuration_json = ?3, updated_at = ?4 WHERE id = ?1 RETURNING *")
      .bind(id, name, JSON.stringify(configuration), nowIso())
      .first<SavedFilterRow>();
    if (!row) throw notFound("Saved filter");
    return toSavedFilter(row);
  } catch (error) {
    return uniqueNameError(error);
  }
}

export async function deleteSavedFilter(db: D1Database, id: number): Promise<void> {
  const result = await db.prepare("DELETE FROM saved_filters WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) throw notFound("Saved filter");
}
