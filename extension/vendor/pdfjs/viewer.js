/* 阅读伴侣自带 PDF 查看器：用 PDF.js 渲染画布 + 透明文本层，
 * 使本地/在线 PDF 的文字变成真实 DOM，从而支持点词、划词取词。 */
(async function () {
  const params = new URLSearchParams(location.search);
  const fileUrl = params.get("file");
  const loadingEl = document.getElementById("rc-loading");
  const viewerEl = document.getElementById("rc-viewer");
  const filenameEl = document.getElementById("rc-filename");
  const pageinfoEl = document.getElementById("rc-pageinfo");

  if (!fileUrl) {
    loadingEl.textContent = "缺少 file 参数。";
    return;
  }
  try {
    filenameEl.textContent = decodeURIComponent(fileUrl.split(/[\\/]/).pop());
    document.title = filenameEl.textContent + " · 阅读伴侣";
  } catch (_) {
    filenameEl.textContent = fileUrl;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "vendor/pdfjs/pdf.worker.min.js"
  );

  let scale = 1.4;
  let pdfDoc = null;
  let rendering = false;

  async function renderAll() {
    if (rendering) return;
    rendering = true;
    viewerEl.innerHTML = "";
    const ratio = window.devicePixelRatio || 1;
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const page = await pdfDoc.getPage(n);
      const viewport = page.getViewport({ scale });

      const pageDiv = document.createElement("div");
      pageDiv.className = "rc-page";
      pageDiv.style.width = Math.floor(viewport.width) + "px";
      pageDiv.style.height = Math.floor(viewport.height) + "px";

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = Math.floor(viewport.width) + "px";
      canvas.style.height = Math.floor(viewport.height) + "px";
      pageDiv.appendChild(canvas);

      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
      }).promise;

      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "textLayer";
      textLayerDiv.style.setProperty("--scale-factor", scale);
      textLayerDiv.style.width = Math.floor(viewport.width) + "px";
      textLayerDiv.style.height = Math.floor(viewport.height) + "px";
      pageDiv.appendChild(textLayerDiv);

      const textContent = await page.getTextContent();
      await pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      }).promise;

      viewerEl.appendChild(pageDiv);
    }
    pageinfoEl.textContent = pdfDoc.numPages + " 页";
    rendering = false;
  }

  // Chromium 扩展页 fetch() 读不了 file://，改用 XHR 自行取字节再交给 PDF.js。
  function fetchPdfData(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.onload = () => {
        const ok = xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300);
        if (ok && xhr.response && xhr.response.byteLength) {
          resolve(new Uint8Array(xhr.response));
        } else {
          reject(new Error(xhr.status ? "HTTP " + xhr.status : "文件为空或无法读取"));
        }
      };
      xhr.onerror = () => reject(new Error("无法读取文件（file:// 访问被拒绝）"));
      xhr.send();
    });
  }

  // file:// 需要「允许访问文件 URL」开关；先自检以给出精确提示。
  function isFileAccessAllowed() {
    return new Promise((resolve) => {
      try {
        if (chrome.extension && chrome.extension.isAllowedFileSchemeAccess) {
          chrome.extension.isAllowedFileSchemeAccess((a) => resolve(a));
        } else {
          resolve(null);
        }
      } catch (_) {
        resolve(null);
      }
    });
  }

  try {
    if (fileUrl.startsWith("file:")) {
      const allowed = await isFileAccessAllowed();
      if (allowed === false) {
        throw new Error(
          "扩展尚未获得文件访问权限。请到 edge://extensions 打开本扩展详情页里的「允许访问文件 URL / Allow access to file URLs」开关，再刷新本页面"
        );
      }
    }
    const data = await fetchPdfData(fileUrl);
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    loadingEl.style.display = "none";
    await renderAll();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    loadingEl.textContent = "加载 PDF 失败：" + msg;
    return;
  }

  document.getElementById("rc-zoom-in").addEventListener("click", () => {
    scale = Math.min(scale + 0.2, 3);
    renderAll();
  });
  document.getElementById("rc-zoom-out").addEventListener("click", () => {
    scale = Math.max(scale - 0.2, 0.5);
    renderAll();
  });
})();
