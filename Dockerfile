FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SCHEDULE_DATA_DIR=/data

WORKDIR /app

# 国内构建可保留默认镜像源；其它网络环境用 --build-arg PIP_INDEX_URL= 覆盖为空即可走官方源
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
COPY requirements.txt ./
RUN pip install --no-cache-dir -i "${PIP_INDEX_URL}" -r requirements.txt

# 只读资源随镜像打包（行政区划树、教学点种子库）与应用代码
COPY core.py locations.json china_regions.json ./
COPY webapp ./webapp

VOLUME ["/data"]
EXPOSE 3066

CMD ["uvicorn", "webapp.main:app", "--host", "0.0.0.0", "--port", "3066"]