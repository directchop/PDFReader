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
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub name: String,
    pub path: String,
}

struct OpenDocument {
    info: DocumentInfo,
    file: Arc<Mutex<File>>,
}

#[derive(Default, Serialize)]
pub struct OpenBatch {
    pub documents: Vec<DocumentInfo>,
    pub errors: Vec<String>,
}

#[derive(Default)]
pub struct Library {
    documents: HashMap<String, OpenDocument>,
    pub recent: Vec<RecentFile>,
    pub pending: OpenBatch,
    history_file: Option<PathBuf>,
}

impl Library {
    pub fn with_history(path: PathBuf) -> Self {
        let recent: Vec<RecentFile> = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default();
        Self {
            recent: recent.into_iter().take(12).collect(),
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

    pub fn open(&mut self, path: &Path) -> Result<DocumentInfo, String> {
        let path = path
            .canonicalize()
            .map_err(|_| "ファイルが見つからないか、アクセスできません。".to_string())?;
        let key = path.to_string_lossy().to_string();
        if let Some(doc) = self.documents.values().find(|d| d.info.path == key) {
            return Ok(doc.info.clone());
        }
        if self.documents.len() >= MAX_OPEN {
            return Err("同時に開けるPDFは12件です。タブを閉じてください。".into());
        }
        let mut file = File::open(&path)
            .map_err(|_| "ファイルを開けません。アクセス権を確認してください。".to_string())?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("通常のPDFファイルを選択してください。".into());
        }
        if metadata.len() > MAX_DOCUMENT {
            return Err("初版で開けるPDFは1 GBまでです。".into());
        }
        let mut header = [0u8; 1024];
        let read = file.read(&mut header).map_err(|e| e.to_string())?;
        if !header[..read].windows(5).any(|w| w == b"%PDF-") {
            return Err("PDF形式のファイルではありません。".into());
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let info = DocumentInfo {
            id: Uuid::new_v4().to_string(),
            name: name.clone(),
            path: key.clone(),
            size: metadata.len(),
        };
        self.documents.insert(
            info.id.clone(),
            OpenDocument {
                info: info.clone(),
                file: Arc::new(Mutex::new(file)),
            },
        );
        self.recent.retain(|r| r.path != key);
        self.recent.insert(0, RecentFile { name, path: key });
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
                Err(error) => batch.errors.push(format!(
                    "{}: {error}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                )),
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

    pub fn reader(&self, id: &str, begin: u64, end: u64) -> Result<Arc<Mutex<File>>, String> {
        let doc = self
            .documents
            .get(id)
            .ok_or("このPDFは閉じられています。")?;
        if begin >= end || end > doc.info.size || end - begin > MAX_READ {
            return Err("無効な読み取り範囲です。".into());
        }
        Ok(Arc::clone(&doc.file))
    }
}

pub fn read_range(file: Arc<Mutex<File>>, begin: u64, end: u64) -> Result<Vec<u8>, String> {
    let mut file = file.lock().map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(begin))
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![0; (end - begin) as usize];
    file.read_exact(&mut buffer).map_err(|_| {
        "PDFの読み取りに失敗しました。ファイルが変更された可能性があります。".to_string()
    })?;
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
        assert!(lib.reader("unknown", 0, 1).is_err());
        assert!(lib.reader(&info.id, 5, 4).is_err());
        assert!(lib.reader(&info.id, 0, info.size + 1).is_err());
        assert!(lib.reader(&info.id, 0, MAX_READ + 1).is_err());
        lib.close(&info.id);
        assert!(lib.reader(&info.id, 0, 1).is_err());
    }

    #[test]
    fn deduplicates_and_continues_after_bad_file() {
        let f = pdf();
        let bad = tempfile::NamedTempFile::new().unwrap();
        let mut lib = Library::default();
        let batch = lib.open_many([bad.path().into(), f.path().into(), f.path().into()]);
        assert_eq!(batch.errors.len(), 1);
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
}
