# 阅读伴侣 · PDF Reading Companion

一个可独立运行的英文 PDF **动态阅读伴侣**：在网页里打开 PDF，划选任意英文单词 / 词组 / 句子，
角落里的**可爱 3D 卡通机器人**会立刻"思考"并在选中处旁弹出中文注释气泡。

注释生成规则复用同目录 skill [`pdf-reading-companion`](SKILL.md)，
即静态 skill `pdf-english-fiction-annotator` 的"选词判断 + 释义生成"原则。

## 特性

- 网页版 PDF 阅读器（基于 PDF.js，带可选择文本层）。
- 划词即注释：单词给语境义，词组给整体释义，句子给整句翻译。
- 3D 卡通机器人（Three.js）：漂浮、眨眼，划词时"思考"，出注释时"开心"。
- **离线优先**的三级注释来源：
  1. **离线词典**：单词/词组优先查本地 [ECDICT](https://github.com/skywind3000/ECDICT) +
     明清历史文化词库（`data/glossaries/` 四套 CSV，已随附）。命中即返回，**无需联网、不消耗额度**。
  2. **大模型**：离线未命中的生僻词，以及所有句子翻译；配置 `OPENAI_API_KEY` 时调用。
  3. **演示兜底**：既没命中又没配密钥时，返回友好提示，保证开箱即用。

## 运行

需要 Python 3.10+。

```powershell
cd app/server
pip install -r requirements.txt
python app.py
```

浏览器打开 http://127.0.0.1:8000 ，点击"打开 PDF"，选一本英文小说，划词试试。

随附的历史文化词库开箱即用。想让**普通英文单词**也走离线，先下载 ECDICT（约 65 MB）：

```powershell
cd app/server
py -3 download_ecdict.py      # 下载到 app/data/ecdict.csv
```

下载后，单词/词组会优先离线查词典，命中就不再调用大模型。

### 启用真实注释（可选）

设置环境变量后再启动（OpenAI 兼容接口）：

```powershell
$env:OPENAI_API_KEY = "你的密钥"
# 可选：自定义服务地址与模型
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_MODEL = "gpt-4o-mini"
python app.py
```

密钥只在后端使用，不会下发到网页端。

## 目录

```
.
├── SKILL.md               # 动态阅读伴侣 skill 文档
├── Dockerfile             # 后端镜像（Render / HF Space）
├── render.yaml            # Render 一键部署
├── netlify.toml           # Netlify 发布配置
├── netlify/
│   └── index.html         # 宜纸风落地页
├── app/
│   ├── server/
│   │   ├── app.py            # FastAPI：静态站点 + /api/annotate
│   │   ├── dictionary.py     # ECDICT + 历史文化词库离线查询
│   │   ├── download_ecdict.py# 下载 ECDICT 词典脚本
│   │   └── requirements.txt
│   ├── data/
│   │   ├── ecdict.csv        # ECDICT 词典（按需下载，不随附）
│   │   └── glossaries/       # 明清历史文化词库（四套，已随附）
│   │       ├── official_titles.csv
│   │       ├── figures.csv
│   │       ├── places.csv
│   │       └── idioms.csv
│   └── web/
│       ├── index.html        # 阅读器 + 机器人舞台
│       ├── styles.css        # 样式与气泡
│       ├── app.js            # PDF 渲染、划词、调后端、驱动机器人
│       └── robot.js          # Three.js 3D 卡通机器人
└── README.md
```

## 说明与边界

- 本应用只读取你本地打开的 PDF，不修改、不上传原文件。
- 划词时会把"选中文本 + 其周围少量上下文"发给注释接口用于消歧。
- 需要联网加载 PDF.js / Three.js（CDN）与调用大模型接口（若启用）。
