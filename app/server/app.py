"""英文 PDF 动态阅读伴侣 —— 后端服务。

职责：
- 提供静态网页（PDF 阅读器 + 3D 机器人）。
- 提供 /api/annotate 接口：接收用户划选的英文文本与上下文，
  按 pdf-reading-companion skill 的“释义生成规则”返回结构化中文注释。

注释生成的来源（按优先级）：
1. 离线词典：单词/词组优先查 ECDICT + 明清历史文化词库，命中即返回，无需联网。
2. 大模型：离线未命中的词，以及所有句子翻译，若配置 OPENAI_API_KEY 则调用。
3. 演示兜底：既无离线命中又未配置密钥时，返回友好提示，保证开箱即用。
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from dictionary import Dictionary

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# 离线词典：ECDICT（按需下载到 data/ecdict.csv）+ 随附的历史文化词库。
DICT = Dictionary(
    ecdict_path=str(DATA_DIR / "ecdict.csv"),
    extra_path=str(DATA_DIR / "glossaries"),
)

# 与 pdf-reading-companion/SKILL.md 的“释义规则 + 输出格式”保持一致的系统提示。
SYSTEM_PROMPT = """你是一个英文阅读伴侣机器人，为中文读者即时注释英文小说中的选中文本。

判定选中类型并采用对应策略：
- 单词(word)：给当前语境下的简明中文义；一词多义只列当前句所需含义。
- 词组(phrase)：整体释义，识别习语/短语动词/固定搭配/文学性或旧式表达，不逐词硬译。
- 句子(sentence)：给自然通顺的整句中文翻译，可附一句极短难点提示。
判定参考：含句末标点(. ! ?)或词数≥8 视为句子；2-5 个词且非完整句视为词组；其余为单词。

释义要求：
- 简短，适合小气泡展示（单词/词组释义尽量≤20字）。
- 只给当前上下文所需含义；默认不输出词性、音标、英文释义、例句、词源、无关义项。
- 需要时可加极短标签，如 讽刺/旧式/口语/比喻。
- 若选中内容对 B2 读者明显过于简单（如 the、and、普通人名），把 simple 置为 true，
  并在 meaning 中给一句友好说明，而不是强行编释义。

只返回一个 JSON 对象，不要包裹多余文字或代码块，字段：
{
  "term": "选中的原文",
  "type": "word|phrase|sentence",
  "meaning": "中文释义（word/phrase用；句子留空）",
  "translation": "整句中文翻译（仅sentence用；其余留空）",
  "note": "可选极短提示，无则空字符串",
  "simple": false
}
所有中文用简体，term 保留英文原文。"""

# 离线演示模式内置小词表（真实使用请配置 OPENAI_API_KEY）。
DEMO_GLOSSARY = {
    "recoil": "畏缩；退避",
    "extraordinary": "非凡的；异乎寻常的",
    "melancholy": "忧郁；伤感",
    "solitude": "独处；孤寂",
    "reluctant": "不情愿的；勉强的",
    "wander": "漫步；游荡",
    "whisper": "低语；耳语",
    "gaze": "凝视；注视",
    "trembling": "颤抖的",
    "vast": "广阔的；巨大的",
    "faint": "微弱的；隐约的",
    "gloom": "昏暗；阴郁",
}
DEMO_PHRASES = {
    "give up": "放弃",
    "look forward to": "期待",
    "in vain": "徒劳；白费",
    "at once": "立刻；同时",
    "make out": "辨认出；理解",
}

app = FastAPI(title="PDF Reading Companion")


class AnnotateRequest(BaseModel):
    selection: str
    context: Optional[str] = None
    level: str = "B2"
    language: str = "简体中文"


def classify(text: str) -> str:
    """按 skill 规则粗略判定选中类型。"""
    stripped = text.strip()
    words = re.findall(r"[A-Za-z']+", stripped)
    if re.search(r"[.!?]", stripped) or len(words) >= 8:
        return "sentence"
    if 2 <= len(words) <= 5:
        return "phrase"
    return "word"


def offline_annotate(text: str, kind: str) -> Optional[dict]:
    """离线词典注释：单词/词组命中 ECDICT/词库时返回结构化注释，否则 None。"""
    if kind == "sentence":
        return None  # 句子翻译交给大模型
    term = text.strip()
    try:
        meaning = DICT.gloss(term)
    except FileNotFoundError:
        # ECDICT 未下载时仍可用词库；词库未命中则返回 None 交由后续处理。
        meaning = DICT.extra_gloss(term)
    if not meaning:
        return None
    from_glossary = DICT.in_glossary(term)
    return {
        "term": term,
        "type": kind,
        "meaning": meaning,
        "translation": "",
        "note": "词库" if from_glossary else "",
        "simple": False,
        "source": "glossary" if from_glossary else "ecdict",
    }


def demo_annotate(text: str, kind: str) -> dict:
    """离线演示注释：查内置词表，命中则给释义，否则提示配置密钥。"""
    key = text.strip().lower().strip(".,!?;:\"'")
    if kind == "sentence":
        return {
            "term": text.strip(),
            "type": "sentence",
            "meaning": "",
            "translation": "（演示模式）请配置 OPENAI_API_KEY 以获得整句中文翻译。",
            "note": "演示",
            "simple": False,
        }
    if kind == "phrase":
        meaning = DEMO_PHRASES.get(key, "（演示模式）配置 OPENAI_API_KEY 获取词组释义")
        return {
            "term": text.strip(),
            "type": "phrase",
            "meaning": meaning,
            "translation": "",
            "note": "" if key in DEMO_PHRASES else "演示",
            "simple": False,
        }
    meaning = DEMO_GLOSSARY.get(key)
    if meaning:
        return {
            "term": text.strip(),
            "type": "word",
            "meaning": meaning,
            "translation": "",
            "note": "",
            "simple": False,
        }
    return {
        "term": text.strip(),
        "type": "word",
        "meaning": "（演示模式）我还不认识这个词，配置 OPENAI_API_KEY 后我就能查啦～",
        "translation": "",
        "note": "演示",
        "simple": False,
    }


def extract_json(content: str) -> Optional[dict]:
    """从模型返回中稳健地取出第一个 JSON 对象。"""
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", content).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
    return None


async def llm_annotate(req: AnnotateRequest, kind: str) -> dict:
    """调用 OpenAI 兼容接口生成注释。"""
    api_key = os.environ["OPENAI_API_KEY"]
    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    user_msg = (
        f"读者水平：CEFR {req.level}。注释语言：{req.language}。\n"
        f"选中文本：{req.selection.strip()}\n"
        f"所在上下文：{(req.context or '（无，仅凭选中文本推断）').strip()}\n"
        f"参考判定类型：{kind}。请按系统提示只返回一个 JSON 对象。"
    )
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base_url}/chat/completions", json=payload, headers=headers
        )
        resp.raise_for_status()
        data = resp.json()
    content = data["choices"][0]["message"]["content"]
    parsed = extract_json(content)
    if not parsed:
        # 解析失败时降级：把模型文本放进 meaning，避免前端拿到空数据。
        return {
            "term": req.selection.strip(),
            "type": kind,
            "meaning": content.strip()[:60],
            "translation": "",
            "note": "",
            "simple": False,
        }
    parsed.setdefault("term", req.selection.strip())
    parsed.setdefault("type", kind)
    parsed.setdefault("meaning", "")
    parsed.setdefault("translation", "")
    parsed.setdefault("note", "")
    parsed.setdefault("simple", False)
    return parsed


@app.post("/api/annotate")
async def annotate(req: AnnotateRequest):
    text = req.selection.strip()
    if not text:
        return JSONResponse(
            status_code=400, content={"error": "selection 不能为空"}
        )
    if len(text) > 2000:
        return JSONResponse(
            status_code=413, content={"error": "选中文本过长，请缩小选择范围"}
        )

    kind = classify(text)

    # 1) 单词/词组优先离线词典，命中即返回，不消耗大模型额度。
    offline = offline_annotate(text, kind)
    if offline:
        offline["demo"] = False
        return offline

    # 2) 离线未命中：句子翻译或生僻词，若配置密钥则调大模型。
    try:
        if os.environ.get("OPENAI_API_KEY"):
            result = await llm_annotate(req, kind)
            result["demo"] = False
            return result
        result = demo_annotate(text, kind)
        result["demo"] = True
        return result
    except Exception as exc:  # 网络/接口异常时降级到演示注释，保证界面不崩。
        fallback = demo_annotate(text, kind)
        fallback["demo"] = True
        fallback["note"] = "接口异常，已降级"
        fallback["error_detail"] = str(exc)[:200]
        return fallback


# 网页静态资源挂在根路径，html=True 使 / 直接返回 index.html。
# 部分精简镜像的 mimetypes 会把 .js 猜成 text/plain，显式注册避免浏览器拒绝执行。
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
