#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

struct Db(Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone)]
struct ChecklistItem {
    id: String,
    text: String,
    done: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct Note {
    id: String,
    title: String,
    content: String,
    status: String,
    priority: String,
    tags: Vec<String>,
    checklist: Vec<ChecklistItem>,
    due_at: Option<i64>,
    pinned: bool,
    created_at: i64,
    updated_at: i64,
    deleted: bool,
}

fn init_db(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'todo',
            priority TEXT NOT NULL DEFAULT 'none',
            tags TEXT NOT NULL DEFAULT '[]',
            checklist TEXT NOT NULL DEFAULT '[]',
            due_at INTEGER,
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
        CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);",
    ).expect("init db");
}

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags_json: String = row.get("tags")?;
    let checklist_json: String = row.get("checklist")?;
    Ok(Note {
        id: row.get("id")?,
        title: row.get("title")?,
        content: row.get("content")?,
        status: row.get("status")?,
        priority: row.get("priority")?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        checklist: serde_json::from_str(&checklist_json).unwrap_or_default(),
        due_at: row.get("due_at")?,
        pinned: row.get::<_, i64>("pinned")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted: row.get::<_, i64>("deleted")? != 0,
    })
}

#[tauri::command]
fn list_notes(db: State<Db>) -> Result<Vec<Note>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT * FROM notes WHERE deleted = 0 ORDER BY pinned DESC, updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let notes = stmt.query_map([], row_to_note)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(notes)
}

#[tauri::command]
fn save_note(db: State<Db>, note: Note) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tags = serde_json::to_string(&note.tags).map_err(|e| e.to_string())?;
    let checklist = serde_json::to_string(&note.checklist).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO notes (id, title, content, status, priority, tags, checklist, due_at, pinned, created_at, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, content=excluded.content, status=excluded.status,
            priority=excluded.priority, tags=excluded.tags, checklist=excluded.checklist,
            due_at=excluded.due_at, pinned=excluded.pinned, updated_at=excluded.updated_at,
            deleted=excluded.deleted",
        params![
            note.id, note.title, note.content, note.status, note.priority,
            tags, checklist, note.due_at, note.pinned as i64,
            note.created_at, note.updated_at, note.deleted as i64
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_note(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE notes SET deleted = 1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn main() {
    let conn = Connection::open("memo.db").expect("open db");
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    init_db(&conn);

    tauri::Builder::default()
        .manage(Db(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            list_notes, save_note, delete_note, new_id
        ])
        .run(tauri::generate_context!())
        .expect("run app");
}
