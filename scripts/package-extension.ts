/**
 * Validate and package the Chrome extension for the Web Store.
 *
 *   npx tsx scripts/package-extension.ts          # validate only
 *   npx tsx scripts/package-extension.ts --zip    # validate, then write the upload
 *
 * The checks are the ones that actually get listings rejected: missing icons, a
 * permission you cannot justify, a localhost host permission on a published
 * extension, and remotely-hosted code. Better to fail here than three days into
 * a review queue.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIR = path.join(process.cwd(), "extension");
const zip = process.argv.includes("--zip");

let failures = 0;
const check = (cond: boolean, label: string, extra = "") => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};

/** Files that go in the upload. Anything else in extension/ is left out. */
const SHIPPED = [
  "manifest.json",
  "background.js",
  "scrapers.js",
  "content.js",
  "detect.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));

  check(manifest.manifest_version === 3, "manifest v3 (v2 is no longer accepted)");
  check(!!manifest.name && manifest.name.length <= 75, "name within 75 chars", manifest.name);
  check(
    !!manifest.description && manifest.description.length <= 132,
    "description within 132 chars",
    `${manifest.description?.length ?? 0}`,
  );
  check(/^\d+(\.\d+){1,3}$/.test(manifest.version), "version is dotted numeric", manifest.version);
  check(
    !!manifest.icons && ["16", "32", "48", "128"].every((s) => manifest.icons[s]),
    "all four icon sizes declared",
  );

  // Least privilege. Each of these is a question a reviewer will ask.
  check(!(manifest.permissions ?? []).includes("tabs"), "does not request `tabs`");
  check(!(manifest.permissions ?? []).includes("<all_urls>"), "does not request all-URL access");
  check(
    !JSON.stringify(manifest.host_permissions ?? []).includes("localhost"),
    "localhost is not a granted host permission",
  );

  for (const rel of SHIPPED) {
    check(fs.existsSync(path.join(DIR, rel)), `present: ${rel}`);
  }

  /**
   * Chrome refuses to load an extension containing ANY file or directory whose
   * name begins with an underscore — those are reserved for `_locales` and
   * friends. It is not a warning and not a partial load: the whole extension is
   * rejected with "Could not load manifest."
   *
   * This check exists because that happened. Test fixtures were added at
   * `extension/__fixtures__/`, and from that commit onward the extension could
   * not be loaded at all — so a shipped fix sat there looking broken, because
   * the reload that would have picked it up was the thing failing. Every other
   * check in this file passed the whole time.
   */
  const reserved: string[] = [];
  const walk = (dir: string, rel = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const here = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name.startsWith("_") && entry.name !== "_locales") reserved.push(here);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), here);
    }
  };
  walk(DIR);
  check(
    reserved.length === 0,
    reserved.length
      ? `no reserved "_" names — found ${reserved.join(", ")}, which makes Chrome refuse the whole extension`
      : "no reserved \"_\" names in the package",
  );

  // Remote code is the single most common rejection for extensions like this.
  const js = ["background.js", "popup.js", "options.js", "scrapers.js"]
    .map((f) => fs.readFileSync(path.join(DIR, f), "utf8"))
    .join("\n");
  check(!/\beval\s*\(/.test(js), "no eval()");
  check(!/new Function\s*\(/.test(js), "no new Function()");

  const html = ["popup.html", "options.html"]
    .map((f) => fs.readFileSync(path.join(DIR, f), "utf8"))
    .join("\n");
  check(!/<script[^>]+src=["']https?:/i.test(html), "no remotely-hosted scripts");

  if (failures > 0) {
    console.log(`\n${failures} problem(s) — fix before uploading.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");

  if (!zip) {
    console.log("Run with --zip to produce the upload.");
    return;
  }

  const out = path.join(process.cwd(), `followthroo-linkedin-${manifest.version}.zip`);
  fs.rmSync(out, { force: true });
  writeZip(out, SHIPPED.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(DIR, rel)) })));

  console.log(`
Wrote ${path.basename(out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
  console.log("Upload at https://chrome.google.com/webstore/devconsole");
  console.log("Privacy policy URL: https://followthroo.com/extension-privacy");
}

/**
 * Minimal ZIP writer.
 *
 * Shelling out to PowerShell or `zip` fails depending on which shell this is run
 * from, and the first attempt did exactly that. Forty lines of well-specified
 * format beats a dependency on the host's tooling — and gets the one detail that
 * matters right: entries are stored at the archive ROOT. Zipping the folder
 * itself puts manifest.json one level down, which the Web Store rejects.
 */
function writeZip(dest: string, files: { name: string; data: Buffer }[]) {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    // Forward slashes regardless of platform — the spec requires it.
    const name = Buffer.from(file.name.split(path.sep).join("/"), "utf8");
    const deflated = zlib.deflateRawSync(file.data, { level: 9 });
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01 is invalid; any valid date works)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(file.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(dest, Buffer.concat([...chunks, centralBuf, end]));
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

main();
