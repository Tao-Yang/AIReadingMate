# 阅读伴侣后端镜像：FastAPI + 静态网页（PDF 阅读器 + 熊猫机器人）
# 同时适用于 Render / Railway 与 Hugging Face Space（默认端口 7860）。
FROM python:3.11-slim

WORKDIR /srv

# 先装依赖，利用缓存
COPY app/server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目
COPY . .

# 构建时下载 ECDICT 词典（约 65MB），使云端也能离线查词
RUN python app/server/download_ecdict.py

# Hugging Face Space 默认 7860；Render/Railway 会用自己的 $PORT 覆盖
ENV PORT=7860 HOST=0.0.0.0
EXPOSE 7860

CMD ["python", "app/server/app.py"]
