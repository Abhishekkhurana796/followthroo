const $ = (id) => document.getElementById(id);

// Stamp the running build straight away, before any storage round-trip, so it
// is visible even when nothing else in this popup manages to load.
try {
  const v = document.getElementById("ver");
  if (v) v.textContent = `v${chrome.runtime.getManifest().version}`;
} catch {
  /* nothing to show; not worth breaking the popup over */
}

function render(cfg) {
  const on = !!cfg.enabled;
  $("toggle").textContent = on ? "Stop" : "Start";
  $("toggle").classList.toggle("on", on);
  $("dot").classList.toggle("on", on && !!cfg.token && !cfg.lastStatusError);
  $("dot").classList.toggle("err", !!cfg.lastStatusError);

  // Reading progress. Only rendered while a scrape is genuinely in flight —
  // a permanently-visible empty progress bar teaches people to ignore it.
  const reading = cfg.reading;
  const readingEl = $("reading");
  if (reading && reading.active) {
    readingEl.style.display = "block";
    $("readingLabel").textContent = reading.label || "Reading LinkedIn…";
    const pct = reading.target ? Math.min(100, Math.round((reading.found / reading.target) * 100)) : 0;
    $("readingBar").style.width = `${pct}%`;
    $("readingCount").textContent = reading.target
      ? `${reading.found || 0} of up to ${reading.target}`
      : `${reading.found || 0} found`;
  } else {
    readingEl.style.display = "none";
  }

  const box = $("status");
  box.style.color = cfg.lastStatusError ? "#b91c1c" : "";
  if (!cfg.token) {
    box.textContent = "Not connected — open Settings to add your token.";
  } else if (cfg.lastStatus) {
    box.textContent = cfg.lastStatus;
  } else if (on) {
    box.textContent = "Starting…";
  } else {
    box.textContent = "Paused. Press Start to find people from LinkedIn.";
  }
}

function load() {
  chrome.storage.local.get(["token", "enabled", "lastStatus", "lastStatusError", "apiBase", "reading"], render);
}

$("toggle").addEventListener("click", () => {
  chrome.storage.local.get(["enabled"], ({ enabled }) => chrome.storage.local.set({ enabled: !enabled }, load));
});
$("settings").addEventListener("click", () => {
  // Open the Options page reliably. openOptionsPage() can no-op if the manifest's
  // options_page wasn't reloaded, so fall back to opening the page URL directly.
  const url = chrome.runtime.getURL("options.html");
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) chrome.tabs.create({ url });
    });
  } else {
    chrome.tabs.create({ url });
  }
  window.close();
});

chrome.storage.onChanged.addListener(load);
load();
