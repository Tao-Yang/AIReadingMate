// 阅读伴侣扩展后台：点击工具栏图标 → 在当前标签页切换机器人浮层。
// 已注入的页面发消息切换显隐；未注入的页面先注入依赖再显示。
// 同时代理注释请求：由后台发起跨域 fetch，避开内容脚本的 CORS 限制。

const FILES = ["vendor/three.min.js", "robot.js", "content.js"];
const ANNOTATE_URL = "https://ai-reading-mate.onrender.com/api/annotate";
const VIEWER_URL = chrome.runtime.getURL("vendor/pdfjs/viewer.html");

// 把 PDF 跳转接管到自带 PDF.js 查看器：内置 PDFium 不暴露文字，
// 自带查看器把文字渲染成真实 DOM，才能点词/划词取词。
function isPdfUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome-extension:") return false;
    if (!["file:", "http:", "https:"].includes(u.protocol)) return false;
    return /\.pdf$/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener((d) => {
    if (d.frameId !== 0) return; // 仅接管主框架
    if (!isPdfUrl(d.url)) return;
    chrome.tabs.update(d.tabId, {
      url: VIEWER_URL + "?file=" + encodeURIComponent(d.url),
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "annotate") {
    fetch(ANNOTATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection: msg.selection, context: msg.context || "" }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // 异步响应
  }
});

async function injectAndShow(tabId) {
  // 浮层样式由 Shadow DOM 内的 <link> 加载，这里只注入脚本。
  await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  // 先尝试让已注入的浮层自行切换；无接收方则说明尚未注入。
  chrome.tabs.sendMessage(tab.id, { type: "toggle" }, () => {
    if (chrome.runtime.lastError) {
      injectAndShow(tab.id).catch((err) => {
        console.warn("阅读伴侣注入失败：", err);
        // 内置 PDF 查看器等特殊页面无法注入内容脚本。
        chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#a5352f" });
      });
    }
  });
});
