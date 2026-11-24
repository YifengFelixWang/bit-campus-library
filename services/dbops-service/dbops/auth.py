"""通过身份服务校验请求。浏览器只持网页登录令牌，不提交数据库账号。"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from .config import Config


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class Principal:
    user_id: int
    username: str
    roles: list[str]

    def has_role(self, role: str) -> bool:
        return role.upper() in {item.upper() for item in self.roles}


class Authenticator:
    """调用身份服务 /users/me，并做短时缓存，避免每 2 秒轮询都打一次身份库。"""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._lock = threading.Lock()
        self._cache: dict[str, tuple[float, Principal]] = {}
        self._ttl = 5.0

    def _lookup(self, authorization: str) -> Principal:
        request = urllib.request.Request(
            self.config.identity_url + "/users/me",
            headers={"Authorization": authorization, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise AuthError(401, "UNAUTHORIZED", "登录状态无效或已过期") from exc
            raise AuthError(503, "IDENTITY_UNAVAILABLE", "身份服务返回 %s" % exc.code) from exc
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise AuthError(503, "IDENTITY_UNAVAILABLE", "身份服务不可达") from exc

        if not isinstance(payload, dict) or not payload.get("username"):
            raise AuthError(401, "UNAUTHORIZED", "身份服务响应不完整")
        roles = payload.get("roles") or []
        if not isinstance(roles, list):
            roles = [str(roles)]
        return Principal(
            user_id=int(payload.get("id") or 0),
            username=str(payload.get("username")),
            roles=[str(item) for item in roles],
        )

    def authenticate(self, header: str | None, require_operator: bool = False) -> Principal:
        if not header or not header.startswith("Bearer "):
            raise AuthError(401, "UNAUTHORIZED", "缺少登录令牌")
        token = header[7:].strip()
        if not token:
            raise AuthError(401, "UNAUTHORIZED", "缺少登录令牌")

        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(token)
            if cached and now - cached[0] < self._ttl:
                principal = cached[1]
            else:
                principal = None
        if principal is None:
            principal = self._lookup(header)
            with self._lock:
                self._cache[token] = (now, principal)
                if len(self._cache) > 200:
                    for key, (stamp, _) in list(self._cache.items()):
                        if now - stamp > self._ttl * 4:
                            self._cache.pop(key, None)

        if require_operator and not principal.has_role(self.config.required_role):
            raise AuthError(403, "FORBIDDEN", "该账号没有运维管理权限")
        return principal
