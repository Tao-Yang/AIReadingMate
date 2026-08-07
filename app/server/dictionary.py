"""离线英译中查询：ECDICT 词典 + 明清历史文化词库。

移植自 pdf-english-fiction-annotator/annotator/dictionary.py 并做精简，
用于阅读伴侣的离线注释：单词/词组优先本地命中，无需联网或调用大模型。

- ECDICT (https://github.com/skywind3000/ECDICT)：CSV，列含 word/translation，
  懒加载并缓存，只保留 word -> 中文 translation 映射。
- glossaries：`term,chinese` 两列 CSV，优先于 ECDICT，支持多词词组，
  对威妥玛拼音等旧式罗马字形的弯引号做归一化。
"""

from __future__ import annotations

import csv
import glob
import os
import re
import sqlite3
from typing import Dict, List, Optional, Sequence, Union

# ECDICT 一行可能有多条义项，用 \n 分隔，每条以词性前缀（如 "n. "）开头。
_POS_PREFIX_RE = re.compile(r"^[a-z]{1,5}\.\s*")
# 威妥玛拼音的送气符常被排版成弯引号，统一归一化到直引号以便匹配。
_APOSTROPHE_RE = re.compile(r"[\u2018\u2019\u02bc\u00b4`]")


def _normalize_key(word: str) -> str:
    return _APOSTROPHE_RE.sub("'", word.strip().lower())


class Dictionary:
    """懒加载的 ECDICT 查询，可选叠加历史文化词库（优先命中）。"""

    def __init__(
        self,
        ecdict_path: str,
        extra_path: Optional[Union[str, Sequence[str]]] = None,
    ) -> None:
        self._path = ecdict_path
        self._table: Optional[Dict[str, str]] = None
        self._db: Optional[sqlite3.Connection] = None
        self._cache: Dict[str, Optional[str]] = {}
        self._extra_path = extra_path
        self._extra_table: Optional[Dict[str, str]] = None

    # ---- 历史文化词库 ----

    def _extra_csv_paths(self) -> List[str]:
        raw = self._extra_path
        if not raw:
            return []
        candidates: Sequence[str] = [raw] if isinstance(raw, str) else raw
        paths: List[str] = []
        for candidate in candidates:
            if os.path.isdir(candidate):
                paths.extend(sorted(glob.glob(os.path.join(candidate, "*.csv"))))
            elif os.path.isfile(candidate):
                paths.append(candidate)
        return paths

    def _load_extra(self) -> Dict[str, str]:
        if self._extra_table is not None:
            return self._extra_table
        table: Dict[str, str] = {}
        for path in self._extra_csv_paths():
            with open(path, "r", encoding="utf-8-sig", newline="") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    term = _normalize_key(row.get("term") or "")
                    gloss = (row.get("chinese") or "").strip()
                    if term and gloss:
                        table[term] = gloss
        self._extra_table = table
        return table

    # ---- ECDICT ----

    def _ensure_loaded(self) -> Dict[str, str]:
        if self._table is not None:
            return self._table
        if not os.path.isfile(self._path):
            raise FileNotFoundError(
                "ECDICT csv not found at %r. 请先运行 download_ecdict.py 下载。"
                % self._path
            )
        table: Dict[str, str] = {}
        with open(self._path, "r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                word = (row.get("word") or "").strip().lower()
                translation = (row.get("translation") or "").strip()
                if word and translation:
                    table[word] = translation
        self._table = table
        return table

    def has_ecdict(self) -> bool:
        return bool(self._path) and os.path.isfile(self._path)

    def _raw_gloss(self, word: str) -> Optional[str]:
        key = _normalize_key(word)
        if key in self._cache:
            return self._cache[key]

        extra = self._load_extra().get(key)
        if extra:
            if len(self._cache) >= 8192:
                self._cache.clear()
            self._cache[key] = extra
            return extra

        if not self.has_ecdict():
            self._cache[key] = None
            return None

        if self._path.lower().endswith((".sqlite", ".sqlite3", ".db")):
            if self._db is None:
                self._db = sqlite3.connect(
                    "file:%s?mode=ro" % os.path.abspath(self._path).replace("\\", "/"),
                    uri=True,
                )
            row = self._db.execute(
                "SELECT translation FROM entries WHERE word = ?", (key,)
            ).fetchone()
            raw = row[0] if row else None
        else:
            raw = self._ensure_loaded().get(key)

        if len(self._cache) >= 8192:
            self._cache.clear()
        self._cache[key] = raw
        return raw

    # ---- 对外查询 ----

    def gloss(self, word: str) -> Optional[str]:
        """返回简明中文释义；先词库后 ECDICT，命中后压缩为一两条短义。"""
        raw = self._raw_gloss(word)
        if not raw:
            return None
        return self._condense(raw)

    def extra_gloss(self, word: str) -> Optional[str]:
        """仅查历史文化词库，不回落 ECDICT。"""
        raw = self._load_extra().get(_normalize_key(word))
        if not raw:
            return None
        return self._condense(raw)

    def in_glossary(self, word: str) -> bool:
        return _normalize_key(word) in self._load_extra()

    @staticmethod
    def _condense(raw: str) -> str:
        senses = [s.strip() for s in raw.replace("\\n", "\n").split("\n") if s.strip()]
        cleaned: List[str] = []
        for sense in senses:
            sense = _POS_PREFIX_RE.sub("", sense).strip()
            if sense:
                cleaned.append(sense)
            if len(cleaned) >= 2:
                break
        if not cleaned:
            return raw.strip()
        note = "；".join(cleaned)
        if len(note) > 20:
            note = note[:20] + "…"
        return note
