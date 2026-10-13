import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [command, tag] = process.argv.slice(2);

function cargoPackageVersion(source) {
  let inPackage = false;
  for (const line of source.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      inPackage = section[1] === 'package';
      continue;
    }
    if (inPackage) {
      const version = /^\s*version\s*=\s*"([^"]+)"/.exec(line);
      if (version) return version[1];
    }
  }
  throw new Error('Could not read the package version from src-tauri/Cargo.toml.');
}

function checkVersion() {
  const releaseVersion = tag.replace(/^v/, '');
  const versions = {
    'package.json': JSON.parse(readFileSync('package.json', 'utf8')).version,
    'src-tauri/tauri.conf.json': JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version,
    'src-tauri/Cargo.toml': cargoPackageVersion(readFileSync('src-tauri/Cargo.toml', 'utf8')),
  };
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== releaseVersion)
    .map(([file, version]) => `${file}=${version}`);

  if (!releaseVersion || mismatches.length) {
    throw new Error(
      `Release tag ${tag} (version ${releaseVersion || '(empty)'}) does not match the app versions: ${Object.entries(versions).map(([file, version]) => `${file}=${version}`).join(', ')}.`,
    );
  }
  process.stdout.write(`Release tag ${tag} matches version ${releaseVersion} in all app manifests.\n`);
}

function writeReleaseNotes() {
  const ref = `refs/tags/${tag}`;
  const objectType = execFileSync('git', [
    'for-each-ref',
    ref,
    '--format=%(objecttype)',
  ], { encoding: 'utf8' }).trim();
  const contents = objectType === 'tag'
    ? execFileSync('git', ['for-each-ref', ref, '--format=%(contents)'], { encoding: 'utf8' })
      .replace(/\r?\n+$/, '')
    : '';
  const body = contents.trim() ? contents : `PDFReader ${tag}`;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error('GITHUB_OUTPUT must be set when writing release notes.');

  let delimiter;
  do {
    delimiter = `PDFREADER_RELEASE_NOTES_${randomUUID()}`;
  } while (body.split(/\r?\n/).includes(delimiter));

  appendFileSync(outputPath, `body<<${delimiter}\n${body}\n${delimiter}\n`, 'utf8');
  process.stdout.write(`Read release notes from tag ${tag}.\n`);
}

if (!tag) {
  throw new Error('A release tag is required.');
}

try {
  if (command === 'check-version') checkVersion();
  else if (command === 'release-notes') writeReleaseNotes();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
