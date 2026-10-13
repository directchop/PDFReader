use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const MAX_READ: u64 = 4 * 1024 * 1024;
pub const MAX_DOCUMENT: u64 = 1024 * 1024 * 1024;
pub const MAX_OPEN: usize = 12;
pub const MAX_BOOKMARKS: usize = 200;
pub const MAX_BOOKMARK_FILES: usize = 500;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub page: u32,
    pub label: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct BookmarkEntry {
    bookmarks: Vec<Bookmark>,
    touched: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub position: Option<ReadingPosition>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPosition {
    pub page: u32,
    pub pages: u32,
    pub scale: String,
    pub rotation: u16,
    pub spread: u8,
    pub scroll: u8,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub position: Option<ReadingPosition>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileView {
    pub name: String,
    pub path: String,
    pub position: Option<ReadingPosition>,
    pub exists: bool,
}

struct OpenDocument {
    info: DocumentInfo,
    file: Arc<Mutex<File>>,
    modified: Option<SystemTime>,
    pending_change: Option<(u64, Option<SystemTime>, u8)>,
}

struct SaveTarget {
    source: PathBuf,
    destination: PathBuf,
}

#[derive(Default, Serialize)]
pub struct OpenBatch {
    pub documents: Vec<DocumentInfo>,
    pub errors: Vec<OpenError>,
    pub active: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedSession {
    paths: Vec<String>,
    active: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenError {
    pub name: String,
    pub code: String,
}

#[derive(Default)]
pub struct Library {
    documents: HashMap<String, OpenDocument>,
    pub recent: Vec<RecentFile>,
    pub pending: OpenBatch,
    history_file: Option<PathBuf>,
    session_file: Option<PathBuf>,
    bookmarks_file: Option<PathBuf>,
    bookmark_store: HashMap<String, BookmarkEntry>,
    save_tokens: HashMap<String, SaveTarget>,
}

impl Library {
    pub fn with_history(path: PathBuf) -> Self {
        let recent: Vec<RecentFile> = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default();
        let data_dir = path.parent();
        let bookmarks_file = data_dir.map(|dir| dir.join("bookmarks.json"));
        let bookmark_store = bookmarks_file
            .as_ref()
            .and_then(|file| fs::read(file).ok())
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default();
        Self {
            recent: recent.into_iter().take(12).collect(),
            session_file: data_dir.map(|dir| dir.join("session.json")),
            bookmarks_file,
            bookmark_store,
            history_file: Some(path),
            ..Self::default()
        }
    }

    fn persist_history(&self) -> Result<(), String> {
        let Some(path) = &self.history_file else {
            return Ok(());
        };
        let temp = path.with_extension("tmp");
        let data = serde_json::to_vec_pretty(&self.recent).map_err(|e| e.to_string())?;
        fs::write(&temp, data).map_err(|e| e.to_string())?;
        fs::rename(temp, path).map_err(|e| e.to_string())
    }

    pub fn clear_history(&mut self) -> Result<(), String> {
        let previous = std::mem::take(&mut self.recent);
        if let Err(error) = self.persist_history() {
            self.recent = previous;
            return Err(error);
        }
        Ok(())
    }

    fn persist_session(&self, session: &SavedSession) -> Result<(), String> {
        let Some(path) = &self.session_file else {
            return Ok(());
        };
        let temp = path.with_extension("tmp");
        let data = serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?;
        fs::write(&temp, data).map_err(|e| e.to_string())?;
        fs::rename(temp, path).map_err(|e| e.to_string())
    }

    fn persist_bookmarks(&self) -> Result<(), String> {
        let Some(path) = &self.bookmarks_file else {
            return Ok(());
        };
        let temp = path.with_extension("tmp");
        let data = serde_json::to_vec_pretty(&self.bookmark_store).map_err(|e| e.to_string())?;
        fs::write(&temp, data).map_err(|e| e.to_string())?;
        fs::rename(temp, path).map_err(|e| e.to_string())
    }

    fn trim_bookmarks(&mut self) {
        while self.bookmark_store.len() > MAX_BOOKMARK_FILES {
            let oldest = self
                .bookmark_store
                .iter()
                .min_by_key(|(path, entry)| (entry.touched, *path))
                .map(|(path, _)| path.clone());
            if let Some(path) = oldest {
                self.bookmark_store.remove(&path);
            }
        }
    }

    pub fn bookmarks(&mut self, id: &str) -> Result<Vec<Bookmark>, String> {
        let path = self
            .documents
            .get(id)
            .ok_or_else(|| "document_closed".to_string())?
            .info
            .path
            .clone();
        let entry = self.bookmark_store.entry(path).or_default();
        entry.touched = timestamp();
        let bookmarks = entry.bookmarks.clone();
        self.trim_bookmarks();
        if let Err(error) = self.persist_bookmarks() {
            eprintln!("Could not save bookmarks: {error}");
        }
        Ok(bookmarks)
    }

    pub fn save_bookmarks(&mut self, id: &str, bookmarks: Vec<Bookmark>) -> Result<(), String> {
        if bookmarks.len() > MAX_BOOKMARKS
            || bookmarks
                .iter()
                .any(|bookmark| bookmark.page < 1 || bookmark.label.chars().count() > 200)
        {
            return Err("invalid_bookmark".into());
        }
        let path = self
            .documents
            .get(id)
            .ok_or_else(|| "document_closed".to_string())?
            .info
            .path
            .clone();
        let previous = self.bookmark_store.clone();
        self.bookmark_store.insert(
            path,
            BookmarkEntry {
                bookmarks,
                touched: timestamp(),
            },
        );
        self.trim_bookmarks();
        if let Err(error) = self.persist_bookmarks() {
            self.bookmark_store = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn save_session(&self, ids: &[String], active: Option<&str>) -> Result<(), String> {
        let paths = ids
            .iter()
            .filter_map(|id| self.documents.get(id).map(|doc| doc.info.path.clone()))
            .collect();
        let active = active.and_then(|id| self.documents.get(id).map(|doc| doc.info.path.clone()));
        self.persist_session(&SavedSession { paths, active })
    }

    pub fn restore_session(&mut self) -> OpenBatch {
        let saved = self
            .session_file
            .as_ref()
            .and_then(|path| fs::read(path).ok())
            .and_then(|data| serde_json::from_slice::<SavedSession>(&data).ok())
            .unwrap_or_default();
        let mut batch = self.open_many(saved.paths.iter().map(PathBuf::from));
        batch.active = saved.active;
        batch
    }

    pub fn open(&mut self, path: &Path) -> Result<DocumentInfo, String> {
        let path = path
            .canonicalize()
            .map_err(|_| "file_not_found".to_string())?;
        let key = path.to_string_lossy().to_string();
        if let Some(doc) = self.documents.values().find(|d| d.info.path == key) {
            return Ok(doc.info.clone());
        }
        if self.documents.len() >= MAX_OPEN {
            return Err("too_many_open".into());
        }
        let mut file = File::open(&path).map_err(|_| "cannot_open".to_string())?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("not_a_file".into());
        }
        if metadata.len() > MAX_DOCUMENT {
            return Err("too_large".into());
        }
        let mut header = [0u8; 1024];
        let read = file.read(&mut header).map_err(|e| e.to_string())?;
        if !header[..read].windows(5).any(|w| w == b"%PDF-") {
            return Err("not_pdf".into());
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let position = self
            .recent
            .iter()
            .find(|recent| recent.path == key)
            .and_then(|recent| recent.position.clone());
        let info = DocumentInfo {
            id: Uuid::new_v4().to_string(),
            name: name.clone(),
            path: key.clone(),
            size: metadata.len(),
            position: position.clone(),
        };
        self.documents.insert(
            info.id.clone(),
            OpenDocument {
                info: info.clone(),
                file: Arc::new(Mutex::new(file)),
                modified: metadata.modified().ok(),
                pending_change: None,
            },
        );
        self.recent.retain(|r| r.path != key);
        self.recent.insert(
            0,
            RecentFile {
                name,
                path: key,
                position,
            },
        );
        self.recent.truncate(12);
        // A read-only configuration directory must not prevent reading a PDF.
        if let Err(error) = self.persist_history() {
            eprintln!("Could not save recent files: {error}");
        }
        Ok(info)
    }

    pub fn open_many(&mut self, paths: impl IntoIterator<Item = PathBuf>) -> OpenBatch {
        let mut batch = OpenBatch::default();
        for path in paths {
            match self.open(&path) {
                Ok(info) => batch.documents.push(info),
                Err(code) => batch.errors.push(OpenError {
                    name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                    code,
                }),
            }
        }
        batch
    }

    pub fn detect_changes(&mut self) -> Vec<DocumentInfo> {
        let mut changed = Vec::new();
        for document in self.documents.values_mut() {
            let metadata = match fs::metadata(&document.info.path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    eprintln!("Could not check {}: {error}", document.info.path);
                    document.pending_change = None;
                    continue;
                }
            };
            let current = (metadata.len(), metadata.modified().ok());
            if current.0 == document.info.size && current.1 == document.modified {
                document.pending_change = None;
                continue;
            }
            let stable = match document.pending_change {
                Some((size, modified, polls)) if (size, modified) == current => polls + 1,
                _ => 1,
            };
            if stable < 2 {
                document.pending_change = Some((current.0, current.1, stable));
                continue;
            }
            document.pending_change = None;
            if current.0 > MAX_DOCUMENT {
                eprintln!("Changed PDF is too large: {}", document.info.path);
                continue;
            }
            let mut file = match File::open(&document.info.path) {
                Ok(file) => file,
                Err(error) => {
                    eprintln!("Could not reload {}: {error}", document.info.path);
                    continue;
                }
            };
            let reopened = match file.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    eprintln!("Could not validate {}: {error}", document.info.path);
                    continue;
                }
            };
            if reopened.len() != current.0 || reopened.modified().ok() != current.1 {
                continue;
            }
            let mut header = [0u8; 1024];
            let read = match file.read(&mut header) {
                Ok(read) => read,
                Err(error) => {
                    eprintln!("Could not read {}: {error}", document.info.path);
                    continue;
                }
            };
            if !header[..read].windows(5).any(|window| window == b"%PDF-") {
                eprintln!("Changed file is not a PDF: {}", document.info.path);
                continue;
            }
            document.file = Arc::new(Mutex::new(file));
            document.info.size = current.0;
            document.modified = current.1;
            changed.push(document.info.clone());
        }
        changed
    }

    pub fn queue(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        let batch = self.open_many(paths);
        self.pending.documents.extend(batch.documents);
        self.pending.errors.extend(batch.errors);
    }

    pub fn close(&mut self, id: &str) {
        self.documents.remove(id);
    }

    pub fn save_position(&mut self, id: &str, position: ReadingPosition) -> Result<(), String> {
        let path = self
            .documents
            .get(id)
            .ok_or_else(|| "document_closed".to_string())?
            .info
            .path
            .clone();
        let previous_document_position = self
            .documents
            .get(id)
            .and_then(|document| document.info.position.clone());
        let scale_valid = matches!(position.scale.as_str(), "auto" | "page-width" | "page-fit")
            || position
                .scale
                .parse::<f64>()
                .is_ok_and(|scale| (0.1..=10.0).contains(&scale));
        if position.page < 1 || !matches!(position.rotation, 0 | 90 | 180 | 270) || !scale_valid {
            return Err("invalid_position".into());
        }
        let recent = self
            .recent
            .iter_mut()
            .find(|recent| recent.path == path)
            .ok_or_else(|| "not_in_recent".to_string())?;
        let previous = recent.position.replace(position.clone());
        if let Some(document) = self.documents.get_mut(id) {
            document.info.position = Some(position);
        }
        if let Err(error) = self.persist_history() {
            if let Some(recent) = self.recent.iter_mut().find(|recent| recent.path == path) {
                recent.position = previous.clone();
            }
            if let Some(document) = self.documents.get_mut(id) {
                document.info.position = previous_document_position;
            }
            return Err(error);
        }
        Ok(())
    }

    pub fn remove_recent(&mut self, path: &str) -> Result<(), String> {
        let previous = self.recent.clone();
        self.recent.retain(|recent| recent.path != path);
        if previous.len() == self.recent.len() {
            return Err("not_in_recent".into());
        }
        if let Err(error) = self.persist_history() {
            self.recent = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn recent_documents(&self) -> Vec<RecentFileView> {
        self.recent
            .iter()
            .map(|recent| RecentFileView {
                name: recent.name.clone(),
                path: recent.path.clone(),
                position: recent.position.clone(),
                exists: Path::new(&recent.path).exists(),
            })
            .collect()
    }

    pub fn reader(&self, id: &str, begin: u64, end: u64) -> Result<Arc<Mutex<File>>, String> {
        let doc = self
            .documents
            .get(id)
            .ok_or_else(|| "document_closed".to_string())?;
        if begin >= end || end > doc.info.size || end - begin > MAX_READ {
            return Err("invalid_range".into());
        }
        Ok(Arc::clone(&doc.file))
    }

    pub fn document_path(&self, id: &str) -> Result<PathBuf, String> {
        self.documents
            .get(id)
            .map(|document| PathBuf::from(&document.info.path))
            .ok_or_else(|| "document_closed".to_string())
    }

    pub fn issue_save_token(&mut self, id: &str, destination: &Path) -> Result<String, String> {
        let source = self
            .documents
            .get(id)
            .ok_or_else(|| "document_closed".to_string())?
            .info
            .path
            .clone();
        let destination = canonical_destination(destination)?;
        let destination_key = destination.to_string_lossy().into_owned();
        if self
            .documents
            .values()
            .any(|document| document.info.path == destination_key)
        {
            return Err("cannot_overwrite_original".into());
        }
        let token = Uuid::new_v4().to_string();
        self.save_tokens.insert(
            token.clone(),
            SaveTarget {
                source: PathBuf::from(source),
                destination,
            },
        );
        Ok(token)
    }

    pub fn write_saved_copy(&mut self, token: &str, bytes: &[u8]) -> Result<String, String> {
        let target = self
            .save_tokens
            .remove(token)
            .ok_or_else(|| "invalid_save_token".to_string())?;
        write_saved_copy_atomic(&target.source, &target.destination, bytes)?;
        self.add_saved_copy_to_recent(&target.destination)
    }

    fn add_saved_copy_to_recent(&mut self, path: &Path) -> Result<String, String> {
        let path = path.canonicalize().map_err(|error| error.to_string())?;
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let path = path.to_string_lossy().to_string();
        self.recent.retain(|recent| recent.path != path);
        self.recent.insert(
            0,
            RecentFile {
                name: name.clone(),
                path,
                position: None,
            },
        );
        self.recent.truncate(12);
        if let Err(error) = self.persist_history() {
            eprintln!("Could not save recent files: {error}");
        }
        Ok(name)
    }
}

fn canonical_destination(destination: &Path) -> Result<PathBuf, String> {
    if let Ok(path) = destination.canonicalize() {
        return Ok(path);
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "cannot_save".to_string())?
        .canonicalize()
        .map_err(|_| "cannot_save".to_string())?;
    let name = destination
        .file_name()
        .ok_or_else(|| "cannot_save".to_string())?;
    Ok(parent.join(name))
}

fn validate_saved_copy(source: &Path, destination: &Path, bytes: &[u8]) -> Result<(), String> {
    if source == destination {
        return Err("cannot_overwrite_original".into());
    }
    if bytes.len() as u64 > MAX_DOCUMENT {
        return Err("too_large".into());
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("not_pdf".into());
    }
    Ok(())
}

fn write_saved_copy_atomic(source: &Path, destination: &Path, bytes: &[u8]) -> Result<(), String> {
    validate_saved_copy(source, destination, bytes)?;
    let parent = destination
        .parent()
        .ok_or_else(|| "cannot_save".to_string())?;
    let name = destination
        .file_name()
        .ok_or_else(|| "cannot_save".to_string())?
        .to_string_lossy();
    let temporary = parent.join(format!(".{name}.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, destination).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn read_range(file: Arc<Mutex<File>>, begin: u64, end: u64) -> Result<Vec<u8>, String> {
    let mut file = file.lock().map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(begin))
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![0; (end - begin) as usize];
    file.read_exact(&mut buffer)
        .map_err(|_| "read_failed".to_string())?;
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn pdf() -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"%PDF-1.7\nfixture data\n%%EOF").unwrap();
        f
    }

    #[test]
    fn reads_exact_ranges_and_rejects_invalid_capabilities() {
        let f = pdf();
        let mut lib = Library::default();
        let info = lib.open(f.path()).unwrap();
        assert_eq!(
            read_range(lib.reader(&info.id, 0, 5).unwrap(), 0, 5).unwrap(),
            b"%PDF-"
        );
        assert_eq!(lib.reader("unknown", 0, 1).unwrap_err(), "document_closed");
        assert_eq!(lib.reader(&info.id, 5, 4).unwrap_err(), "invalid_range");
        assert_eq!(
            lib.reader(&info.id, 0, info.size + 1).unwrap_err(),
            "invalid_range"
        );
        assert_eq!(
            lib.reader(&info.id, 0, MAX_READ + 1).unwrap_err(),
            "invalid_range"
        );
        lib.close(&info.id);
        assert_eq!(lib.reader(&info.id, 0, 1).unwrap_err(), "document_closed");
    }

    #[test]
    fn deduplicates_and_continues_after_bad_file() {
        let f = pdf();
        let bad = tempfile::NamedTempFile::new().unwrap();
        let mut lib = Library::default();
        let batch = lib.open_many([bad.path().into(), f.path().into(), f.path().into()]);
        assert_eq!(batch.errors.len(), 1);
        assert_eq!(batch.errors[0].code, "not_pdf");
        assert_eq!(batch.documents.len(), 2);
        assert_eq!(batch.documents[0].id, batch.documents[1].id);
        assert_eq!(lib.recent.len(), 1);
        assert_eq!(lib.documents.len(), 1);
    }

    #[test]
    fn history_roundtrip_clear_and_corrupt_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("recent.json");
        let f = pdf();
        let mut lib = Library::with_history(history.clone());
        lib.open(f.path()).unwrap();
        assert_eq!(Library::with_history(history.clone()).recent.len(), 1);
        lib.clear_history().unwrap();
        assert!(Library::with_history(history.clone()).recent.is_empty());
        fs::write(&history, b"broken").unwrap();
        assert!(Library::with_history(history).recent.is_empty());
    }

    #[test]
    fn loads_legacy_history_without_positions() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("recent.json");
        fs::write(
            &history,
            r#"[{"name":"legacy.pdf","path":"/legacy/legacy.pdf"}]"#,
        )
        .unwrap();
        let library = Library::with_history(history);
        assert_eq!(library.recent.len(), 1);
        assert!(library.recent[0].position.is_none());
    }

    #[test]
    fn saves_valid_positions_and_rejects_invalid_positions() {
        let file = pdf();
        let mut library = Library::default();
        let info = library.open(file.path()).unwrap();
        let position = ReadingPosition {
            page: 1,
            pages: 1,
            scale: "auto".into(),
            rotation: 0,
            spread: 0,
            scroll: 0,
        };
        library.save_position(&info.id, position.clone()).unwrap();
        assert_eq!(library.recent[0].position.as_ref().unwrap().scale, "auto");

        let invalid = ReadingPosition {
            page: 0,
            ..position
        };
        assert_eq!(
            library.save_position(&info.id, invalid).unwrap_err(),
            "invalid_position"
        );
    }

    #[test]
    fn removes_recent_entry_and_persists_the_change() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("recent.json");
        let file = pdf();
        let mut library = Library::with_history(history.clone());
        let info = library.open(file.path()).unwrap();
        library.remove_recent(&info.path).unwrap();
        assert!(Library::with_history(history).recent.is_empty());
        assert_eq!(
            library.remove_recent(&info.path).unwrap_err(),
            "not_in_recent"
        );
    }

    #[test]
    fn recent_view_computes_existence_without_persisting_it() {
        let file = pdf();
        let mut library = Library::default();
        let info = library.open(file.path()).unwrap();
        library.recent.push(RecentFile {
            name: "missing.pdf".into(),
            path: format!("{}.missing", info.path),
            position: None,
        });

        let recent = library.recent_documents();
        assert!(recent[0].exists);
        assert!(!recent[1].exists);
        let persisted = serde_json::to_value(&library.recent).unwrap();
        assert!(persisted[0].get("exists").is_none());
    }

    #[test]
    fn session_roundtrip_restores_paths_active_and_missing_errors() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("recent.json");
        let first = pdf();
        let second = pdf();
        let mut library = Library::with_history(history.clone());
        let first_info = library.open(first.path()).unwrap();
        let second_info = library.open(second.path()).unwrap();
        let missing = dir.path().join("missing.pdf");
        library
            .save_session(
                &[first_info.id.clone(), second_info.id.clone()],
                Some(&second_info.id),
            )
            .unwrap();

        let mut restored = Library::with_history(history.clone());
        let batch = restored.restore_session();
        assert_eq!(batch.documents.len(), 2);
        assert_eq!(batch.active.as_deref(), Some(second_info.path.as_str()));

        restored
            .persist_session(&SavedSession {
                paths: vec![first_info.path, missing.to_string_lossy().into_owned()],
                active: Some(second_info.path.clone()),
            })
            .unwrap();
        let mut restored = Library::with_history(history);
        let batch = restored.restore_session();
        assert_eq!(batch.errors.len(), 1);
        assert_eq!(batch.errors[0].code, "file_not_found");
    }

    #[test]
    fn bookmarks_validate_and_persist_independently() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("recent.json");
        let file = pdf();
        let mut library = Library::with_history(history.clone());
        let info = library.open(file.path()).unwrap();
        assert_eq!(
            library.save_bookmarks(
                &info.id,
                vec![Bookmark {
                    page: 0,
                    label: "bad".into(),
                }]
            ),
            Err("invalid_bookmark".into())
        );
        assert_eq!(
            library.save_bookmarks(
                &info.id,
                vec![Bookmark {
                    page: 1,
                    label: "x".repeat(201),
                }]
            ),
            Err("invalid_bookmark".into())
        );
        let saved = Bookmark {
            page: 3,
            label: "Chapter".into(),
        };
        library
            .save_bookmarks(&info.id, vec![saved.clone()])
            .unwrap();

        let mut reopened = Library::with_history(history);
        let reopened_info = reopened.open(file.path()).unwrap();
        let loaded = reopened.bookmarks(&reopened_info.id).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].page, saved.page);
        assert_eq!(loaded[0].label, saved.label);
    }

    #[test]
    fn bookmarks_evict_the_oldest_file_above_the_cap() {
        let mut library = Library::default();
        for index in 0..=MAX_BOOKMARK_FILES {
            library.bookmark_store.insert(
                format!("path-{index:03}"),
                BookmarkEntry {
                    bookmarks: Vec::new(),
                    touched: index as u64,
                },
            );
        }
        library.trim_bookmarks();
        assert_eq!(library.bookmark_store.len(), MAX_BOOKMARK_FILES);
        assert!(!library.bookmark_store.contains_key("path-000"));
        assert!(library.bookmark_store.contains_key("path-500"));
    }

    #[test]
    fn changed_file_requires_two_stable_polls_and_invalid_content_is_ignored() {
        let file = pdf();
        let mut library = Library::default();
        let info = library.open(file.path()).unwrap();
        fs::write(file.path(), b"%PDF-updated contents").unwrap();
        assert!(library.detect_changes().is_empty());
        let changed = library.detect_changes();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].id, info.id);
        assert_eq!(changed[0].size, 21);

        fs::write(file.path(), b"not a pdf").unwrap();
        assert!(library.detect_changes().is_empty());
        assert!(library.detect_changes().is_empty());
    }
}

#[cfg(test)]
mod save_copy_tests {
    use super::*;
    use std::io::Write;

    fn pdf() -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"%PDF-1.7\nsource\n%%EOF").unwrap();
        file
    }

    #[test]
    fn refuses_source_path_and_non_pdf_data() {
        let source = pdf();
        let mut library = Library::default();
        let info = library.open(source.path()).unwrap();
        assert_eq!(
            library.issue_save_token(&info.id, source.path()),
            Err("cannot_overwrite_original".into())
        );
        assert_eq!(
            validate_saved_copy(source.path(), Path::new("/tmp/copy.pdf"), b"not a PDF"),
            Err("not_pdf".into())
        );
    }

    #[test]
    fn save_token_is_single_use_and_saved_file_is_added_to_recent_history() {
        let source = pdf();
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("annotated.pdf");
        let mut library = Library::default();
        let info = library.open(source.path()).unwrap();
        let token = library.issue_save_token(&info.id, &destination).unwrap();
        let bytes = b"%PDF-1.7\nsaved annotations\n%%EOF";
        assert_eq!(
            library.write_saved_copy(&token, bytes).unwrap(),
            "annotated.pdf"
        );
        assert_eq!(
            library.write_saved_copy(&token, bytes),
            Err("invalid_save_token".into())
        );
        assert_eq!(fs::read(destination).unwrap(), bytes);
        assert_eq!(library.recent[0].name, "annotated.pdf");
    }

    #[test]
    fn writes_through_a_same_directory_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.pdf");
        let destination = directory.path().join("copy.pdf");
        fs::write(&source, b"%PDF-1.7\nsource").unwrap();
        fs::write(&destination, b"%PDF-1.4\nold").unwrap();
        let bytes = b"%PDF-1.7\nreplacement";
        write_saved_copy_atomic(&source, &destination, bytes).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        assert!(!fs::read_dir(directory.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }
}
