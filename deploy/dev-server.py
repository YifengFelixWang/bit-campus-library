"""
前端本地服务：静态托管 + 反向代理（替代 Nginx，不依赖 Docker 镜像）。

用法：
    python deploy/dev-server.py            # 默认 8080
    python deploy/dev-server.py 8080

路由规则与 deploy/nginx.conf 一致：
    /api/catalog/**  -> 127.0.0.1:8082  (catalog-service)
    /api/reports/**  -> 127.0.0.1:18084 (report-service)
    /api/**          -> 127.0.0.1:8083  (loan-service)
    /users/**        -> 127.0.0.1:8081  (identity-service)
    其他             -> web/ 下的静态文件

这样浏览器看到的是同源请求，不会触发跨域，后端也不需要配置 CORS。
"""

import os
import sys
import json
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
ROOT = os.path.normpath(ROOT)

ROUTES = [
    ("/api/catalog/", os.getenv("CATALOG_SERVICE_URL", "http://127.0.0.1:8082")),
    ("/api/ops/", os.getenv("DBOPS_SERVICE_URL", "http://127.0.0.1:18085")),
    ("/auth/", os.getenv("IDENTITY_SERVICE_URL", "http://127.0.0.1:8081")),
    ("/users/", os.getenv("IDENTITY_SERVICE_URL", "http://127.0.0.1:8081")),
    ("/api/reports/", os.getenv("REPORT_SERVICE_URL", "http://127.0.0.1:18084")),
    ("/api/", os.getenv("LOAN_SERVICE_URL", "http://127.0.0.1:8083")),
]

FORWARD_HEADERS = ("authorization", "content-type", "accept", "x-request-id")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 本地开发绝不缓存：改完 js 直接刷新就能生效。
        # 之前没有这个头，浏览器会按启发式规则把 src/*.js 缓存住，
        # 于是「后端已经改了权限、前端却还是旧逻辑」，表现为改了身份也看不到控制台。
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))

    def _target_for(self, path):
        for prefix, base in ROUTES:
            if path.startswith(prefix):
                return base + path
        return None

    def _proxy(self, method):
        target = self._target_for(self.path)
        if not target:
            return False

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        req = urllib.request.Request(target, data=body, method=method)
        for name in FORWARD_HEADERS:
            value = self.headers.get(name)
            if value:
                req.add_header(name, value)
        if body is not None and not req.get_header("Content-type"):
            req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                ctype = resp.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:  # 服务没起时给出可读提示，而不是浏览器空白
            message = json.dumps({"code":"UPSTREAM_DOWN","message":"后端服务不可用"}, ensure_ascii=False)
            data = message.encode("utf-8")
            self.send_response(503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        return True

    def do_GET(self):
        if not self._proxy("GET"):
            super().do_GET()

    def do_POST(self):
        if not self._proxy("POST"):
            self.send_error(404)

    def do_PUT(self):
        if not self._proxy("PUT"):
            self.send_error(404)

    def do_PATCH(self):
        if not self._proxy("PATCH"):
            self.send_error(404)

    def do_DELETE(self):
        if not self._proxy("DELETE"):
            self.send_error(404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("前端服务已启动：http://localhost:%d" % port)
    print("  静态目录：%s" % ROOT)
    print("  /api/catalog/ -> 8082   /api/ops/ -> 18085   /api/reports/ -> 18084   /api/ -> 8083   /users/ -> 8081")
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
