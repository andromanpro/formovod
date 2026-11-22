"""Serve the live pixels of a managed Chromium tab on this machine only."""

import asyncio
import base64
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from secrets import token_urlsafe
from threading import Condition, Thread

from playwright.async_api import Error as PlaywrightError


VIEWER = '''<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Живая вкладка 1С</title>
<style>
html,body{height:100%;margin:0;background:#191d25}
body{display:grid;place-items:center}
img{display:block;width:100%;height:100%;object-fit:contain;color:white}
</style>
<img src="stream" alt="Живая вкладка 1С · Visual MCP">
</html>
'''.encode('utf-8')


class LivePreview:
    def __init__(self, workspace=False):
        self.path = '/' + token_urlsafe(24) + '/'
        self.ready = Condition()
        self.frame = b''
        self.sequence = 0
        self.closed = False
        self.session = None
        self.http = None
        self.thread = None
        self.workspace = workspace
        self.paused = False
        self.actions = {}
        self.recent = deque(maxlen=28)
        self.action_sequence = 0
        self.targets = {}
        self.tracker = None

    async def start(self, page):
        await self.bind_page(page)
        return self.serve_frames()

    def serve_frames(self):
        """Start the same local, token-addressed viewer for a live frame producer."""
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), self.handler())
        self.thread = Thread(target=self.http.serve_forever, kwargs={'poll_interval': .12}, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.http.server_port}'
        return self.origin + self.path

    def publish_jpeg(self,frame):
        with self.ready:
            self.frame=frame
            self.sequence+=1
            self.ready.notify_all()

    async def bind_page(self,page):
        session=await page.context.new_cdp_session(page)
        async def frame(event):
            if self.session is session:await self.receive_frame(event)
            else:await session.send('Page.screencastFrameAck',{'sessionId':event['sessionId']})
        session.on('Page.screencastFrame',frame)
        try:
            await session.send('Page.startScreencast',{'format':'jpeg','quality':88,'maxWidth':1440,'maxHeight':900})
        except BaseException:
            await session.detach()
            raise
        old=self.session
        self.session=session
        if self.tracker:
            self.tracker.cancel()
            await asyncio.gather(self.tracker,return_exceptions=True)
        if old:
            try:await old.detach()
            except PlaywrightError:pass
        with self.ready:self.frame=b'';self.targets={}
        self.reset_actions()
        if self.workspace:self.tracker=asyncio.create_task(self.track_targets(page))

    async def track_targets(self, page):
        while not self.closed:
            try:
                geometry = await page.evaluate("""() => {
                    const overlay = document.getElementById('testpilot-live-overlay');
                    if (!overlay) return {};
                    overlay.dataset.workspace = '1';
                    return JSON.parse(overlay.dataset.workspaceTargets || '{}');
                }""")
            except PlaywrightError:
                geometry = {}
            with self.ready:
                self.targets = geometry
            await asyncio.sleep(.16)

    def require_running(self):
        with self.ready:
            if self.paused:
                raise ValueError('Workspace is paused. Resume it in the control panel before editing.')

    def start_action(self, role, action, target, note):
        with self.ready:
            self.action_sequence += 1
            call = dict(id=self.action_sequence, role=role, action=action, target=target, note=note, state='running')
            self.actions[role] = call
            return call

    def finish_action(self, call, state):
        with self.ready:
            call['state'] = state
            self.recent.appendleft(call)

    def reset_actions(self):
        with self.ready:
            self.actions.clear()
            self.recent.clear()
            self.targets = {}

    def workspace_state(self):
        with self.ready:
            return json.dumps({
                'paused': self.paused, 'actions': list(self.actions.values()),
                'recent': list(self.recent), 'targets': self.targets,
            }, ensure_ascii=False).encode('utf-8')

    async def receive_frame(self, event):
        if self.closed:
            return
        self.publish_jpeg(base64.b64decode(event['data']))
        try:
            await self.session.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})
        except PlaywrightError:
            if not self.closed:
                raise

    async def stop(self):
        if self.closed:
            return
        with self.ready:
            self.closed = True
            self.ready.notify_all()
        if self.tracker is not None:
            self.tracker.cancel()
            await asyncio.gather(self.tracker, return_exceptions=True)
        if self.session is not None:
            try:
                await self.session.send('Page.stopScreencast')
                await self.session.detach()
            except PlaywrightError:
                pass
        if self.http is not None:
            if self.thread is not None and self.thread.is_alive():
                await asyncio.to_thread(self.http.shutdown)
            self.http.server_close()

    def handler(self):
        preview = self
        page = (Path(__file__).with_name('workspace.html').read_bytes()
                if self.workspace else VIEWER)

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path == preview.path:
                    self.respond('text/html; charset=utf-8', len(page))
                    self.wfile.write(page)
                elif preview.workspace and self.path == preview.path + 'state':
                    self.send_state()
                elif self.path == preview.path + 'stream':
                    self.respond('multipart/x-mixed-replace; boundary=frame')
                    self.connection.settimeout(5)
                    self.stream()
                else:
                    self.send_error(404)

            def do_POST(self):
                if not preview.workspace or self.path not in (
                    preview.path + 'pause', preview.path + 'resume',
                ):
                    self.send_error(404)
                    return
                if self.headers.get('Origin') != preview.origin:
                    self.send_error(403)
                    return
                with preview.ready:
                    preview.paused = self.path.endswith('/pause')
                self.send_state()

            def send_state(self):
                data = preview.workspace_state()
                self.respond('application/json; charset=utf-8', len(data))
                self.wfile.write(data)

            def respond(self, content_type, length=None):
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('X-Content-Type-Options', 'nosniff')
                if length is not None:
                    self.send_header('Content-Length', str(length))
                self.end_headers()

            def stream(self):
                sequence = 0
                try:
                    while True:
                        with preview.ready:
                            preview.ready.wait_for(lambda: preview.closed or preview.sequence != sequence)
                            if preview.closed:
                                return
                            frame, sequence = preview.frame, preview.sequence
                        headers = f'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {len(frame)}\r\n\r\n'
                        self.wfile.write(headers.encode('ascii'))
                        self.wfile.write(frame)
                        self.wfile.write(b'\r\n')
                except (ConnectionError, TimeoutError):
                    return

        return Handler
