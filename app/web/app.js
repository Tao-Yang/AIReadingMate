/* 阅读伴侣主逻辑：PDF 渲染、划词捕获、调用后端注释、驱动机器人与气泡。 */
(function () {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const viewer = document.getElementById("viewer");
  const placeholder = document.getElementById("placeholder");
  const fileInput = document.getElementById("file-input");
  const prevBtn = document.getElementById("prev-page");
  const nextBtn = document.getElementById("next-page");
  const pageIndicator = document.getElementById("page-indicator");
  const zoomRange = document.getElementById("zoom-range");

  const bubble = document.getElementById("bubble");
  const bubbleTerm = document.getElementById("bubble-term");
  const bubbleBody = document.getElementById("bubble-body");
  const bubbleNote = document.getElementById("bubble-note");

  const robotStatus = document.getElementById("robot-status");

  let pdfDoc = null;
  let currentPage = 1;
  let scale = 1.2;
  let renderToken = 0;
  let statusTimer = null;

  Robot.init(document.getElementById("robot-canvas"));

  function say(text, keep) {
    robotStatus.textContent = text;
    robotStatus.classList.remove("hidden");
    if (statusTimer) clearTimeout(statusTimer);
    if (!keep) {
      statusTimer = setTimeout(() => robotStatus.classList.add("hidden"), 2600);
    }
  }

  async function loadPdf(data) {
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    currentPage = 1;
    placeholder.style.display = "none";
    say("加载好啦，开始读吧～");
    await renderPage(currentPage);
  }

  async function renderPage(num) {
    if (!pdfDoc) return;
    const token = ++renderToken;
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale });

    // 清空并重建当前页容器
    viewer.querySelectorAll(".page-wrap").forEach((el) => el.remove());
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.style.width = viewport.width + "px";
    wrap.style.height = viewport.height + "px";

    const canvas = document.createElement("canvas");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    wrap.appendChild(canvas);

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.width = viewport.width + "px";
    textLayerDiv.style.height = viewport.height + "px";
    wrap.appendChild(textLayerDiv);

    viewer.appendChild(wrap);

    await page.render({ canvasContext: ctx, viewport }).promise;
    if (token !== renderToken) return; // 已切换页面，放弃过期渲染

    const textContent = await page.getTextContent();
    pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
      textDivs: [],
    });

    pageIndicator.textContent = `${num} / ${pdfDoc.numPages}`;
  }

  function goto(delta) {
    if (!pdfDoc) return;
    const next = Math.min(Math.max(1, currentPage + delta), pdfDoc.numPages);
    if (next !== currentPage) {
      currentPage = next;
      hideBubble();
      renderPage(currentPage);
    }
  }

  // ---- 划词与注释 ----

  function getContext(sel) {
    // 取选中所在文本层的整页文本，截取选区前后各约 120 字作为上下文。
    let node = sel.anchorNode;
    while (node && !(node.nodeType === 1 && node.classList?.contains("textLayer"))) {
      node = node.parentNode;
    }
    if (!node) return "";
    const full = node.textContent || "";
    const picked = sel.toString();
    const idx = full.indexOf(picked);
    if (idx < 0) return picked;
    const start = Math.max(0, idx - 120);
    const end = Math.min(full.length, idx + picked.length + 120);
    return full.slice(start, end).replace(/\s+/g, " ").trim();
  }

  function showBubble(rect) {
    bubble.style.left = rect.left + rect.width / 2 + "px";
    bubble.style.top = rect.top + "px";
    bubble.classList.remove("hidden");
  }

  function hideBubble() {
    bubble.classList.add("hidden");
    bubble.classList.remove("loading");
  }

  function renderAnnotation(data) {
    bubble.classList.remove("loading");
    bubbleTerm.textContent = data.term || "";
    if (data.type === "sentence") {
      bubbleBody.textContent = data.translation || data.meaning || "";
    } else {
      bubbleBody.textContent = data.meaning || "";
    }
    const tags = [];
    if (data.note) tags.push(data.note);
    if (data.demo) tags.push("演示模式");
    bubbleNote.textContent = tags.join(" · ");

    if (data.simple) {
      Robot.setState("idle");
      say("这个词很简单，放心读～");
    } else {
      Robot.setState("happy");
      say("给你注释好啦！");
    }
  }

  async function annotate(selection, context, rect) {
    Robot.setState("thinking");
    say("让我想想…", true);
    bubbleTerm.textContent = selection;
    bubbleBody.textContent = "";
    bubbleNote.textContent = "";
    bubble.classList.add("loading");
    showBubble(rect);

    try {
      const resp = await fetch("/api/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection, context }),
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      renderAnnotation(data);
    } catch (err) {
      bubble.classList.remove("loading");
      bubbleBody.textContent = "哎呀，注释服务连不上了。";
      bubbleNote.textContent = String(err.message || err);
      Robot.setState("idle");
      say("后端好像没启动？");
    }
  }

  function onSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text) return;
    // 只处理阅读区内的选择
    if (!sel.anchorNode || !viewer.contains(sel.anchorNode)) return;
    if (text.length > 2000) {
      say("选得太多啦，少选一点～");
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const context = getContext(sel);
    annotate(text, context, rect);
  }

  // ---- 事件绑定 ----

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadPdf(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(file);
  });

  prevBtn.addEventListener("click", () => goto(-1));
  nextBtn.addEventListener("click", () => goto(1));
  zoomRange.addEventListener("input", (e) => {
    scale = parseFloat(e.target.value);
    hideBubble();
    if (pdfDoc) renderPage(currentPage);
  });

  document.addEventListener("mouseup", () => setTimeout(onSelection, 0));
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") goto(-1);
    if (e.key === "ArrowRight") goto(1);
    if (e.key === "Escape") hideBubble();
  });
  // 点击空白处（非气泡、非选区）关闭气泡
  document.addEventListener("mousedown", (e) => {
    if (!bubble.contains(e.target)) hideBubble();
  });
})();
