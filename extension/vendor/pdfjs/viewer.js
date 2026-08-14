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

  async function renderDoc(data) {
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    loadingEl.style.display = "none";
    await renderAll();
  }

  // 兜底：Edge 常禁止扩展页直接读 file://，让用户手动选一次文件，
  // 用 FileReader 读取字节，完全绕开 file:// 限制。
  function showPicker(reason) {
    loadingEl.innerHTML = "";
    loadingEl.style.display = "";
    const tip = document.createElement("div");
    tip.style.marginBottom = "12px";
    tip.textContent = reason + " 请手动选择要阅读的 PDF：";
    const btn = document.createElement("button");
    btn.textContent = "选择 PDF 文件";
    btn.style.cssText =
      "background:#c9922e;color:#1a1a1a;border:none;border-radius:6px;padding:8px 18px;cursor:pointer;font-size:14px;";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.style.display = "none";
    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      if (!f) return;
      filenameEl.textContent = f.name;
      document.title = f.name + " · 阅读伴侣";
      loadingEl.textContent = "正在渲染…";
      const reader = new FileReader();
      reader.onload = () =>
        renderDoc(new Uint8Array(reader.result)).catch((err) => {
          loadingEl.textContent =
            "渲染失败：" + (err && err.message ? err.message : err);
        });
      reader.onerror = () => (loadingEl.textContent = "读取所选文件失败");
      reader.readAsArrayBuffer(f);
    });
    loadingEl.append(tip, btn, input);
  }

  try {
    let data = null;
    let firstErr = "";
    try {
      data = await fetchPdfData(fileUrl); // XHR：http(s) 及部分 file://
    } catch (e1) {
      firstErr = e1 && e1.message ? e1.message : String(e1);
      try {
        const resp = await fetch(fileUrl); // 退一步试 fetch（http(s) 可用）
        data = new Uint8Array(await resp.arrayBuffer());
      } catch (_) {
        data = null;
      }
    }
    if (data && data.byteLength) {
      await renderDoc(data);
    } else if (fileUrl.startsWith("file:")) {
      showPicker("无法自动读取本地文件（Edge 限制扩展直接访问 file://）。");
    } else {
      showPicker("无法自动读取该 PDF" + (firstErr ? "（" + firstErr + "）" : "") + "。");
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    showPicker("加载失败（" + msg + "）。");
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
