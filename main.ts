// Packaging entry point: mirrors app/ and screenshots/ into the submission
// output directory and emits dossier.json (or a pending marker when there are
// no screenshots yet). Traversal is sorted and nothing time-dependent is
// written, so repeated runs produce identical bytes.

import { buildDossier } from "./vendor/makefun-frontend.ts";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SOURCE_DIR = import.meta.dirname;
const TARGET_DIR = resolve(process.env.MAKEFUN_OUTPUT_DIR || "/output");

const LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
};

const PENDING_NOTE =
  "No screenshots/ beside main.ts: dossier.json is written once the three screenshots are added.\n";

async function isPresent(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function inventory(root, prefix) {
  const dirs = [];
  const files = [];
  const listing = await readdir(join(root, prefix || ""), { withFileTypes: true });
  const byName = new Map(listing.map((item) => [item.name, item]));
  const names = listing.map((item) => item.name).sort();
  for (const name of names) {
    const relative = prefix ? prefix + "/" + name : name;
    const kind = byName.get(name);
    if (kind.isDirectory()) {
      dirs.push(relative);
      const nested = await inventory(root, relative);
      dirs.push(...nested.dirs);
      files.push(...nested.files);
    } else if (kind.isFile()) {
      files.push(relative);
    }
  }
  return { dirs, files };
}

async function mirror(from, to) {
  const tree = await inventory(from, "");
  await mkdir(to, { recursive: true });
  for (const dir of tree.dirs) {
    await mkdir(join(to, dir), { recursive: true });
  }
  for (const file of tree.files) {
    await copyFile(join(from, file), join(to, file));
  }
  return tree.files.length;
}

async function packageEntry() {
  await mkdir(TARGET_DIR, { recursive: true });

  const appSource = join(SOURCE_DIR, "app");
  if (!(await isPresent(appSource))) {
    throw new Error("main.ts: app/ is missing beside main.ts");
  }
  const appCount = await mirror(appSource, join(TARGET_DIR, "app"));

  const shotsSource = join(SOURCE_DIR, "screenshots");
  const shotsTarget = join(TARGET_DIR, "screenshots");
  let shotCount;
  if (await isPresent(shotsSource)) {
    shotCount = await mirror(shotsSource, shotsTarget);
  } else {
    await mkdir(shotsTarget, { recursive: true });
    shotCount = 0;
  }

  let sealed = false;
  if (shotCount > 0) {
    await writeFile(join(TARGET_DIR, "dossier.json"), buildDossier(TARGET_DIR, LIMITS));
    sealed = true;
  } else {
    await writeFile(join(TARGET_DIR, "DOSSIER-PENDING.txt"), PENDING_NOTE);
  }

  const tally =
    "PotScope packaged -> " +
    TARGET_DIR +
    " (" +
    appCount +
    " app files, " +
    shotCount +
    " screenshots" +
    (sealed ? ", dossier.json written" : ", dossier pending screenshots") +
    ")";
  console.log(tally);
}

await packageEntry();
