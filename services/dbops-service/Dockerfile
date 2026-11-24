# dbops-service：运维执行器镜像
# 只带 Python 标准库 + docker CLI，实际数据库工具在 openGauss 容器内执行
FROM docker:27-cli AS dockercli

FROM python:3.12-slim

ENV TZ=Asia/Shanghai \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app
COPY server.py ./
COPY dbops ./dbops

RUN mkdir -p /backup /var/lib/dbops/tasks

EXPOSE 18085

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:18085/api/ops/health',timeout=3)"

CMD ["python", "server.py"]
