importScripts("shared.js", "zotero.js");

const {normalizeName, normalizeIssn, jcrYear, quartile} = HXPure;
let dbPromise;
let jcrPromise;
let bundledJcrPromise;

function loadBundledJcr() {
  if (!bundledJcrPromise) {
    bundledJcrPromise = fetch(chrome.runtime.getURL("data/jcr.json"))
      .then(response => response.json()).then(data => {
        if (!Array.isArray(data.records)) throw new Error("内置 IF/JCR 数据格式错误");
        return data;
      }).catch(error => { bundledJcrPromise = null; throw error; });
  }
  return bundledJcrPromise;
}

async function loadDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const response = await fetch(chrome.runtime.getURL("data/journals.json"));
      const base = await response.json();
      const byIssn = new Map();
      const byName = new Map();
      for (const rec of base.records) {
        for (const issn of rec.issns) byIssn.set(normalizeIssn(issn), rec);
        byName.set(rec.nameKey || normalizeName(rec.name), rec);
        for (const abbr of rec.abbrs) byName.set(normalizeName(abbr), rec);
      }
      return {byIssn, byName};
    })().catch(error => { dbPromise = null; throw error; });
  }
  return dbPromise;
}

async function findRanking(candidate) {
  const db = await loadDb();
  for (const issn of candidate.issns || []) {
    const match = db.byIssn.get(normalizeIssn(issn));
    if (match) return match;
  }
  for (const name of candidate.names || []) {
    const match = db.byName.get(normalizeName(name));
    if (match) return match;
  }
  return null;
}

async function loadJcr() {
  if (!jcrPromise) {
    jcrPromise = Promise.all([loadBundledJcr(), chrome.storage.local.get("jcrRecords")]).then(([bundled, {jcrRecords = []}]) => {
      const byIssn = new Map();
      const byName = new Map();
      const add = (map, key, row) => {
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
      };
      const rows = [...bundled.records.map(row => ({...row, _hxSource: "builtin"})),
        ...jcrRecords.map(row => row && typeof row === "object" ? {...row, _hxSource: "custom"} : null)];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        add(byIssn, normalizeIssn(row.issn), row);
        add(byIssn, normalizeIssn(row.eissn), row);
        add(byName, normalizeName(row.journal), row);
      }
      return {byIssn, byName};
    }).catch(error => { jcrPromise = null; throw error; });
  }
  return jcrPromise;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.jcrRecords) jcrPromise = null;
});

async function findJcr(rec, candidate = {}) {
  const db = await loadJcr();
  const issns = [...(rec?.issns || []), ...(candidate.issns || [])];
  const names = [rec?.name, ...(candidate.names || [])];
  let matches = [...new Set(issns.flatMap(value => db.byIssn.get(normalizeIssn(value)) || []))];
  if (!matches.length) matches = [...new Set(names.flatMap(value => db.byName.get(normalizeName(value)) || []))];
  if (!matches.length) return null;
  const latestYear = Math.max(...matches.map(jcrYear));
  if (latestYear) matches = matches.filter(row => jcrYear(row) === latestYear);
  // A user-supplied correction takes precedence within the same metrics year.
  if (matches.some(row => row._hxSource === "custom")) matches = matches.filter(row => row._hxSource === "custom");
  const qNumber = row => Number(quartile(row.jcr_quartile || row.quartile).slice(1) || 9);
  matches.sort((a, b) => qNumber(a) - qNumber(b));
  return {best: matches[0], categories: matches, year: latestYear || null,
    source: matches[0]._hxSource === "custom" ? "自定义导入" : "ShowJCR 社区数据"};
}

async function crossrefWork(doi) {
  if (!doi) return null;
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    signal: AbortSignal.timeout(8000)
  });
  return response.ok ? (await response.json()).message : null;
}

async function classify(candidate = {}) {
  let ranking = await findRanking(candidate);
  let jcr = await findJcr(ranking, candidate);
  if ((!ranking || !jcr) && candidate.doi) {
    const work = await crossrefWork(candidate.doi).catch(() => null);
    if (work) {
      candidate = {...candidate,
        names: [...(candidate.names || []), ...(work["container-title"] || []), ...(work["short-container-title"] || [])],
        issns: [...(candidate.issns || []), ...(work.ISSN || [])]};
      ranking = await findRanking(candidate);
      jcr = await findJcr(ranking, candidate);
    }
  }
  return {candidate, ranking, jcr};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  let task;
  if (message.type === "classify") task = classify(message.candidate);
  if (message.type === "jcr-status") task = Promise.all([loadBundledJcr(), chrome.storage.local.get("jcrRecords")])
    .then(([data, {jcrRecords = []}]) => ({...data.source, customRecords: jcrRecords.length}));
  if (message.type === "zotero-preview" || message.type === "zotero-save") {
    if (sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
    task = message.type === "zotero-preview"
      ? HXPureZotero.preview(message.tabId)
      : HXPureZotero.save(message.tabId, {classify, crossrefWork});
  }
  if (!task) return;
  task.then(sendResponse).catch(error => sendResponse({error: error.message}));
  return true;
});
