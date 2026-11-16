// PotScope entrypoint: package the static frontend and its screenshots into the
// output directory and write the dossier the scorer reads.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Node 22, standard library only. The copy walk is sorted and copies bytes, so
// two runs against the same repository produce identical output.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const REPOSITORY_ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIRECTORY = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const APP_SOURCE = join(REPOSITORY_ROOT, 'app');
const SHOTS_SOURCE = join(REPOSITORY_ROOT, 'screenshots');

const DOSSIER_LIMITS = {
  text_max_bytes: 163_840,
  screenshots: { max: 3, max_bytes: 262_144 },
  app_max_files: 993,
  app_max_bytes: 16_777_216,
};

type CopyTally = { files: number; bytes: number };

function listEntriesSorted(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// Recursively copy one source tree to one destination tree, visiting names in
// sorted order and writing the same bytes the source holds. Symbolic links and
// other special files are skipped: the submission gate refuses them anyway.
function copyTree(source: string, destination: string, tally: CopyTally): void {
  mkdirSync(destination, { recursive: true });
  for (const name of listEntriesSorted(source)) {
    const sourcePath = join(source, name);
    const destinationPath = join(destination, name);
    const stats = statSync(sourcePath);
    if (stats.isDirectory()) {
      copyTree(sourcePath, destinationPath, tally);
    } else if (stats.isFile()) {
      copyFileSync(sourcePath, destinationPath);
      tally.files += 1;
      tally.bytes += stats.size;
    }
  }
}

function describeRepositoryPath(path: string): string {
  const shown = relative(REPOSITORY_ROOT, path) || '.';
  return shown.split('\\').join('/');
}

function hasScreenshots(): boolean {
  if (!existsSync(SHOTS_SOURCE)) return false;
  return listEntriesSorted(SHOTS_SOURCE).some((name) => {
    const stats = statSync(join(SHOTS_SOURCE, name));
    return stats.isFile();
  });
}

function writePendingNote(appTally: CopyTally, shotTally: CopyTally): void {
  const lines = [
    'PotScope dossier pending',
    '',
    'No screenshots were present when this package was built, so no dossier.json',
    'was written. Add three screenshots under screenshots/ and run the entrypoint',
    'again to produce the dossier.',
    '',
    `app files: ${appTally.files}`,
    `app bytes: ${appTally.bytes}`,
    `screenshot files: ${shotTally.files}`,
    `screenshot bytes: ${shotTally.bytes}`,
    '',
  ];
  writeFileSync(join(OUTPUT_DIRECTORY, 'dossier-pending.txt'), lines.join('\n'));
}

function packageRepository(): void {
  if (!existsSync(APP_SOURCE)) {
    throw new Error(`the app directory is missing at ${describeRepositoryPath(APP_SOURCE)}`);
  }

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

  const appTally: CopyTally = { files: 0, bytes: 0 };
  const shotTally: CopyTally = { files: 0, bytes: 0 };

  const appDestination = join(OUTPUT_DIRECTORY, 'app');
  rmSync(appDestination, { recursive: true, force: true });
  copyTree(APP_SOURCE, appDestination, appTally);

  const shotsDestination = join(OUTPUT_DIRECTORY, 'screenshots');
  rmSync(shotsDestination, { recursive: true, force: true });
  mkdirSync(shotsDestination, { recursive: true });
  const screenshotsReady = hasScreenshots();
  if (screenshotsReady) copyTree(SHOTS_SOURCE, shotsDestination, shotTally);

  const pendingPath = join(OUTPUT_DIRECTORY, 'dossier-pending.txt');
  const dossierPath = join(OUTPUT_DIRECTORY, 'dossier.json');

  if (!screenshotsReady) {
    writePendingNote(appTally, shotTally);
    if (existsSync(dossierPath)) rmSync(dossierPath);
    console.log(
      `packaged ${appTally.files} app files (${appTally.bytes} bytes) and ${shotTally.files} screenshots; dossier pending (no screenshots yet)`,
    );
    return;
  }

  writeFileSync(dossierPath, buildDossier(OUTPUT_DIRECTORY, DOSSIER_LIMITS));
  if (existsSync(pendingPath)) rmSync(pendingPath);
  const dossierBytes = statSync(dossierPath).size;
  console.log(
    `packaged ${appTally.files} app files (${appTally.bytes} bytes), ${shotTally.files} screenshots (${shotTally.bytes} bytes), dossier ${dossierBytes} bytes`,
  );
}

try {
  packageRepository();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`packaging failed: ${message}`);
  process.exitCode = 1;
}
