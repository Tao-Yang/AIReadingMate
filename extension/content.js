/* 阅读伴侣内容脚本：在页面右下角挂载机器人浮层，捕获划词或粘贴文本，
 * 通过后台代理请求注释，并在气泡中展示。仅注入一次，靠消息切换显隐。 */
if (!window.__readingCompanionMounted) {
  window.__readingCompanionMounted = true;

  const HOST_ID = "reading-companion-host";
  let host, shadow, panel, canvas, statusEl, bubble, bubbleTerm, bubbleBody, bubbleNote, input;
  let lastSelection = "";

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function buildUI() {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "position:fixed;right:22px;bottom:22px;z-index:2147483647;width:260px;";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = chrome.runtime.getURL("overlay.css");
    shadow.appendChild(style);

    panel = h("div", "rc-panel");

    const bar = h("div", "rc-bar");
    bar.appendChild(h("span", "rc-title", "阅读伴侣"));
    const closeBtn = h("button", "rc-close", "×");
    closeBtn.title = "收起机器人";
    closeBtn.addEventListener("click", () => toggle(false));
    bar.appendChild(closeBtn);
    panel.appendChild(bar);

    // 机器人舞台
    const stage = h("div", "rc-stage");
    canvas = document.createElement("canvas");
    canvas.className = "rc-canvas";
    stage.appendChild(canvas);
    statusEl = h("div", "rc-status", "Hi～点词或划选英文试试");
    stage.appendChild(statusEl);
    panel.appendChild(stage);

    // 注释气泡
    bubble = h("div", "rc-bubble rc-hidden");
    bubbleTerm = h("div", "rc-term");
    bubbleBody = h("div", "rc-body");
    bubbleNote = h("div", "rc-note");
    bubble.append(bubbleTerm, bubbleBody, bubbleNote);
    panel.appendChild(bubble);

    // 手动输入区（内置 PDF 查看器无法自动取词时使用）
    const tools = h("div", "rc-tools");
    input = document.createElement("textarea");
    input.className = "rc-input";
    input.placeholder = "在 PDF 里选中英文后按 Ctrl+C，再点“注释”";
    tools.appendChild(input);
    const row = h("div", "rc-row");
    const pasteBtn = h("button", "rc-btn", "读取剪贴板");
    pasteBtn.addEventListener("click", readClipboard);
    const goBtn = h("button", "rc-btn rc-primary", "注释");
    goBtn.addEventListener("click", () => {
      const t = input.value.trim();
      if (t) annotate(t, "");
    });
    row.append(pasteBtn, goBtn);
    tools.appendChild(row);
    panel.appendChild(tools);

    shadow.appendChild(panel);
    document.documentElement.appendChild(host);

    window.Robot.init(canvas);
  }

  function say(text) {
    statusEl.textContent = text;
  }

  async function readClipboard() {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) { say("剪贴板是空的哦"); return; }
      input.value = t;
      annotate(t, "");
    } catch (e) {
      say("读取剪贴板失败，请手动粘贴");
    }
  }

  function showBubble() { bubble.classList.remove("rc-hidden"); }

  function renderAnnotation(data) {
    bubble.classList.remove("rc-loading");
    bubbleTerm.textContent = data.term || "";
    bubbleBody.textContent =
      data.type === "sentence" ? (data.translation || data.meaning || "") : (data.meaning || "");
    const tags = [];
    if (data.note) tags.push(data.note);
    if (data.demo) tags.push("演示模式");
    bubbleNote.textContent = tags.join(" · ");
    if (data.simple) { window.Robot.setState("idle"); say("这个词很简单，放心读～"); }
    else { window.Robot.setState("happy"); say("给你注释好啦！"); }
  }

  function annotate(selection, context) {
    if (selection.length > 2000) { say("选得太多啦，少选一点～"); return; }
    window.Robot.setState("thinking");
    say("让我想想…");
    bubbleTerm.textContent = selection.length > 40 ? selection.slice(0, 40) + "…" : selection;
    bubbleBody.textContent = "";
    bubbleNote.textContent = "";
    bubble.classList.add("rc-loading");
    showBubble();

    chrome.runtime.sendMessage({ type: "annotate", selection, context }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        bubble.classList.remove("rc-loading");
        bubbleBody.textContent = "哎呀，注释服务连不上了。";
        window.Robot.setState("idle");
        say("后端好像没响应？");
        return;
      }
      if (resp.ok) renderAnnotation(resp.data);
      else {
        bubble.classList.remove("rc-loading");
        bubbleBody.textContent = "哎呀，注释服务连不上了。";
        bubbleNote.textContent = resp.error || "";
        window.Robot.setState("idle");
        say("后端好像没响应？");
      }
    });
  }

  function onSelection() {
    if (!host || host.style.display === "none") return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text || text === lastSelection) return;
    // 忽略浮层自身内部的选择
    if (sel.anchorNode && host.contains(sel.anchorNode)) return;
    lastSelection = text;
    input.value = text;
    annotate(text, "");
  }

  // 单击取词：定位鼠标点中的英文单词并展开到词边界
  function getWordAtPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range) return null;
    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.textContent || "";
    const isWord = (ch) => /[A-Za-z0-9'\u2019-]/.test(ch);
    let i = Math.min(range.startOffset, text.length);
    let start = i, end = i;
    while (start > 0 && isWord(text[start - 1])) start--;
    while (end < text.length && isWord(text[end])) end++;
    if (start === end) return null;
    const word = text.slice(start, end).trim();
    if (!word) return null;
    const wr = document.createRange();
    wr.setStart(node, start);
    wr.setEnd(node, end);
    return { word, range: wr };
  }

  function onClickWord(e) {
    if (!host || host.style.display === "none") return;
    // 忽略浮层自身内部的点击
    if (e.target === host || host.contains(e.target)) return;
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) return; // 已划词，交给 mouseup 处理
    const hit = getWordAtPoint(e.clientX, e.clientY);
    if (!hit) return;
    if (sel) { sel.removeAllRanges(); sel.addRange(hit.range); } // 高亮点中的词
    lastSelection = hit.word;
    input.value = hit.word;
    annotate(hit.word, "");
  }

  function toggle(force) {
    if (!host) buildUI();
    const show = force != null ? force : host.style.display === "none";
    host.style.display = show ? "block" : "none";
  }

  document.addEventListener("mouseup", () => setTimeout(onSelection, 0));
  document.addEventListener("click", onClickWord);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "toggle") toggle();
  });

  buildUI(); // 首次注入即显示
}
