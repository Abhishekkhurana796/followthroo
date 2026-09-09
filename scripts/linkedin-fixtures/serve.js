/**
 * Run the real content script against known LinkedIn markup.
 *
 *   node scripts/linkedin-fixtures/serve.js
 *   → http://127.0.0.1:4599/modern.html   current markup (attribute hooks, no entity-result classes)
 *   → http://127.0.0.1:4599/legacy.html   the older classes, as a regression check
 *
 * Then in the page console:
 *
 *   window.chrome = { storage: { local: { get: (k, cb) => cb({ apiBase: "x", token: "y" }), set: (o, cb) => cb && cb() } },
 *                     runtime: { getManifest: () => ({ version: "dev" }) } };
 *   const s = document.createElement("script"); s.src = "/ext/content.js"; document.head.appendChild(s);
 *
 * The bar should report 3 people on both pages. If it reports "Found 3, read
 * none", the name or subtitle selectors have gone stale again — which is the
 * exact failure these fixtures exist to catch, because LinkedIn retires class
 * names without notice and a silent zero looks identical to an empty search.
 *
 * Deliberately dependency-free: there is no jsdom in this repo and adding one
 * to run two files is not worth the weight.
 *
 * These live under scripts/ rather than inside extension/ because Chrome refuses
 * to load an extension containing any file or directory whose name starts with
 * an underscore — they are reserved. Putting them in extension/__fixtures__ made
 * the whole extension unloadable, which is a silent failure until somebody tries
 * to reload it.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FIXTURES = __dirname;
const EXT = path.join(__dirname, "..", "..", "extension");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
// Overridable so a stale server on the default port cannot masquerade as a fresh one.
const PORT = Number(process.env.PORT) || 4599;

http
  .createServer((req, res) => {
    const url = req.url.split("?")[0];
    const file = url.startsWith("/ext/")
      ? path.join(EXT, url.slice("/ext/".length))
      : path.join(FIXTURES, url === "/" ? "modern.html" : url);
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end("not found: " + file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
      res.end(buf);
    });
  })
  .listen(PORT, () => console.log(`fixtures on http://127.0.0.1:${PORT} (modern.html / legacy.html)`));
