// main.ts — package this entry for submission.
// Copies app/ and screenshots/ beside this file into the output directory and
// writes dossier.json from the vendor dossier builder. Deterministic: no
// timestamps, sorted traversal, byte-identical across runs.

import { buildDossier } from "./vendor/makefun-frontend.ts";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const HERE = import.meta.dirname;
const OUT = resolve(process.env.MAKEFUN_OUTPUT_DIR || "/output");

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
} as const;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(from: string, to: string): Promise<number> {
  let count = 0;
  await mkdir(to, { recursive: true });
  const entries = (await readdir(from, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      count += await copyTree(src, dst);
    } else if (entry.isFile()) {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      count += 1;
    }
  }
  return count;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const appDir = join(HERE, "app");
  if (!(await exists(appDir))) throw new Error("main.ts: app/ is missing beside main.ts");
  const appFiles = await copyTree(appDir, join(OUT, "app"));

  const shotsDir = join(HERE, "screenshots");
  const outShots = join(OUT, "screenshots");
  let shotFiles = 0;
  if (await exists(shotsDir)) {
    shotFiles = await copyTree(shotsDir, outShots);
  } else {
    await mkdir(outShots, { recursive: true });
  }

  let dossierWritten = false;
  if (shotFiles > 0) {
    const dossier = buildDossier(OUT, CAPS);
    await writeFile(join(OUT, "dossier.json"), dossier);
    dossierWritten = true;
  } else {
    await writeFile(
      join(OUT, "DOSSIER-PENDING.txt"),
      "No screenshots/ beside main.ts: dossier.json is written once the three screenshots are added.\n",
    );
  }

  console.log(
    "PotScope packaged -> " + OUT + " (" + appFiles + " app files, " + shotFiles + " screenshots" +
    (dossierWritten ? ", dossier.json written" : ", dossier pending screenshots") + ")",
  );
}

await main();
