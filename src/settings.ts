export type ThemeChoice = 'system' | 'light' | 'dark';

const THEME_KEY = 'pdfreader.theme';
const INVERT_KEY = 'pdfreader.invertPages';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme(): ThemeChoice {
  const value = localStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyTheme() {
  const choice = storedTheme();
  const theme = choice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = theme;
  document.documentElement.toggleAttribute('data-invert-pages', localStorage.getItem(INVERT_KEY) === 'true');
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-checked', String(button.dataset.themeChoice === choice));
  });
}

export function setTheme(choice: ThemeChoice) {
  if (choice === 'system') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, choice);
  applyTheme();
}

function setupSettingsMenu() {
  const toggle = document.getElementById('settings-toggle') as HTMLButtonElement;
  const menu = document.getElementById('settings-menu') as HTMLDivElement;
  const invert = document.getElementById('invert-pages') as HTMLInputElement;
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !(event.target as Element).closest('.menu-anchor')) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  menu.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button => {
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice as ThemeChoice));
  });
  invert.checked = localStorage.getItem(INVERT_KEY) === 'true';
  invert.addEventListener('change', () => {
    localStorage.setItem(INVERT_KEY, String(invert.checked));
    applyTheme();
  });
}

applyTheme();
darkQuery.addEventListener('change', applyTheme);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupSettingsMenu);
else setupSettingsMenu();
