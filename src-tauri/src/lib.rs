mod documents;

use documents::{DocumentInfo, Library, OpenBatch, ReadingPosition, RecentFileView};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager, State};

type SharedLibrary = Mutex<Library>;

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
fn take_pending(state: State<'_, SharedLibrary>) -> Result<OpenBatch, String> {
    Ok(std::mem::take(
        &mut state.lock().map_err(|e| e.to_string())?.pending,
    ))
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
    begin: u64,
    end: u64,
    state: State<'_, SharedLibrary>,
) -> Result<tauri::ipc::Response, String> {
    let file = state
        .lock()
        .map_err(|e| e.to_string())?
        .reader(&id, begin, end)?;
    let bytes =
        tauri::async_runtime::spawn_blocking(move || documents::read_range(file, begin, end))
            .await
            .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
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

fn queue_paths(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if let Ok(mut lib) = app.state::<SharedLibrary>().lock() {
        lib.queue(paths);
    }
    let _ = app.emit("documents-ready", ());
}

pub fn run() {
    let app = tauri::Builder::default()
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
            app.manage(Mutex::new(library));
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
            take_pending,
            recent_documents,
            reopen_recent,
            clear_recent,
            remove_recent,
            save_position,
            read_document_range,
            close_document,
            print_document
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
