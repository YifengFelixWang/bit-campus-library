"""HTTP 路由与响应封装。"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs, urlparse

from .auth import AuthError, Authenticator
from .config import Config
from .executor import Executor, ExecutorError
from .manager import TaskManager
from .operations import OperationError, Operations
from .status import StatusCollector
from .tasks import TaskStore


def ok(data: Any) -> dict[str, Any]:
    return {"code": "OK", "message": "", "data": data}


def fail(code: str, message: str) -> dict[str, Any]:
    return {"code": code, "message": message, "data": None}


class Application:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.executor = Executor(config)
        self.auth = Authenticator(config)
        self.store = TaskStore(config)
        self.status = StatusCollector(config, self.executor)
        self.operations = Operations(config, self.executor, self.store, self.status)
        self.manager = TaskManager(config, self.store, self.operations)

    # ---------------------------------------------------------------- 路由
    def dispatch(self, method: str, raw_path: str, headers: dict[str, str],
                 body: bytes) -> tuple[int, dict[str, Any]]:
        parsed = urlparse(raw_path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        authorization = headers.get("authorization") or headers.get("Authorization")

        try:
            if path == "/api/ops/health":
                return 200, ok({"status": "UP", "service": self.config.service_name,
                                "version": self.config.version, "tasks": self.store.count()})

            if path == "/api/ops/status" and method == "GET":
                principal = self.auth.authenticate(authorization, require_operator=False)
                force = (query.get("refresh") or ["0"])[0] in ("1", "true")
                data = self.status.collect(force=force)
                data["viewer"] = {"username": principal.username, "roles": principal.roles}
                return 200, ok(data)

            if path == "/api/ops/backups" and method == "GET":
                self.auth.authenticate(authorization, require_operator=True)
                items = self.manager.backups()
                total = sum(item.get("sizeBytes") or 0 for item in items)
                return 200, ok({"items": items, "totalBytes": total,
                                "backupDir": str(self.config.backup_dir)})

            if path == "/api/ops/backups" and method == "POST":
                principal = self.auth.authenticate(authorization, require_operator=True)
                payload = self._json(body)
                task = self.manager.submit("backup", principal.username, {"note": payload.get("note", "")})
                return 202, ok(task)

            if path == "/api/ops/tasks" and method == "GET":
                self.auth.authenticate(authorization, require_operator=True)
                limit = int((query.get("limit") or ["20"])[0])
                return 200, ok({"items": self.manager.list(limit)})

            if path.startswith("/api/ops/tasks/") and method == "GET":
                self.auth.authenticate(authorization, require_operator=True)
                task_id = path.rsplit("/", 1)[-1]
                task = self.manager.get(task_id)
                if task is None:
                    raise OperationError("任务不存在")
                return 200, ok(task)

            if path == "/api/ops/restores" and method == "POST":
                principal = self.auth.authenticate(authorization, require_operator=True)
                payload = self._json(body)
                if payload.get("confirm") is not True:
                    raise OperationError("恢复前必须确认目标验证库")
                task = self.manager.submit("restore", principal.username, {
                    "backupId": payload.get("backupId", ""),
                    "targetDatabase": payload.get("targetDatabase", self.config.verify_db_prefix),
                    "confirm": True,
                })
                return 202, ok(task)

            if path == "/api/ops/switchover" and method == "POST":
                principal = self.auth.authenticate(authorization, require_operator=True)
                payload = self._json(body)
                if payload.get("confirm") is not True:
                    raise OperationError("切换前必须确认目标环境")
                task = self.manager.submit("switchover", principal.username, {"confirm": True})
                return 202, ok(task)

            return 404, fail("NOT_FOUND", "接口不存在：%s" % path)
        except AuthError as exc:
            return exc.status, fail(exc.code, exc.message)
        except OperationError as exc:
            return 409, fail("CONFLICT", str(exc))
        except ExecutorError as exc:
            return 503, fail("EXECUTOR_UNAVAILABLE", str(exc))
        except ValueError as exc:
            return 400, fail("BAD_REQUEST", str(exc))
        except Exception as exc:  # noqa: BLE001 - 统一给页面可读错误，详细堆栈在服务日志
            return 500, fail("INTERNAL_ERROR", "%s: %s" % (exc.__class__.__name__, exc))

    @staticmethod
    def _json(body: bytes) -> dict[str, Any]:
        if not body:
            return {}
        if len(body) > 64 * 1024:
            raise ValueError("请求体过大")
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise ValueError("请求体不是合法 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return payload
