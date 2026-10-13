import { run } from '@tauri-apps/cli';
// Tauri on Windows requires MSVC even when the user's default Rust host is GNU.
// This affects only this process; it does not change the global rustup default.
if (process.platform === 'win32' && !process.env.RUSTUP_TOOLCHAIN) {
  process.env.RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc';
}
const args = process.argv.slice(2);
if (args[0] === 'build' && !args.includes('--bundles') && !args.includes('--no-bundle')) {
  args.push('--bundles', process.platform === 'darwin' ? 'dmg,app' : 'nsis');
}
try { await run(args, 'tauri'); } catch (error) { console.error(error); process.exitCode = 1; }
