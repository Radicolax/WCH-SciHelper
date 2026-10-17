const saveButton = document.getElementById("save-zotero");
const saveStatus = document.getElementById("save-status");
let activeTabId;

chrome.runtime.sendMessage({type: "jcr-status"}).then(result => {
  if (!result || result.error) throw new Error(result?.error || "数据加载失败");
  document.getElementById("jcr").textContent = `内置 ${result.metricYear} 年 IF/JCR，覆盖 ${result.journalCount.toLocaleString()} 种期刊。${result.customRecords ? `另有 ${result.customRecords} 条自定义记录。` : "无需手动导入即可显示。"}`;
}).catch(error => {
  document.getElementById("jcr").textContent = `IF/JCR 数据未能加载：${error.message}。请重新加载扩展。`;
});
document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();

function setStatus(text, type = "") {
  saveStatus.textContent = text;
  saveStatus.className = type;
}

(async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error("无法读取当前标签页。");
    activeTabId = tab.id;
    const result = await chrome.runtime.sendMessage({type: "zotero-preview", tabId: activeTabId});
    if (!result || result.error) throw new Error(result?.error || "无法识别当前页面。");
    document.getElementById("paper-title").textContent = result.title;
    document.getElementById("paper-type").textContent = result.isArticle ? "保存为文献题录" : "保存为普通网页条目";
    if (result.saved) {
      saveButton.textContent = "已保存到 Zotero";
      setStatus("当前页面已在本次会话中保存。", "success");
    } else {
      saveButton.disabled = false;
      setStatus(result.connected ? "Zotero 已连接，可以保存。" : "请先启动 Zotero 桌面端，再点击保存。", result.connected ? "success" : "");
    }
  } catch (error) {
    document.getElementById("paper-title").textContent = "当前页面暂不可保存";
    setStatus(error.message, "error");
  }
})();

saveButton.onclick = async () => {
  saveButton.disabled = true;
  saveButton.textContent = "正在保存…";
  setStatus("正在读取题录并保存到 Zotero，请稍候。");
  try {
    const result = await chrome.runtime.sendMessage({type: "zotero-save", tabId: activeTabId});
    if (!result?.saved) throw new Error(result?.error || "保存未完成，请检查 Zotero。");
    saveButton.textContent = "已保存到 Zotero";
    setStatus(result.alreadySaved ? "当前页面已经保存。" : `已保存：${result.title}`, "success");
  } catch (error) {
    saveButton.disabled = false;
    saveButton.textContent = "重试保存到 Zotero";
    setStatus(error.message, "error");
  }
};
