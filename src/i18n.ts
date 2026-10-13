export type Locale = 'ja' | 'en';
export type LocaleChoice = 'auto' | Locale;

const LOCALE_KEY = 'pdfreader.locale';

const ja = {
  'brand.home': 'ホーム',
  'tabs.open': '開いているPDF',
  'local.badge': 'ローカルで動作',
  'local.browserPreview': 'ブラウザプレビュー',
  'local.status': 'この端末のみ',
  'open.pdf': 'PDFを開く',
  'open.title': 'PDFを開く (Ctrl / ⌘ O)',
  'settings.label': '設定',
  'settings.theme': 'テーマ',
  'settings.system': 'システム',
  'settings.light': 'ライト',
  'settings.dark': 'ダーク',
  'settings.invertTitle': 'ページを暗く表示',
  'settings.invertDescription': 'PDFの白地を反転して目の負担を減らします',
  'settings.locale': '言語',
  'settings.auto': '自動',
  'settings.japanese': '日本語',
  'settings.english': 'English',
  'home.eyebrow': 'YOUR DOCUMENTS. YOUR SPACE.',
  'home.title': '読むことに、',
  'home.titleAccent': '集中しよう。',
  'home.subtitle': 'いつものPDFを、気持ちよく。ファイルはこの端末の中で開かれます。',
  'home.dropHint': 'または、ここにファイルをドロップ',
  'recent.heading': '最近開いたファイル',
  'recent.clear': '履歴を消去',
  'recent.empty': '開いたPDFがここに表示されます。',
  'home.tagline': '閲覧に必要なものを、ひとつに。',
  'home.search': '検索',
  'home.print': '印刷',
  'reader.tools': '閲覧ツール',
  'reader.document': 'PDF文書',
  'reader.opening': 'PDFを開いています…',
  'tab.close': '{name} を閉じる',
  'toolbar.sidebar': 'サイドバーを切り替え',
  'toolbar.previousPage': '前のページ',
  'toolbar.pageNumber': 'ページ番号',
  'toolbar.nextPage': '次のページ',
  'toolbar.zoomOut': '縮小',
  'toolbar.zoom': '表示倍率',
  'toolbar.zoomAuto': '自動',
  'toolbar.zoomWidth': '幅に合わせる',
  'toolbar.zoomFit': 'ページ全体',
  'toolbar.zoomIn': '拡大',
  'toolbar.rotate': '右に回転',
  'toolbar.rotateTitle': '右に90°回転',
  'toolbar.find': '文書内を検索',
  'toolbar.findTitle': '文書内を検索 (Ctrl / ⌘ F)',
  'toolbar.print': '印刷',
  'toolbar.printTitle': '印刷 (Ctrl / ⌘ P)',
  'find.query': '検索文字列',
  'find.placeholder': '文書内を検索',
  'find.previous': '前の検索結果',
  'find.next': '次の検索結果',
  'find.matchCase': '大文字・小文字',
  'find.close': '検索を閉じる',
  'find.noResults': '見つかりません',
  'find.searching': '検索中…',
  'find.count': '{current} / {total} 件',
  'sidebar.pages': 'ページ',
  'sidebar.outline': '目次',
  'sidebar.outlineEmpty': 'このPDFには目次がありません。',
  'sidebar.previous30': '前の30ページ',
  'sidebar.next30': '次の30ページ',
  'sidebar.goToPage': '{page}ページへ',
  'status.loading': '読み込み中…',
  'status.pages': 'ページ',
  'password.title': 'パスワードが必要です',
  'password.prompt': 'このPDFを開くためのパスワードを入力してください。',
  'password.incorrect': 'パスワードが違います。もう一度入力してください。',
  'password.forDocument': '{name} を開くためのパスワードを入力してください。',
  'password.input': 'PDFのパスワード',
  'action.cancel': 'キャンセル',
  'action.open': '開く',
  'print.title': 'PDFを印刷',
  'print.intro': '印刷するページを準備してから、OSの印刷画面を開きます。',
  'print.rangeLabel': 'ページ範囲',
  'print.rangePlaceholder': 'すべて（例: 1-3, 5）',
  'print.rangeNote': '1回につき100ページまで。用紙サイズ・倍率は印刷画面で確認できます。',
  'print.submit': '印刷へ進む',
  'print.preparing': '印刷用ページを準備中 {current} / {total}',
  'print.tooLarge': '印刷データが大きいため、ページ範囲を分けて印刷してください。',
  'print.imageFailed': '印刷画像を生成できませんでした。',
  'print.invalidPageCount': 'ページ数が無効です。',
  'print.invalidRangeFormat': 'ページ範囲を「1-3, 5」の形式で入力してください。',
  'print.pageRangeBounds': '1〜{count}ページの範囲で入力してください。',
  'print.pageLimit': '1回につき100ページまで選択できます。',
  'error.file_not_found': 'ファイルが見つからないか、アクセスできません。',
  'error.cannot_open': 'ファイルを開けません。アクセス権を確認してください。',
  'error.not_a_file': '通常のPDFファイルを選択してください。',
  'error.too_large': '開けるPDFは1 GBまでです。',
  'error.not_pdf': 'PDF形式のファイルではありません。',
  'error.too_many_open': '同時に開けるPDFは12件です。タブを閉じてください。',
  'error.document_closed': 'このPDFは閉じられています。',
  'error.invalid_range': '無効な読み取り範囲です。',
  'error.read_failed': 'PDFの読み取りに失敗しました。ファイルが変更された可能性があります。',
  'error.not_in_recent': '最近使ったファイルの一覧にありません。開くボタンから選択してください。',
  'error.browser_file_too_large': 'ファイルサイズは1 GBまでです。',
  'error.open_pdf': 'PDFを開けませんでした。',
} as const;

const en: Record<keyof typeof ja, string> = {
  'brand.home': 'Home',
  'tabs.open': 'Open PDFs',
  'local.badge': 'Runs locally',
  'local.browserPreview': 'Browser preview',
  'local.status': 'On this device only',
  'open.pdf': 'Open PDF',
  'open.title': 'Open PDF (Ctrl / ⌘ O)',
  'settings.label': 'Settings',
  'settings.theme': 'Theme',
  'settings.system': 'System',
  'settings.light': 'Light',
  'settings.dark': 'Dark',
  'settings.invertTitle': 'Dim PDF pages',
  'settings.invertDescription': 'Invert white PDF pages to reduce eye strain',
  'settings.locale': 'Language',
  'settings.auto': 'Automatic',
  'settings.japanese': '日本語',
  'settings.english': 'English',
  'home.eyebrow': 'YOUR DOCUMENTS. YOUR SPACE.',
  'home.title': 'Make room to',
  'home.titleAccent': 'focus on reading.',
  'home.subtitle': 'A comfortable way to read your PDFs. Files stay on this device.',
  'home.dropHint': 'Or drop a file here',
  'recent.heading': 'Recently opened',
  'recent.clear': 'Clear history',
  'recent.empty': 'PDFs you open will appear here.',
  'home.tagline': 'Everything you need to read, in one place.',
  'home.search': 'Search',
  'home.print': 'Print',
  'reader.tools': 'Reader tools',
  'reader.document': 'PDF document',
  'reader.opening': 'Opening PDF…',
  'tab.close': 'Close {name}',
  'toolbar.sidebar': 'Toggle sidebar',
  'toolbar.previousPage': 'Previous page',
  'toolbar.pageNumber': 'Page number',
  'toolbar.nextPage': 'Next page',
  'toolbar.zoomOut': 'Zoom out',
  'toolbar.zoom': 'Zoom',
  'toolbar.zoomAuto': 'Automatic',
  'toolbar.zoomWidth': 'Page width',
  'toolbar.zoomFit': 'Page fit',
  'toolbar.zoomIn': 'Zoom in',
  'toolbar.rotate': 'Rotate right',
  'toolbar.rotateTitle': 'Rotate 90° right',
  'toolbar.find': 'Find in document',
  'toolbar.findTitle': 'Find in document (Ctrl / ⌘ F)',
  'toolbar.print': 'Print',
  'toolbar.printTitle': 'Print (Ctrl / ⌘ P)',
  'find.query': 'Search text',
  'find.placeholder': 'Find in document',
  'find.previous': 'Previous match',
  'find.next': 'Next match',
  'find.matchCase': 'Match case',
  'find.close': 'Close search',
  'find.noResults': 'No matches',
  'find.searching': 'Searching…',
  'find.count': '{current} / {total}',
  'sidebar.pages': 'Pages',
  'sidebar.outline': 'Outline',
  'sidebar.outlineEmpty': 'This PDF has no outline.',
  'sidebar.previous30': 'Previous 30 pages',
  'sidebar.next30': 'Next 30 pages',
  'sidebar.goToPage': 'Go to page {page}',
  'status.loading': 'Loading…',
  'status.pages': 'pages',
  'password.title': 'Password required',
  'password.prompt': 'Enter the password to open this PDF.',
  'password.incorrect': 'Incorrect password. Try again.',
  'password.forDocument': 'Enter the password to open {name}.',
  'password.input': 'PDF password',
  'action.cancel': 'Cancel',
  'action.open': 'Open',
  'print.title': 'Print PDF',
  'print.intro': 'Prepare the selected pages, then open the system print dialog.',
  'print.rangeLabel': 'Page range',
  'print.rangePlaceholder': 'All pages (e.g. 1-3, 5)',
  'print.rangeNote': 'Up to 100 pages per print job. Check paper size and scale in the print dialog.',
  'print.submit': 'Continue to print',
  'print.preparing': 'Preparing pages to print {current} / {total}',
  'print.tooLarge': 'The print data is too large. Print a smaller page range.',
  'print.imageFailed': 'Could not generate the print image.',
  'print.invalidPageCount': 'Invalid page count.',
  'print.invalidRangeFormat': 'Enter a page range such as 1-3, 5.',
  'print.pageRangeBounds': 'Enter a range between pages 1 and {count}.',
  'print.pageLimit': 'Select no more than 100 pages per print job.',
  'error.file_not_found': 'The file could not be found or accessed.',
  'error.cannot_open': 'Could not open the file. Check its permissions.',
  'error.not_a_file': 'Select a regular PDF file.',
  'error.too_large': 'PDF files must be no larger than 1 GB.',
  'error.not_pdf': 'The file is not a PDF.',
  'error.too_many_open': 'Only 12 PDFs can be open at once. Close a tab first.',
  'error.document_closed': 'This PDF is closed.',
  'error.invalid_range': 'Invalid read range.',
  'error.read_failed': 'Could not read the PDF. The file may have changed.',
  'error.not_in_recent': 'This file is not in recent files. Select it with Open instead.',
  'error.browser_file_too_large': 'Files must be no larger than 1 GB.',
  'error.open_pdf': 'Could not open the PDF.',
};

function storedChoice(): LocaleChoice {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCALE_KEY);
  return stored === 'ja' || stored === 'en' ? stored : 'auto';
}

function resolveLocale(choice: LocaleChoice): Locale {
  if (choice !== 'auto') return choice;
  const language = typeof navigator === 'undefined' ? '' : navigator.language;
  return language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

let locale = resolveLocale(storedChoice());

export function getLocale(): Locale {
  return locale;
}

export function getLocaleChoice(): LocaleChoice {
  return storedChoice();
}

export function t(key: keyof typeof ja, params: Record<string, string | number> = {}) {
  const dictionary = locale === 'ja' ? ja : en;
  return dictionary[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function describeError(error: string) {
  const key = `error.${error}` as keyof typeof ja;
  return Object.hasOwn(ja, key) ? t(key) : error;
}

export function applyTranslations(root: ParentNode = document) {
  if (typeof document === 'undefined') return;
  const elements = <T extends HTMLElement>(selector: string) => {
    const result = [...root.querySelectorAll<T>(selector)];
    if (typeof HTMLElement !== 'undefined' && root instanceof HTMLElement && root.matches(selector)) result.unshift(root as T);
    return result;
  };
  document.documentElement.lang = locale;
  elements<HTMLElement>('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n as keyof typeof ja);
  });
  elements<HTMLElement>('[data-i18n-title]').forEach(element => {
    element.title = t(element.dataset.i18nTitle as keyof typeof ja);
  });
  elements<HTMLElement>('[data-i18n-aria-label]').forEach(element => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel as keyof typeof ja));
  });
  elements<HTMLInputElement>('[data-i18n-placeholder]').forEach(element => {
    element.placeholder = t(element.dataset.i18nPlaceholder as keyof typeof ja);
  });
}

export function setLocale(choice: LocaleChoice) {
  if (typeof localStorage !== 'undefined') {
    if (choice === 'auto') localStorage.removeItem(LOCALE_KEY);
    else localStorage.setItem(LOCALE_KEY, choice);
  }
  locale = resolveLocale(choice);
  if (typeof document !== 'undefined') applyTranslations();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('localechange'));
}
