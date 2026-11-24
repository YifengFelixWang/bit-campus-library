"""后台任务队列：同一时间只执行一个数据库运维动作，避免恢复与切换并发。"""

from __future__ import annotations

import queue
import threading
import traceback
from typing import Any, Callable

from .config import Config
from .executor import ExecutorError
from .operations import OperationError, Operations
from .tasks import TaskStore

ACTION_LABELS = {
    "backup": "创建数据库备份",
    "restore": "恢复到验证库并核对",
    "switchover": "计划内主备切换",
}


class TaskManager:
    def __init__(self, config: Config, store: TaskStore, operations: Operations) -> None:
        self.config = config
        self.store = store
        self.operations = operations
        self._queue: queue.Queue[tuple[str, str] | None] = queue.Queue(maxsize=20)
        self._worker = threading.Thread(target=self._loop, name="dbops-worker", daemon=True)
        self._worker.start()
        self._running = threading.Event()
        self._stopping = False

    # ---------------------------------------------------------------- 对外
    def submit(self, action: str, actor: str, params: dict[str, Any]) -> dict[str, Any]:
        if action not in ACTION_LABELS:
            raise ValueError("不支持的操作：%s" % action)
        if self._queue.full():
            raise OperationError("任务队列已满，请等待当前任务完成")
        task = self.store.create(action, ACTION_LABELS[action], actor, self._clean(params))
        try:
            self._queue.put_nowait((action, task["id"]))
        except queue.Full as exc:
            self.store.update(task["id"], status="FAILED", finishedAt=self.config.iso(),
                              error="任务队列已满，未开始执行")
            raise OperationError("任务队列已满，请等待当前任务完成") from exc
        return task

    def get(self, task_id: str) -> dict[str, Any] | None:
        return self.store.get(task_id)

    def list(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.store.list(limit)

    def backups(self) -> list[dict[str, Any]]:
        return self.operations.list_backups()

    def busy(self) -> bool:
        return self._running.is_set()

    # ---------------------------------------------------------------- 内部
    @staticmethod
    def _clean(params: dict[str, Any]) -> dict[str, Any]:
        allowed = {}
        for key in ("note", "backupId", "targetDatabase"):
            value = params.get(key)
            if isinstance(value, str):
                allowed[key] = value.strip()[:160]
        if params.get("confirm") is True:
            allowed["confirm"] = True
        return allowed

    def _loop(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                break
            action, task_id = item
            if not task_id:
                continue
            self._running.set()
            try:
                self.store.update(task_id, status="RUNNING", startedAt=self.config.iso())
                handler: Callable[[str, str, dict[str, Any]], dict[str, Any]] = getattr(self.operations, action)
                task = self.store.get(task_id) or {}
                params = task.get("params") or {}
                actor = task.get("actor") or ""
                result = handler(task_id, actor, params)
                self.store.update(task_id, status="SUCCEEDED", finishedAt=self.config.iso(), result=result)
            except OperationError as exc:
                self.store.update(task_id, status="FAILED", finishedAt=self.config.iso(),
                                  error=self._safe_error(str(exc)))
                self.store.append_log(task_id, "失败：%s" % self._safe_error(str(exc)))
            except ExecutorError as exc:
                message = "执行器不可用：%s" % exc
                self.store.update(task_id, status="FAILED", finishedAt=self.config.iso(),
                                  error=self._safe_error(message))
                self.store.append_log(task_id, message)
            except Exception as exc:  # noqa: BLE001 - 后台任务需要把异常留给页面
                message = "内部错误：%s: %s" % (exc.__class__.__name__, exc)
                self.store.update(task_id, status="FAILED", finishedAt=self.config.iso(),
                                  error=self._safe_error(message))
                self.store.append_log(task_id, traceback.format_exc()[-4000:])
            finally:
                self._running.clear()
                self._queue.task_done()

    def _safe_error(self, message: str) -> str:
        secret = self.config.db_password
        if secret:
            return message.replace(secret, "******")
        return message[:1200]
