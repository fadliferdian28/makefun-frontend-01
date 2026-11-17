/**
 * PotScope submission entrypoint.
 *
 * Copies this repository's app/ and screenshots/ folders into the output
 * directory the scorer hands us, then writes the dossier with the kit's
 * vendored builder. The copy is deterministic: a sorted walk, byte-identical
 * contents and no timestamps, so two runs produce two identical trees.
 *
 * Run it with `MAKEFUN_OUTPUT_DIR=out node main.ts`; the grader sets
 * MAKEFUN_OUTPUT_DIR to /output.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_ROOT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const APP_DIRECTORY = 'app';
const SCREENSHOT_DIRECTORY = 'screenshots';
const PENDING_FILE = 'dossier-pending.txt';
const DOSSIER_FILE = 'dossier.json';

const APP_MAX_FILES = 993;
const APP_MAX_BYTES = 16_777_216;
const SCREENSHOT_MAX = 3;
const SCREENSHOT_MAX_BYTES = 262_144;
const TEXT_MAX_BYTES = 163_840;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

/** @typedef {{relativePath: string, bytes: number}} CopiedFile */

/**
 * Every file below a directory, depth first in sorted order so the walk is
 * the same on every machine.
 * @param {string} directory Absolute directory to walk.
 * @returns {string[]} Absolute file paths, sorted.
 */
function listFilesSorted(directory: string): string[] {
  /** @type {string[]} */
  const files: string[] = [];
  for (const name of readdirSync(directory).sort(compareNames)) {
    const full = join(directory, name);
    const stats = statSync(full, { throwIfNoEntry: false });
    if (!stats) continue;
    if (stats.isDirectory()) {
      files.push(...listFilesSorted(full));
    } else if (stats.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Copy one file's bytes to the output, creating parent folders first.
 * @param {string} source Absolute source path.
 * @param {string} destination Absolute destination path.
 * @returns {number} Bytes written.
 */
function copyFileBytes(source: string, destination: string): number {
  const bytes = readFileSync(source);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  return bytes.byteLength;
}

/**
 * Copy a whole folder with a sorted walk. A missing source still creates the
 * destination, so the output always carries an app/ and a screenshots/ folder.
 * @param {string} sourceDirectory Absolute folder inside the repository.
 * @param {string} destinationDirectory Absolute folder in the output.
 * @returns {CopiedFile[]}
 */
function copyTree(sourceDirectory: string, destinationDirectory: string): CopiedFile[] {
  mkdirSync(destinationDirectory, { recursive: true });
  if (!existsSync(sourceDirectory)) return [];
  /** @type {CopiedFile[]} */
  const copied: CopiedFile[] = [];
  for (const file of listFilesSorted(sourceDirectory)) {
    const target = join(destinationDirectory, relative(sourceDirectory, file));
    const bytes = copyFileBytes(file, target);
    copied.push({ relativePath: relative(REPOSITORY_ROOT, file).split(sep).join('/'), bytes });
  }
  return copied;
}

/**
 * The screenshots the dossier may carry: image files, sorted by name.
 * @param {string} directory Absolute screenshots folder in the output.
 * @returns {string[]} File names, sorted.
 */
function listScreenshots(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => IMAGE_EXTENSIONS.has(extensionOf(name)))
    .sort(compareNames);
}

/** @param {string} name */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * The deterministic stand-in written while the screenshot session has not run
 * yet. It lists the copied files so two runs can be compared byte for byte.
 * @param {CopiedFile[]} appFiles
 * @param {CopiedFile[]} screenshotFiles
 * @returns {string}
 */
function pendingReport(appFiles: CopiedFile[], screenshotFiles: CopiedFile[]): string {
  const appBytes = appFiles.reduce((total, file) => total + file.bytes, 0);
  const shotBytes = screenshotFiles.reduce((total, file) => total + file.bytes, 0);
  const lines = [
    'PotScope dossier pending',
    '',
    'Screenshots are taken in session 3; no dossier.json is written yet.',
    `app files: ${appFiles.length}`,
    `app bytes: ${appBytes}`,
    `screenshots: ${screenshotFiles.length}`,
    `screenshot bytes: ${shotBytes}`,
    '',
    'app/:',
    ...appFiles.map((file) => `${file.bytes}\t${file.relativePath}`),
    '',
  ];
  return lines.join('\n');
}

/** Copy the app, copy what screenshots exist, then hand in the dossier. */
function main(): void {
  mkdirSync(OUTPUT_ROOT, { recursive: true });

  const appFiles = copyTree(join(REPOSITORY_ROOT, APP_DIRECTORY), join(OUTPUT_ROOT, APP_DIRECTORY));
  const screenshotFiles = copyTree(
    join(REPOSITORY_ROOT, SCREENSHOT_DIRECTORY),
    join(OUTPUT_ROOT, SCREENSHOT_DIRECTORY),
  );
  const outputScreenshots = join(OUTPUT_ROOT, SCREENSHOT_DIRECTORY);
  const shots = listScreenshots(outputScreenshots);

  if (shots.length === 0) {
    writeFileSync(join(OUTPUT_ROOT, PENDING_FILE), pendingReport(appFiles, screenshotFiles), 'utf8');
    const appBytes = appFiles.reduce((total, file) => total + file.bytes, 0);
    console.log(
      `Packaged ${appFiles.length} app files (${appBytes} bytes) with no screenshots yet; wrote ${PENDING_FILE}.`,
    );
    return;
  }

  const dossier = buildDossier(OUTPUT_ROOT, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    app_max_files: APP_MAX_FILES,
    app_max_bytes: APP_MAX_BYTES,
  });
  writeFileSync(join(OUTPUT_ROOT, DOSSIER_FILE), dossier);
  console.log(
    `Packaged ${appFiles.length} app files, ${shots.length} screenshot${shots.length === 1 ? '' : 's'}, and wrote ${DOSSIER_FILE}.`,
  );
}

main();
