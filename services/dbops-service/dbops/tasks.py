"""任务记录。

任务日志与业务库分离：写在 OPS_TASK_DIR 的 JSON 文件里，业务库停机时仍可查看；
每个任务原子替换写入，避免页面轮询读到半个文件。
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import Config

TASK_ID_PATTERN = re.compile(r"OP[0-9]{8}-[0-9]{6}-[0-9a-f]{4}")


class TaskStore:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.root = config.task_dir
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _path(self, task_id: str) -> Path:
        if not TASK_ID_PATTERN.fullmatch(task_id):
            raise ValueError("任务编号格式不正确")
        return self.root / (task_id + ".json")

    def _write(self, task: dict[str, Any]) -> None:
        path = self._path(task["id"])
        temp = path.with_suffix(".json.tmp")
        with temp.open("w", encoding="utf-8") as handle:
            json.dump(task, handle, ensure_ascii=False, indent=2)
        os.replace(temp, path)

    def create(self, action: str, label: str, actor: str, params: dict[str, Any]) -> dict[str, Any]:
        moment: datetime = self.config.now()
        task_id = "OP%s-%s" % (moment.strftime("%Y%m%d"), moment.strftime("%H%M%S"))
        task_id += "-" + secrets.token_hex(2)
        task = {
            "id": task_id,
            "action": action,
            "actionLabel": label,
            "status": "QUEUED",
            "actor": actor,
            "params": params,
            "createdAt": self.config.iso(moment),
            "startedAt": None,
            "finishedAt": None,
            "steps": [],
            "result": None,
            "error": None,
            "log": "",
            "version": self.config.version,
        }
        with self._lock:
            self._write(task)
        return task

    def get(self, task_id: str) -> dict[str, Any] | None:
        path = self._path(task_id)
        with self._lock:
            if not path.exists():
                return None
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None

    def list(self, limit: int = 20) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 100))
        files = sorted(self.root.glob("OP*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        items: list[dict[str, Any]] = []
        for path in files[:limit]:
            with self._lock:
                try:
                    items.append(json.loads(path.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    continue
        return items

    def update(self, task_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            task = self.get(task_id)
            if task is None:
                raise KeyError(task_id)
            task.update(fields)
            self._write(task)
            return task

    def append_log(self, task_id: str, line: str) -> dict[str, Any]:
        with self._lock:
            task = self.get(task_id)
            if task is None:
                raise KeyError(task_id)
            text = (task.get("log") or "") + line.rstrip() + "\n"
            if len(text) > self.config.max_log_chars:
                text = "……（前部日志已截断）……\n" + text[-self.config.max_log_chars:]
            task["log"] = text
            self._write(task)
            return task

    def add_step(self, task_id: str, name: str) -> int:
        with self._lock:
            task = self.get(task_id)
            if task is None:
                raise KeyError(task_id)
            index = len(task["steps"])
            task["steps"].append({
                "name": name,
                "status": "RUNNING",
                "startedAt": self.config.iso(),
                "finishedAt": None,
                "detail": "",
            })
            self._write(task)
            return index

    def finish_step(self, task_id: str, index: int, status: str, detail: str = "") -> None:
        with self._lock:
            task = self.get(task_id)
            if task is None:
                raise KeyError(task_id)
            if 0 <= index < len(task["steps"]):
                step = task["steps"][index]
                step["status"] = status
                step["finishedAt"] = self.config.iso()
                if detail:
                    step["detail"] = detail[:2000]
                self._write(task)

    def count(self) -> int:
        return len(list(self.root.glob("OP*.json")))
