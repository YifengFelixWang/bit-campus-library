"""dbops-service 启动入口。

用法：
    python server.py

默认监听 18085，接口全部在 /api/ops/ 下。页面经 Nginx 或 deploy/dev-server.py
同源代理访问；服务本身不接触业务库的表结构，只执行备份、恢复和切换动作。
"""

from __future__ import annotations

import json
import sys
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from dbops.api import Application
from dbops.config import Config


class Handler(BaseHTTPRequestHandler):
    server_version = "dbops-service/1.0"
    protocol_version = "HTTP/1.1"
    app: Application

    def _headers(self) -> dict[str, str]:
        return {key.lower(): value for key, value in self.headers.items()}

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        if length > 64 * 1024:
            raise ValueError("请求体过大")
        return self.rfile.read(length)

    def _respond(self, status: int, payload: dict, request_id: str) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Request-Id", request_id)
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method: str) -> None:
        request_id = self.headers.get("X-Request-Id") or uuid.uuid4().hex[:12]
        started = time.monotonic()
        try:
            body = self._read_body()
            status, payload = self.app.dispatch(method, self.path, self._headers(), body)
        except ValueError as exc:
            status, payload = 400, {"code": "BAD_REQUEST", "message": str(exc), "data": None}
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            status, payload = 500, {"code": "INTERNAL_ERROR",
                                    "message": "%s: %s" % (exc.__class__.__name__, exc), "data": None}
        duration = int((time.monotonic() - started) * 1000)
        print("[dbops] %s %s -> %s %s %dms" % (method, self.path, status,
                                                (payload or {}).get("code", ""), duration),
              file=sys.stdout, flush=True)
        self._respond(status, payload, request_id)

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # 默认访问日志与业务日志重复，保留错误输出即可
        return


def main() -> int:
    config = Config()
    app = Application(config)
    Handler.app = app
    server = ThreadingHTTPServer(("0.0.0.0", config.port), Handler)
    server.daemon_threads = True

    print("dbops-service %s 启动：http://0.0.0.0:%d/api/ops/health" % (config.version, config.port))
    print("  执行模式：%s  数据库容器：%s  备节点容器：%s" % (
        config.exec_mode, config.db_container, config.standby_container or "未配置（单实例）"))
    print("  备份目录：%s  任务目录：%s" % (config.backup_dir, config.task_dir))
    if config.standby_container:
        print("  页面展示地址：node-a %s:%d  node-b %s:%d" % (
            config.node_a_host, config.node_a_port, config.node_b_host, config.node_b_port))
    for problem in config.problems():
        print("  [配置提示] " + problem)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
