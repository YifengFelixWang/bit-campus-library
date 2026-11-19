"""Local integration stub only. Never deploy with the application."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
TOKENS = {'demo-reader-1': {'id': 1, 'roles': ['READER'], 'username': 'reader01'},
          'demo-reader-2': {'id': 2, 'roles': ['READER'], 'username': 'reader02'},
          'demo-librarian': {'id': 3, 'roles': ['LIBRARIAN'], 'username': 'librarian01'},
          'demo-sync': {'id': 0, 'roles': [], 'username': 'sync-bot'}}
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        user = TOKENS.get(self.headers.get('Authorization', '').removeprefix('Bearer '))
        valid = user is not None and self.path == '/users/me'
        self.send_response(200 if valid else 401)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(user if valid else {'error': 'unauthorized'}).encode())
    def log_message(self, *args):
        pass
if __name__ == '__main__':
    print('Local identity stub listening at 127.0.0.1:8081; demo tokens only')
    ThreadingHTTPServer.request_queue_size = 64
    ThreadingHTTPServer(('127.0.0.1', 8081), Handler).serve_forever()
