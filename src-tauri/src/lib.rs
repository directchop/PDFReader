mod documents;

use documents::{Bookmark, DocumentInfo, Library, OpenBatch, ReadingPosition, RecentFileView};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

type SharedLibrary = Arc<Mutex<Library>>;
const UPDATE_ENDPOINT: &str =
    "https://github.com/directchop/PDFReader/releases/latest/download/latest.json";

#[derive(Default)]
struct UpdateState {
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn updater_key_configured(key: Option<&str>) -> bool {
    key.is_some_and(|key| !key.trim().is_empty())
}

fn updater_pubkey() -> Option<&'static str> {
    let key = option_env!("PDFREADER_UPDATER_PUBKEY");
    updater_key_configured(key).then_some(key).flatten()
}

#[tauri::command]
async fn check_update(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<UpdateInfo>, String> {
    let Some(key) = updater_pubkey() else {
        return Err("updater_unavailable".into());
    };
    let endpoint = UPDATE_ENDPOINT
        .parse()
        .map_err(|_| "update_failed".to_string())?;
    let updater = app
        .updater_builder()
        .pubkey(key)
        .endpoints(vec![endpoint])
        .map_err(|_| "update_failed".to_string())?
        .build()
        .map_err(|_| "update_failed".to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|_| "update_failed".to_string())?;
    let Some(update) = update else {
        *state
            .pending
            .lock()
            .map_err(|_| "update_failed".to_string())? = None;
        return Ok(None);
    };
    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    };
    *state
        .pending
        .lock()
        .map_err(|_| "update_failed".to_string())? = Some(update);
    Ok(Some(info))
}

#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    if updater_pubkey().is_none() {
        return Err("updater_unavailable".into());
    }
    let update = state
        .pending
        .lock()
        .map_err(|_| "update_failed".to_string())?
        .take()
        .ok_or_else(|| "update_failed".to_string())?;
    let progress_app = app.clone();
    let mut downloaded = 0u64;
    if update
        .download_and_install(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = progress_app.emit("update-progress", UpdateProgress { downloaded, total });
            },
            || {},
        )
        .await
        .is_err()
    {
        if let Ok(mut pending) = state.pending.lock() {
            *pending = Some(update);
        }
        return Err("update_failed".into());
    }
    app.restart();
}

#[tauri::command]
fn update_available_in_build() -> bool {
    updater_pubkey().is_some()
}

#[tauri::command]
async fn open_documents(state: State<'_, SharedLibrary>) -> Result<OpenBatch, String> {
    let Some(files) = rfd::AsyncFileDialog::new()
        .add_filter("PDF", &["pdf"])
        .pick_files()
        .await
    else {
        return Ok(OpenBatch::default());
    };
    let paths = files.into_iter().map(|f| f.path().to_owned());
    Ok(state.lock().map_err(|e| e.to_string())?.open_many(paths))
}

#[tauri::command]
async fn pick_save_path(
    id: String,
    suggested_name: String,
    state: State<'_, SharedLibrary>,
) -> Result<Option<String>, String> {
    let source = state
        .lock()
        .map_err(|error| error.to_string())?
        .document_path(&id)?;
    let directory = source.parent().unwrap_or_else(|| std::path::Path::new("."));
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_directory(directory)
        .set_file_name(suggested_name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let token = state
        .lock()
        .map_err(|error| error.to_string())?
        .issue_save_token(&id, file.path())?;
    Ok(Some(token))
}

#[tauri::command]
fn write_saved_copy(
    request: tauri::ipc::Request<'_>,
    state: State<'_, SharedLibrary>,
) -> Result<String, String> {
    let token = request
        .headers()
        .get("x-save-token")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "invalid_save_token".to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("invalid_save_token".into());
    };
    state
        .lock()
        .map_err(|error| error.to_string())?
        .write_saved_copy(token, bytes)
}

#[tauri::command]
fn take_pending(state: State<'_, SharedLibrary>) -> Result<OpenBatch, String> {
    Ok(std::mem::take(
        &mut state.lock().map_err(|e| e.to_string())?.pending,
    ))
}

#[tauri::command]
fn save_session(
    ids: Vec<String>,
    active: Option<String>,
    state: State<'_, SharedLibrary>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .save_session(&ids, active.as_deref())
}

#[tauri::command]
fn restore_session(state: State<'_, SharedLibrary>) -> Result<OpenBatch, String> {
    Ok(state.lock().map_err(|e| e.to_string())?.restore_session())
}

#[tauri::command]
fn bookmarks(id: String, state: State<'_, SharedLibrary>) -> Result<Vec<Bookmark>, String> {
    state.lock().map_err(|e| e.to_string())?.bookmarks(&id)
}

#[tauri::command]
fn save_bookmarks(
    id: String,
    bookmarks: Vec<Bookmark>,
    state: State<'_, SharedLibrary>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .save_bookmarks(&id, bookmarks)
}

#[tauri::command]
fn recent_documents(state: State<'_, SharedLibrary>) -> Result<Vec<RecentFileView>, String> {
    Ok(state.lock().map_err(|e| e.to_string())?.recent_documents())
}

#[tauri::command]
async fn reopen_recent(
    path: String,
    state: State<'_, SharedLibrary>,
) -> Result<DocumentInfo, String> {
    let mut library = state.lock().map_err(|e| e.to_string())?;
    if !library.recent.iter().any(|r| r.path == path) {
        return Err("not_in_recent".into());
    }
    library.open(&PathBuf::from(path))
}

#[tauri::command]
fn clear_recent(state: State<'_, SharedLibrary>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.clear_history()
}

#[tauri::command]
fn remove_recent(path: String, state: State<'_, SharedLibrary>) -> Result<(), String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .remove_recent(&path)
}

#[tauri::command]
fn save_position(
    id: String,
    position: ReadingPosition,
    state: State<'_, SharedLibrary>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .save_position(&id, position)
}

#[tauri::command]
async fn read_document_range(
    id: String,
    generation: u64,
    begin: u64,
    end: u64,
    state: State<'_, SharedLibrary>,
) -> Result<tauri::ipc::Response, String> {
    let file = state
        .lock()
        .map_err(|e| e.to_string())?
        .reader(&id, generation, begin, end)?;
    let bytes =
        tauri::async_runtime::spawn_blocking(move || documents::read_range(file, begin, end))
            .await
            .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn commit_generation(
    id: String,
    generation: u64,
    state: State<'_, SharedLibrary>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .commit_generation(&id, generation)
}

#[tauri::command]
fn close_document(id: String, state: State<'_, SharedLibrary>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.close(&id);
    Ok(())
}

#[tauri::command]
fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_fullscreen(window: tauri::WebviewWindow, fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}

fn queue_paths(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if let Ok(mut lib) = app.state::<SharedLibrary>().lock() {
        lib.queue(paths);
    }
    let _ = app.emit("documents-ready", ());
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    if let Some(key) = updater_pubkey() {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key).build());
    }
    let app = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            queue_paths(
                app,
                args.into_iter()
                    .skip(1)
                    .filter(|p| !p.starts_with('-'))
                    .map(PathBuf::from)
                    .collect(),
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let mut library = Library::with_history(dir.join("recent.json"));
            library.queue(
                std::env::args_os()
                    .skip(1)
                    .filter(|p| !p.to_string_lossy().starts_with('-'))
                    .map(PathBuf::from),
            );
            app.manage(Arc::new(Mutex::new(library)));
            app.manage(UpdateState::default());
            let library = app.state::<SharedLibrary>().inner().clone();
            let handle = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(1500));
                let changed = match library.lock() {
                    Ok(mut library) => library.detect_changes(),
                    Err(error) => {
                        eprintln!("Could not check open files: {error}");
                        continue;
                    }
                };
                for info in changed {
                    let _ = handle.emit("document-changed", info);
                }
            });
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("Missing window configuration")?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(|url| {
                    let production = (url.scheme() == "tauri"
                        && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
                    let development = cfg!(debug_assertions)
                        && url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(1420);
                    production || development
                })
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                queue_paths(window.app_handle(), paths.clone());
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_documents,
            pick_save_path,
            write_saved_copy,
            take_pending,
            save_session,
            restore_session,
            bookmarks,
            save_bookmarks,
            recent_documents,
            reopen_recent,
            clear_recent,
            remove_recent,
            save_position,
            read_document_range,
            commit_generation,
            check_update,
            install_update,
            update_available_in_build,
            close_document,
            print_document,
            set_fullscreen
        ])
        .build(tauri::generate_context!())
        .expect("PDFReader could not start");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            queue_paths(
                app,
                urls.into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .collect(),
            );
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

#[cfg(test)]
mod updater_tests {
    use super::updater_key_configured;

    #[test]
    fn updater_is_enabled_only_for_a_nonempty_public_key() {
        assert!(!updater_key_configured(None));
        assert!(!updater_key_configured(Some("")));
        assert!(!updater_key_configured(Some(" \t")));
        assert!(updater_key_configured(Some("public-key")));
    }
}
