(() => {
  const normalizeName = (value = "") => String(value).toUpperCase()
    .replaceAll("&", " AND ").replace(/[^A-Z0-9]+/g, "");
  const normalizeIssn = (value = "") => {
    const hit = String(value).toUpperCase().match(/\b(\d{4})-?([\dX]{4})\b/);
    return hit ? `${hit[1]}-${hit[2]}` : "";
  };
  const quartile = value => {
    const hit = String(value ?? "").trim().toUpperCase().match(/^Q?\s*([1-4])(?:\s*区)?$/);
    return hit ? `Q${hit[1]}` : "";
  };
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g,
    c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"}[c]));
  const jcrLabel = record => quartile(record?.jcr_quartile || record?.quartile) || "未分区";
  const jcrClass = record => `jrank-${(quartile(record?.jcr_quartile || record?.quartile) || "unknown").toLowerCase()}`;
  const jcrYear = record => Number(String(record?.jcr_year || record?.year || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || 0);
  const ifLabel = record => {
    const value = String(record?.jif ?? "").trim();
    return !value || /^(N\/?A|NAN|NULL|-)$/i.test(value) ? "未提供" : value;
  };
  globalThis.HXPure = Object.freeze({normalizeName, normalizeIssn, quartile, escapeHtml, jcrLabel, jcrClass, jcrYear, ifLabel});
})();
