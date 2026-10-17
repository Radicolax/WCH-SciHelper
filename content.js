(() => {
  if (window.top !== window || window.__hxPureLoaded) return;
  window.__hxPureLoaded = true;
  const {escapeHtml, jcrLabel, jcrClass, ifLabel} = HXPure;
  let generation = 0;
  let observerTimer;

  const chip = (label, extra = "", mini = false, title = "") =>
    `<span class="${mini ? "jrank-mini" : "jrank-chip"} ${extra}"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(label)}</span>`;
  const rankingChips = (r, mini = false) => r ?
    chip(`综合 ${r.best}`, mini ? "jrank-mini-best" : "jrank-best", mini)
    + chip(`SCU ${r.scu?.grade || "-"}`, "", mini)
    + chip(`HX-2025 ${r.hx2025?.grade || "-"}`, "", mini) : "";
  const metricsTitle = jcr => jcr ? `指标年份 ${jcr.year || "未标"}；IF ${ifLabel(jcr.best)}；${jcr.best.category || "未标学科"}；来源：${jcr.source || "导入数据"}` : "当前数据中未匹配到该期刊";
  const jcrChip = (jcr, mini = false) => chip(
    `JCR ${jcr ? jcrLabel(jcr.best) : "未收录"}`, `jrank-jcr ${jcr ? jcrClass(jcr.best) : "jrank-unknown"}`, mini, metricsTitle(jcr)
  );
  const metricChips = (jcr, mini = false) =>
    chip(`IF ${jcr ? ifLabel(jcr.best) : "未收录"}`, "jrank-if", mini, metricsTitle(jcr)) + jcrChip(jcr, mini);

  function articleCandidate() {
    const metas = [...document.querySelectorAll("meta")];
    const values = (...keys) => metas.filter(node => keys.includes(
      (node.getAttribute("name") || node.getAttribute("property") || "").toLowerCase()
    )).map(node => node.content?.trim()).filter(Boolean);
    const names = values("citation_journal_title", "prism.publicationname", "dc.source", "dc.source.title", "journal_title", "og:site_name");
    const issns = values("citation_issn", "prism.issn", "prism.eissn", "dc.identifier.issn");
    const doiText = [...values("citation_doi", "dc.identifier", "prism.doi"), location.href].find(text => /10\.\d{4,9}\//i.test(text)) || "";
    let doi = doiText.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[).,;]+$/, "") || "";
    const walk = value => {
      if (!value || typeof value !== "object") return;
      if (value.issn) issns.push(...[].concat(value.issn));
      if (value.isPartOf?.name) names.push(value.isPartOf.name);
      if (!doi && typeof value.identifier === "string") doi = value.identifier.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0] || "";
      Object.values(value).forEach(child => {
        if (Array.isArray(child)) child.forEach(walk);
        else if (typeof child === "object") walk(child);
      });
    };
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { walk(JSON.parse(node.textContent)); } catch {}
    }
    return {names, issns, doi};
  }

  function enhanceArticle() {
    if (document.getElementById("scu-hx-journal-inline")) return;
    const candidate = articleCandidate();
    if (!candidate.names.length && !candidate.issns.length && !candidate.doi) return;
    const version = generation;
    chrome.runtime.sendMessage({type: "classify", candidate}, result => {
      if (chrome.runtime.lastError || version !== generation || (!result?.ranking && !result?.jcr)) return;
      if (document.getElementById("scu-hx-journal-inline")) return;
      const r = result.ranking;
      const jcr = result.jcr;
      const j = jcr?.best;
      const anchor = document.querySelector(".article-source")
        || document.querySelector('[data-testid*="journal" i], .citation-journal, .journal-title, [class*="journal-title" i]')
        || document.querySelector("h1");
      if (!anchor) return;
      const inline = document.createElement("div");
      inline.id = "scu-hx-journal-inline";
      const badge = document.createElement("button");
      badge.id = "scu-hx-journal-badge";
      badge.type = "button";
      badge.title = "点击查看期刊分级详情";
      badge.setAttribute("aria-expanded", "false");
      badge.innerHTML = rankingChips(r) + metricChips(jcr);
      const panel = document.createElement("section");
      panel.id = "scu-hx-journal-panel";
      panel.innerHTML = `<button class="jrank-close" aria-label="关闭">×</button>
        <h2>${escapeHtml(r?.name || j?.journal || candidate.names[0])}</h2>
        <div class="jrank-grid">
          <b>综合最高等级</b><strong>${escapeHtml(r?.best || "未收录")}</strong>
          <b>SCU</b><span>${r?.scu ? `SCU-${escapeHtml(r.scu.grade)} · ${escapeHtml(r.scu.field)}` : "未收录"}</span>
          <b>HX-2025</b><span>${r?.hx2025 ? `HX-2025-${escapeHtml(r.hx2025.grade)} · ${escapeHtml(r.hx2025.field)}` : "未收录"}</span>
          <b>IF 影响因子</b><span>${escapeHtml(jcr ? ifLabel(j) : "未收录")}</span>
          <b>JCR</b><span>${jcrChip(jcr)}</span>
          <b>指标年份</b><span>${escapeHtml(jcr?.year || "未标年份")}</span>
          <b>指标来源</b><span>${escapeHtml(jcr?.source || "未匹配")}</span>
          <b>ISSN</b><span>${escapeHtml((r?.issns || candidate.issns).join(" / ") || "-")}</span>
        </div>
        ${jcr?.categories?.length ? `<details><summary>全部 JCR 学科分区${jcr.year ? `（${jcr.year}）` : ""}</summary>${jcr.categories.map(row => `<p>${escapeHtml(row.category || "未标学科")}：${chip(jcrLabel(row), `jrank-jcr ${jcrClass(row)}`)}</p>`).join("")}</details>` : ""}
        <p class="jrank-note">IF/JCR 使用内置或导入数据中的最新指标年份，主标签显示该年的最佳学科分区。${r ? `来源页：SCU ${escapeHtml(r.scu?.page || "-")}；HX ${escapeHtml(r.hx2025?.page || "-")}。` : ""}</p>`;
      inline.append(badge, panel);
      anchor.insertAdjacentElement("afterend", inline);
      badge.addEventListener("click", () => {
        badge.setAttribute("aria-expanded", String(panel.classList.toggle("open")));
      });
      panel.querySelector(".jrank-close").addEventListener("click", () => {
        panel.classList.remove("open");
        badge.setAttribute("aria-expanded", "false");
      });
    });
  }

  function enhancePubmedResults() {
    if (location.hostname !== "pubmed.ncbi.nlm.nih.gov") return;
    const version = generation;
    for (const card of document.querySelectorAll(".docsum-content")) {
      if (card.dataset.jrankPending || card.querySelector(".jrank-result-badges")) continue;
      const citation = card.querySelector(".full-journal-citation, .docsum-journal-citation");
      if (!citation) continue;
      const text = citation.textContent.replace(/\s+/g, " ").trim();
      const journal = text.split(".")[0]?.trim();
      const doi = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[).,;]+$/, "") || "";
      if (!journal && !doi) continue;
      card.dataset.jrankPending = "1";
      chrome.runtime.sendMessage({type: "classify", candidate: {names: journal ? [journal] : [], issns: [], doi}}, result => {
        if (version !== generation) return;
        delete card.dataset.jrankPending;
        if (chrome.runtime.lastError || (!result?.ranking && !result?.jcr) || card.querySelector(".jrank-result-badges")) return;
        const row = document.createElement("span");
        row.className = "jrank-result-badges";
        const r = result.ranking;
        const jcr = result.jcr;
        row.title = `${r?.name || jcr?.best.journal || journal}\n${r ? `综合 ${r.best}；SCU ${r.scu?.grade || "未收录"}；HX-2025 ${r.hx2025?.grade || "未收录"}` : "SCU/HX 未收录"}${jcr ? `；JCR ${jcrLabel(jcr.best)}；JIF ${jcr.best.jif ?? "-"}；年份 ${jcr.year || "未标"}` : ""}`;
        row.innerHTML = rankingChips(r, true) + metricChips(jcr, true);
        citation.insertAdjacentElement("afterend", row);
      });
    }
  }

  enhanceArticle();
  enhancePubmedResults();
  if (location.hostname === "pubmed.ncbi.nlm.nih.gov") {
    new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(enhancePubmedResults, 150);
    }).observe(document.body, {childList: true, subtree: true});
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.jcrRecords) return;
    generation++;
    document.getElementById("scu-hx-journal-inline")?.remove();
    document.querySelectorAll(".jrank-result-badges").forEach(node => node.remove());
    document.querySelectorAll("[data-jrank-pending]").forEach(node => delete node.dataset.jrankPending);
    enhanceArticle();
    enhancePubmedResults();
  });
})();
