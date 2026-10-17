const statusNode = document.getElementById("status");

async function showCurrentData() {
  const {jcrRecords = []} = await chrome.storage.local.get("jcrRecords");
  statusNode.textContent = jcrRecords.length ? `当前已导入 ${jcrRecords.length} 条 JCR 学科记录。` : "尚未导入 JCR 数据。";
}
showCurrentData();
chrome.runtime.sendMessage({type: "jcr-status"}).then(result => {
  if (!result || result.error) throw new Error(result?.error || "数据加载失败");
  document.getElementById("builtin-status").textContent = `已加载 ${result.metricYear} 年 IF/JCR：${result.journalCount.toLocaleString()} 种期刊、${result.categoryRecordCount.toLocaleString()} 条学科记录。`;
}).catch(error => {
  document.getElementById("builtin-status").textContent = `内置数据加载失败：${error.message}。请重新加载插件。`;
});

document.getElementById("file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const records = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseCsv(text);
    const rows = Array.isArray(records) ? records : records.records;
    if (!Array.isArray(rows) || !rows.length) throw new Error("文件中没有记录");
    const data = rows.map((row, index) => normalizeRecord(row, index + 1));
    await chrome.storage.local.set({jcrRecords: data, jcrImportedAt: new Date().toISOString()});
    statusNode.className = "success";
    statusNode.textContent = `已导入 ${data.length} 条 JCR 学科记录，已打开网页中的标签将自动更新。`;
  } catch (error) {
    statusNode.className = "error";
    statusNode.textContent = `导入失败：${error.message}`;
  } finally { event.target.value = ""; }
});

document.getElementById("clear").onclick = async () => {
  await chrome.storage.local.remove(["jcrRecords", "jcrImportedAt"]);
  statusNode.className = "";
  statusNode.textContent = "自定义数据已清除，已恢复使用内置 IF/JCR 数据。";
};

function normalizeRecord(row, line) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`第 ${line} 条记录格式错误`);
  const keys = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[\s_-]+/g, ""), String(value ?? "").trim()]));
  const record = {journal: keys.journal || keys.journalname || "", issn: HXPure.normalizeIssn(keys.issn), eissn: HXPure.normalizeIssn(keys.eissn),
    jif: keys.jif || keys.impactfactor || "", jcr_quartile: HXPure.quartile(keys.jcrquartile || keys.quartile),
    jcr_year: keys.jcryear || keys.year || "", category: keys.category || ""};
  if (!record.journal && !record.issn && !record.eissn) throw new Error(`第 ${line} 条缺少期刊名或有效 ISSN`);
  if (!record.jcr_quartile) throw new Error(`第 ${line} 条的分区须为 Q1、Q2、Q3 或 Q4`);
  if (record.jcr_year && !HXPure.jcrYear(record)) throw new Error(`第 ${line} 条的 JCR 年份无效`);
  return record;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV 中存在未闭合的引号");
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV 须包含表头和至少一条数据");
  const headers = rows.shift().map(value => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("CSV 存在重复列名");
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行的列数与表头不一致`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i].trim()]));
  });
}
