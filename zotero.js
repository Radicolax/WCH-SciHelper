(() => {
  const baseUrl = "http://127.0.0.1:23119";
  const pending = new Map();
  const saved = new Map();

  // Runs in the active tab after the user opens the extension popup.
  function readPageMetadata() {
    const metas = [...document.querySelectorAll("meta")];
    const values = (...keys) => metas.filter(node => keys.includes(
      (node.getAttribute("name") || node.getAttribute("property") || "").toLowerCase()
    )).map(node => node.content?.trim()).filter(Boolean);
    const first = (...keys) => values(...keys)[0] || "";
    const doiValue = first("citation_doi", "prism.doi", "dc.identifier") || location.href;
    let doi = doiValue.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[).,;]+$/, "") || "";
    const authors = values("citation_author", "dc.creator");
    let structured = null;
    const walk = value => {
      if (!value || typeof value !== "object") return;
      const types = [].concat(value["@type"] || []);
      if (!structured && types.some(type => /^(ScholarlyArticle|MedicalScholarlyArticle|Article|NewsArticle)$/.test(type))) structured = value;
      Object.values(value).forEach(child => {
        if (Array.isArray(child)) child.forEach(walk);
        else if (typeof child === "object") walk(child);
      });
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { walk(JSON.parse(script.textContent)); } catch {}
    }
    if (!doi && structured) {
      const id = typeof structured.identifier === "string" ? structured.identifier : structured.identifier?.value;
      doi = String(id || "").match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]?.replace(/[).,;]+$/, "") || "";
    }
    const citationTitle = first("citation_title", "dc.title");
    const isSearch = Boolean(document.querySelector(".docsum-content, #gs_res_ccl_mid")) && !citationTitle && !structured;
    const journal = first("citation_journal_title", "prism.publicationname", "dc.source")
      || structured?.isPartOf?.name || "";
    const jsonAuthors = [].concat(structured?.author || []).map(person => {
      if (typeof person === "string") return person;
      if (person.givenName || person.familyName) return {firstName: person.givenName || "", lastName: person.familyName || person.name || ""};
      return person.name || "";
    }).filter(Boolean);
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    return {
      title: citationTitle || structured?.headline || structured?.name || first("og:title") || document.title,
      journal, doi, issns: values("citation_issn", "prism.issn", "prism.eissn"),
      authors: authors.length ? authors : jsonAuthors,
      date: first("citation_publication_date", "citation_date", "dc.date", "prism.publicationdate") || structured?.datePublished || "",
      volume: first("citation_volume", "prism.volume"), issue: first("citation_issue", "prism.number"),
      pages: [first("citation_firstpage"), first("citation_lastpage")].filter(Boolean).join("-"),
      abstract: first("citation_abstract", "dc.description") || structured?.abstract || "",
      url: canonical && /^https?:/.test(canonical) ? canonical : location.href,
      isArticle: Boolean(citationTitle || journal || doi || structured), isSearch,
      language: first("citation_language", "dc.language") || document.documentElement.lang || ""
    };
  }

  async function readTab(tabId) {
    if (!Number.isInteger(tabId)) throw new Error("无法确定当前标签页，请重新打开弹窗。");
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("请在普通网页或论文详情页使用此功能。");
    let results;
    try {
      results = await chrome.scripting.executeScript({target: {tabId}, func: readPageMetadata});
    } catch {
      throw new Error("无法读取当前网页，请刷新论文页面后重试。");
    }
    const page = results?.[0]?.result;
    if (!page?.title) throw new Error("未识别到页面标题，请等待网页加载后重试。");
    if (page.isSearch) throw new Error("请先打开单篇论文详情页，再保存到 Zotero。");
    return page;
  }

  async function connector(path, data) {
    let response;
    try {
      response = await fetch(`${baseUrl}/connector/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {"Content-Type": "application/json", "X-Zotero-Connector-API-Version": "3"},
        ...(data === undefined ? {} : {body: JSON.stringify(data)}),
        signal: AbortSignal.timeout(data === undefined ? 3500 : 20000)
      });
    } catch (error) {
      if (data !== undefined && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("保存结果尚未确认，请先检查 Zotero 中是否已有该条目，再决定是否重试。");
      }
      throw new Error("无法连接本机 Zotero，请先启动 Zotero 桌面端，再重试。");
    }
    if (!response.ok) {
      if (response.status === 403) throw new Error("Zotero 拒绝了连接，请检查 Zotero 的 Connector 连接设置。");
      if (response.status === 409) throw new Error("该保存会话已经提交，请先在 Zotero 中检查条目。");
      throw new Error(`Zotero 未能完成操作（HTTP ${response.status}），请检查当前文献库是否可写。`);
    }
    return response;
  }

  function creator(person) {
    if (typeof person === "object") return {creatorType: "author", firstName: person.firstName || "", lastName: person.lastName || ""};
    const name = String(person).trim();
    if (name.includes(",")) {
      const [lastName, ...rest] = name.split(",");
      return {creatorType: "author", firstName: rest.join(",").trim(), lastName: lastName.trim()};
    }
    // Keep names intact instead of guessing surname boundaries or splitting organizations.
    return {creatorType: "author", lastName: name, fieldMode: 1};
  }

  function makeItem(page, work, classification) {
    const strip = value => String(value || "").replace(/<[^>]*>/g, "").trim();
    const getDate = value => value?.["date-parts"]?.[0]?.join("-") || "";
    const creators = work?.author?.length
      ? work.author.map(person => creator({firstName: person.given || "", lastName: person.family || person.name || ""}))
      : (page.authors || []).map(creator);
    const isArticle = page.isArticle || Boolean(work);
    const item = {
      id: crypto.randomUUID(), itemType: isArticle ? "journalArticle" : "webpage",
      title: strip(work?.title?.[0] || page.title), creators,
      url: page.url, accessDate: new Date().toISOString().slice(0, 10),
      abstractNote: strip(page.abstract || work?.abstract), language: page.language || "",
      tags: [], attachments: []
    };
    if (isArticle) Object.assign(item, {
      DOI: work?.DOI || page.doi || "", publicationTitle: work?.["container-title"]?.[0] || page.journal || "",
      ISSN: work?.ISSN?.[0] || page.issns?.[0] || "", date: getDate(work?.published) || getDate(work?.issued) || page.date || "",
      volume: work?.volume || page.volume || "", issue: work?.issue || page.issue || "", pages: work?.page || page.pages || ""
    });
    const r = classification?.ranking;
    if (r?.scu) item.tags.push({tag: `SCU ${r.scu.grade}`, type: 1});
    if (r?.hx2025) item.tags.push({tag: `HX-2025 ${r.hx2025.grade}`, type: 1});
    if (classification?.jcr) {
      const label = HXPure.jcrLabel(classification.jcr.best);
      const year = classification.jcr.year;
      item.tags.push({tag: `JCR ${label}${year ? ` (${year})` : ""}`, type: 1});
    }
    return item;
  }

  async function preview(tabId) {
    const page = await readTab(tabId);
    const connected = await connector("ping").then(() => true).catch(() => false);
    return {title: page.title, isArticle: page.isArticle, connected, saved: saved.get(tabId) === page.url};
  }

  async function save(tabId, services) {
    if (pending.has(tabId)) return pending.get(tabId);
    const operation = (async () => {
      const page = await readTab(tabId);
      if (saved.get(tabId) === page.url) return {saved: true, title: page.title, alreadySaved: true};
      await connector("ping");
      const work = page.doi ? await services.crossrefWork(page.doi).catch(() => null) : null;
      const candidate = {names: [page.journal, ...(work?.["container-title"] || [])].filter(Boolean), issns: [...(page.issns || []), ...(work?.ISSN || [])]};
      const classification = await services.classify(candidate).catch(() => null);
      const item = makeItem(page, work, classification);
      await connector("saveItems", {sessionID: crypto.randomUUID(), uri: page.url, items: [item]});
      saved.set(tabId, page.url);
      return {saved: true, title: item.title};
    })();
    pending.set(tabId, operation);
    try { return await operation; }
    finally { pending.delete(tabId); }
  }

  globalThis.HXPureZotero = Object.freeze({preview, save, makeItem, readPageMetadata});
})();
