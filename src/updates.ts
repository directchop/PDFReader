import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import * as bridge from './bridge';
import { $, button, input, message, notify } from './dom';
import { t } from './i18n';
import { shouldAutoCheck } from './update-policy';
import { saveAsCopy } from './annotations';
import { flushPosition, flushSession } from './tabs';
import { requestUnsavedChoice } from './unsaved';
import { tabs } from './state';

const UPDATE_CHECK_KEY = 'pdfreader.updateCheck';
const LAST_UPDATE_CHECK_KEY = 'pdfreader.lastUpdateCheck';

let currentUpdate: bridge.UpdateInfo | undefined;
let checking = false;
let installing = false;
let currentVersion = '';

function lastCheckTime() {
  try {
    const stored = localStorage.getItem(LAST_UPDATE_CHECK_KEY);
    if (stored === null) return null;
    const timestamp = Number(stored);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function renderVersion() {
  $('app-version').textContent = t('settings.version', { version: currentVersion });
}

function setUpdateDialogOpen(open: boolean) {
  const dialog = $<HTMLDialogElement>('update-dialog');
  if (open && !dialog.open) dialog.showModal();
  else if (!open && dialog.open) dialog.close();
}

function showUpdate(update: bridge.UpdateInfo) {
  currentUpdate = update;
  $('update-title').textContent = t('update.title', { version: update.version });
  $('update-notes').textContent = (update.notes ?? '').slice(0, 2000);
  const date = $('update-date');
  date.textContent = update.date ?? '';
  date.hidden = !update.date;
  $('update-progress').hidden = true;
  $('update-progress-text').hidden = true;
  button('update-install').disabled = false;
  setUpdateDialogOpen(true);
}

function saveLastCheck(now: number) {
  try {
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(now));
  } catch {
  }
}

async function checkForUpdates(manual: boolean) {
  if (checking || installing) return;
  checking = true;
  button('check-updates').disabled = true;
  saveLastCheck(Date.now());
  try {
    const update = await bridge.checkUpdate();
    if (update) showUpdate(update);
    else if (manual) notify(t('update.latest'));
  } catch (error) {
    if (manual) notify(message(error));
  } finally {
    checking = false;
    button('check-updates').disabled = false;
  }
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showProgress(progress: bridge.UpdateProgress) {
  const bar = $<HTMLProgressElement>('update-progress');
  bar.hidden = false;
  if (progress.total && progress.total > 0) {
    bar.max = progress.total;
    bar.value = Math.min(progress.downloaded, progress.total);
    $('update-progress-text').textContent = t('update.progress', {
      downloaded: formatBytes(progress.downloaded),
      total: formatBytes(progress.total),
    });
  } else {
    bar.removeAttribute('value');
    bar.max = 1;
    $('update-progress-text').textContent = t('update.downloading');
  }
  $('update-progress-text').hidden = false;
}

async function installAvailableUpdate() {
  if (!currentUpdate || installing) return;
  setUpdateDialogOpen(false);
  const modified = tabs.filter(tab => tab.modified);
  if (modified.length) {
    const choice = await requestUnsavedChoice(modified);
    if (choice === 'cancel') {
      setUpdateDialogOpen(true);
      return;
    }
    if (choice === 'save') {
      for (const tab of modified) {
        if (!await saveAsCopy(tab)) {
          setUpdateDialogOpen(true);
          return;
        }
      }
    }
  }
  try {
    await Promise.all(tabs.map(tab => flushPosition(tab)));
    await flushSession();
  } catch (error) {
    notify(message(error));
    setUpdateDialogOpen(true);
    return;
  }

  installing = true;
  button('update-install').disabled = true;
  button('update-later').disabled = true;
  $('update-progress').hidden = false;
  $('update-progress-text').hidden = false;
  $('update-progress-text').textContent = t('update.downloading');
  setUpdateDialogOpen(true);
  try {
    const unlisten = await listen<bridge.UpdateProgress>('update-progress', event => showProgress(event.payload));
    try {
      await bridge.installUpdate();
    } finally {
      unlisten();
    }
  } catch (error) {
    notify(message(error));
    installing = false;
    button('update-install').disabled = false;
    button('update-later').disabled = false;
    $('update-progress').hidden = true;
    $('update-progress-text').hidden = true;
    setUpdateDialogOpen(true);
  }
}

export async function initializeUpdateSettings() {
  const section = $('updates-section');
  if (!bridge.desktop) return;
  try {
    if (!await bridge.updateAvailableInBuild()) return;
    currentVersion = await getVersion();
    renderVersion();
    section.hidden = false;
  } catch {
    return;
  }

  const enabled = input('update-check');
  try {
    enabled.checked = localStorage.getItem(UPDATE_CHECK_KEY) === 'true';
  } catch {
    enabled.checked = false;
  }
  enabled.addEventListener('change', () => {
    try {
      localStorage.setItem(UPDATE_CHECK_KEY, String(enabled.checked));
    } catch {
    }
  });
  button('check-updates').onclick = () => { void checkForUpdates(true); };
  button('update-later').onclick = () => setUpdateDialogOpen(false);
  button('update-install').onclick = () => { void installAvailableUpdate(); };
  window.addEventListener('localechange', renderVersion);

  window.setTimeout(() => {
    if (shouldAutoCheck(enabled.checked, lastCheckTime(), Date.now())) {
      void checkForUpdates(false);
    }
  }, 10_000);
}
