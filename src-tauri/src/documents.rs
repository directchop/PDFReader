use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub const MAX_READ: u64 = 4 * 1024 * 1024;
pub const MAX_DOCUMENT: u64 = 1024 * 1024 * 1024;
pub const MAX_OPEN: usize = 12;

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
}

impl Library {
    pub fn with_history(path: PathBuf) -> Self {
        let recent: Vec<RecentFile> = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default();
        Self {
            recent: recent.into_iter().take(12).collect(),
            session_file: path.parent().map(|dir| dir.join("session.json")),
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
                paths: vec![
                    first_info.path,
                    missing.to_string_lossy().into_owned(),
                ],
                active: Some(second_info.path.clone()),
            })
            .unwrap();
        let mut restored = Library::with_history(history);
        let batch = restored.restore_session();
        assert_eq!(batch.errors.len(), 1);
        assert_eq!(batch.errors[0].code, "file_not_found");
    }
}
