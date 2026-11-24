"""HTTP 冒烟测试：不依赖真实数据库，用假身份服务验证鉴权、状态降级与任务落盘。

用法：python tests/smoke_http.py
退出码 0 表示全部断言通过。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

IDENTITIES = {
    "ops-token": {"id": 1, "username": "ops1", "roles": ["OPERATOR"]},
    "reader-token": {"id": 2, "username": "reader01", "roles": ["READER"]},
}


class IdentityHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        token = (self.headers.get("Authorization") or "")[7:].strip()
        payload = IDENTITIES.get(token)
        status = 200 if payload else 401
        body = json.dumps(payload or {"message": "invalid"}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args) -> None:
        return


def http(url: str, method: str = "GET", token: str | None = None,
         payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def main() -> int:
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        checks.append((name, condition, detail))
        print("%s %s%s" % ("PASS" if condition else "FAIL", name,
                          "  " + detail if detail else ""))

    with tempfile.TemporaryDirectory() as temp:
        tasks = Path(temp) / "tasks"
        backups = Path(temp) / "backups"
        tasks.mkdir()
        backups.mkdir()

        identity = ThreadingHTTPServer(("127.0.0.1", 0), IdentityHandler)
        identity.daemon_threads = True
        threading.Thread(target=identity.serve_forever, daemon=True).start()

        os.environ.update({
            "IDENTITY_URL": "http://127.0.0.1:%d" % identity.server_port,
            "OPS_EXEC_MODE": "docker",
            "OPS_DB_PASSWORD": "dummy-password",
            "OPS_DB_CONTAINER": "library-opengauss-missing",
            "OPS_STANDBY_CONTAINER": "",
            "OPS_BACKUP_DIR": str(backups),
            "OPS_TASK_DIR": str(tasks),
            "OPS_CHECKLIST_SQL": str(ROOT / "tests" / "missing.sql"),
            "OPS_STATUS_CACHE_SECONDS": "0",
            "DBOPS_PORT": "0",
        })

        from dbops.api import Application  # noqa: E402
        from dbops.config import Config  # noqa: E402
        import server as dbops_server  # noqa: E402

        app = Application(Config())
        dbops_server.Handler.app = app
        api = ThreadingHTTPServer(("127.0.0.1", 0), dbops_server.Handler)
        api.daemon_threads = True
        threading.Thread(target=api.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d" % api.server_port

        try:
            status, body = http(base + "/api/ops/health")
            check("health 无需令牌返回 200/UP", status == 200 and body["data"]["status"] == "UP")

            status, body = http(base + "/api/ops/status")
            check("status 无令牌返回 401", status == 401 and body["code"] == "UNAUTHORIZED",
                  "实际 %s" % status)

            status, body = http(base + "/api/ops/status", token="reader-token")
            data = body.get("data") or {}
            check("普通用户可读 status", status == 200 and data.get("viewer", {}).get("username") == "reader01")
            check("无 docker 时数据库降级为不可达", data.get("database", {}).get("reachable") is False)
            check("无备节点时复制状态为 SINGLE",
                  data.get("replication", {}).get("state") == "SINGLE",
                  "实际 %s" % data.get("replication"))

            status, body = http(base + "/api/ops/backups", method="POST", token="reader-token", payload={})
            check("reader 提交备份返回 403", status == 403 and body["code"] == "FORBIDDEN",
                  "实际 %s" % status)

            status, body = http(base + "/api/ops/restores", method="POST", token="ops-token",
                                payload={"backupId": "x.dump", "targetDatabase": "library_verify_x"})
            check("恢复缺少 confirm 返回 409", status == 409 and body["code"] == "CONFLICT",
                  "实际 %s" % status)

            status, body = http(base + "/api/ops/backups", method="POST", token="ops-token",
                                payload={"note": "smoke"})
            task_id = (body.get("data") or {}).get("id", "")
            check("ops1 提交备份返回 202", status == 202 and bool(task_id), "task=%s" % task_id)

            deadline = time.time() + 30
            task = {}
            while time.time() < deadline:
                code, detail = http(base + "/api/ops/tasks/%s" % task_id, token="ops-token")
                task = detail.get("data") or {}
                if task.get("status") in ("SUCCEEDED", "FAILED"):
                    break
                time.sleep(0.5)
            check("任务进入终态并保留失败原因", task.get("status") == "FAILED",
                  "status=%s error=%s" % (task.get("status"), (task.get("error") or "")[:80]))
            check("任务文件已落盘到业务库之外",
                  (tasks / (task_id + ".json")).exists(), str(tasks / (task_id + ".json")))

            status, body = http(base + "/api/ops/tasks?limit=5", token="ops-token")
            check("任务列表包含刚提交的任务",
                  status == 200 and any(item.get("id") == task_id for item in body["data"]["items"]))
        finally:
            api.shutdown()
            identity.shutdown()

    failed = [item for item in checks if not item[1]]
    print("\n%d 项检查，%d 通过，%d 失败" % (len(checks), len(checks) - len(failed), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
