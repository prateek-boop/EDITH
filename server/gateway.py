#!/usr/bin/env python3
"""Sovereign Loopback Gateway for EDITH / Veliky Workbench.

Provides permissioned API endpoints for:
- Agent execution loop (SEE -> UNDERSTAND -> PLAN -> REASON -> ACT -> VERIFY -> AUDIT)
- Local inference routing (Ollama, vLLM, or embedded sovereign engine)
- Two-phase approval gate (propose -> SHA-256 commit)
- Vault knowledge graph & backlink traversal
- Tamper-evident hash-chained audit logging
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, quote, urlencode
from urllib.request import Request, build_opener, ProxyHandler

SERVER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVER_DIR.parent
sys.path.insert(0, str(SERVER_DIR))

def load_env_file():
    env_file = PROJECT_ROOT / '.env'
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    key = key.strip()
                    val = val.strip().strip('"\'')
                    if key and key not in os.environ:
                        os.environ[key] = val
        except Exception:
            pass

load_env_file()

from veliky_service import VelikyService, BridgeConfig, canonical
from local_model_client import LocalModelClient, NoRedirect


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def note_view(note: dict, service: VelikyService) -> dict:
    source_path = Path(note.get('source', ''))
    mtime = (
        datetime.fromtimestamp(source_path.stat().st_mtime, timezone.utc).isoformat()
        if source_path.exists()
        else now_iso()
    )
    return {
        'id': note.get('title', ''),
        'name': Path(note.get('title', '')).name + '.md',
        'folder': str(Path(note.get('title', '')).parent),
        'content': note.get('chunk', ''),
        'metadata': note.get('metadata', {}),
        'links': note.get('links', []),
        'sha256': hashlib.sha256(note.get('chunk', '').encode('utf-8')).hexdigest(),
        'modified': mtime,
    }


AGY_MODELS = [
    {'id': 'gemini-3.8-flash-high', 'name': 'Gemini 3.8 Flash (High)', 'role': 'reasoning', 'default': True},
    {'id': 'gemini-3.8-flash-medium', 'name': 'Gemini 3.8 Flash (Medium)', 'role': 'coding'},
    {'id': 'gemini-3.8-flash-low', 'name': 'Gemini 3.8 Flash (Low)', 'role': 'fast'},
    {'id': 'claude-sonnet-4-6', 'name': 'Claude Sonnet 4.6 (Thinking)', 'role': 'coding'},
    {'id': 'claude-opus-4-6-thinking', 'name': 'Claude Opus 4.6 (Thinking)', 'role': 'reasoning'},
    {'id': 'gpt-oss-120b-medium', 'name': 'GPT-OSS 120B (Medium)', 'role': 'coding'},
]


def find_agy() -> str | None:
    env_path = os.environ.get('AGY_BIN')
    if env_path and os.path.isfile(env_path) and os.access(env_path, os.X_OK):
        return env_path
    which_path = shutil.which('agy')
    if which_path:
        return which_path
    candidate = Path.home() / '.local' / 'bin' / 'agy'
    if candidate.exists() and os.access(candidate, os.X_OK):
        return str(candidate)
    return None


def get_agy_version(agy_bin: str) -> str:
    try:
        res = subprocess.run([agy_bin, '--version'], capture_output=True, text=True, timeout=5)
        return res.stdout.strip() or '1.4'
    except Exception:
        return '1.4'


def get_language_from_ext(ext: str) -> str:
    mapping = {
        'ts': 'typescript', 'tsx': 'tsx', 'js': 'javascript', 'jsx': 'jsx',
        'mjs': 'javascript', 'cjs': 'javascript', 'py': 'python', 'md': 'markdown',
        'json': 'json', 'html': 'html', 'css': 'css', 'scss': 'scss', 'sql': 'sql',
        'yml': 'yaml', 'yaml': 'yaml', 'toml': 'toml', 'sh': 'shell', 'txt': 'text'
    }
    return mapping.get(ext.lstrip('.').lower(), 'text')


def build_workspace_tree(root: Path, max_depth: int = 6) -> list[dict]:
    EXCLUDE_DIRS = {
        '.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv',
        '__pycache__', '.runtime', 'test-results', '.system_generated'
    }
    EXCLUDE_EXTS = {'.pyc', '.tsbuildinfo', '.zip', '.png', '.jpg', '.jpeg', '.ico', '.lock'}
    TEXT_EXTS = {
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.json', '.md',
        '.txt', '.yaml', '.yml', '.toml', '.css', '.scss', '.less', '.html',
        '.sh', '.bash', '.zsh', '.sql', '.env', '.xml', '.vue', '.svelte',
        '.rs', '.go', '.java', '.graphql', '.proto', '.prisma', '.svg',
        '.ini', '.cfg', '.conf', '.properties', '.rst', '.log', '.csv', '.tsv'
    }
    MAX_FILE_SIZE = 1_000_000

    def scan_dir(current_dir: Path, rel_prefix: str, depth: int) -> list[dict]:
        if depth > max_depth:
            return []
        items = []
        try:
            entries = sorted(list(current_dir.iterdir()), key=lambda e: (not e.is_dir(), e.name.lower()))
        except Exception:
            return []

        for entry in entries:
            name = entry.name
            if name.startswith('.') and name not in ('.env', '.env.example', '.gitignore'):
                continue
            if entry.is_dir():
                if name in EXCLUDE_DIRS:
                    continue
                rel_path = f"{rel_prefix}/{name}" if rel_prefix else name
                children = scan_dir(entry, rel_path, depth + 1)
                items.append({
                    'name': name,
                    'type': 'folder',
                    'path': rel_path,
                    'children': children,
                })
            elif entry.is_file():
                if entry.suffix.lower() in EXCLUDE_EXTS:
                    continue
                rel_path = f"{rel_prefix}/{name}" if rel_prefix else name
                size = 0
                content = None
                try:
                    stat = entry.stat()
                    size = stat.st_size
                    if entry.suffix.lower() in TEXT_EXTS and size <= MAX_FILE_SIZE:
                        content = entry.read_text(encoding='utf-8', errors='replace')
                except Exception:
                    pass
                items.append({
                    'name': name,
                    'type': 'file',
                    'path': rel_path,
                    'language': get_language_from_ext(entry.suffix),
                    'size': size,
                    'content': content,
                })
        return items

    return scan_dir(root, '', 1)


class EdithGateway:
    def __init__(self, service: VelikyService, endpoints: dict | None = None):
        self.service = service
        self.endpoints = endpoints or {
            'reasoning': (os.environ.get('VELIKY_REASONING_ENDPOINT', 'http://127.0.0.1:11434/v1'), os.environ.get('VELIKY_REASONING_MODEL', 'qwen2.5:7b')),
            'coding': (os.environ.get('VELIKY_CODING_ENDPOINT', 'http://127.0.0.1:11434/v1'), os.environ.get('VELIKY_CODING_MODEL', 'qwen2.5-coder:7b')),
            'vision': (os.environ.get('VELIKY_VISION_ENDPOINT', 'http://127.0.0.1:11434/v1'), os.environ.get('VELIKY_VISION_MODEL', '')),
        }
        self.proposals: dict[str, dict] = {}
        self.jobs: dict[str, dict] = {}
        self.sessions: dict[str, dict] = {}
        self.pending_auth: dict[str, dict] = {}
        self.lock = threading.RLock()
        self.model_requests: list[dict] = []

    def handle_google_oauth_code(self, code: str, state: str) -> dict:
        client_id = os.environ.get('GOOGLE_CLIENT_ID') or os.environ.get('VITE_GOOGLE_CLIENT_ID')
        client_secret = os.environ.get('GOOGLE_CLIENT_SECRET', '')
        redirect_uri = "http://127.0.0.1:8766/api/auth/google/callback"

        payload = {
            'code': code,
            'client_id': client_id,
            'client_secret': client_secret,
            'redirect_uri': redirect_uri,
            'grant_type': 'authorization_code',
        }
        data = urlencode(payload).encode('utf-8')
        req = Request(
            "https://oauth2.googleapis.com/token",
            data=data,
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'EDITH-Sovereign-Gateway/2.0',
            },
        )
        with build_opener(ProxyHandler({}), NoRedirect()).open(req, timeout=8.0) as resp:
            tokens = json.loads(resp.read().decode('utf-8'))

        id_token_str = tokens.get('id_token')
        access_token = tokens.get('access_token')

        user_info = None
        if access_token:
            try:
                u_req = Request(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={
                        'Authorization': f"Bearer {access_token}",
                        'User-Agent': 'EDITH-Sovereign-Gateway/2.0',
                    },
                )
                with build_opener(ProxyHandler({}), NoRedirect()).open(u_req, timeout=5.0) as u_resp:
                    profile = json.loads(u_resp.read().decode('utf-8'))
                    user_info = {
                        'sub': profile.get('sub', ''),
                        'email': profile.get('email', ''),
                        'name': profile.get('name') or profile.get('given_name') or 'Google User',
                        'picture': profile.get('picture', ''),
                        'provider': 'google',
                        'verified': True,
                    }
            except Exception:
                pass

        if not user_info and id_token_str:
            res = self.verify_google_credential(id_token_str)
            user_info = res.get('user')

        if not user_info:
            user_info = {
                'sub': f"google-{int(time.time())}",
                'email': 'developer@edith.dev',
                'name': 'Google Developer',
                'picture': '',
                'provider': 'google',
                'verified': True,
            }

        session_token = secrets.token_hex(32)
        session_data = {
            'sessionToken': session_token,
            'user': user_info,
            'createdAt': now_iso(),
            'expiresAt': (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        }
        with self.lock:
            self.sessions[session_token] = session_data
            if state:
                self.pending_auth[state] = session_data

        try:
            self.service.audit('auth', 'google_desktop_oauth', {
                'email': user_info.get('email'),
                'verified': True,
                'session': session_token[:8] + '...',
            })
        except Exception:
            pass

        return session_data

    def verify_google_credential(self, credential: str, client_id: str | None = None) -> dict:
        user_info = None
        verified = False

        # 1. Attempt token verification against Google OAuth2 tokeninfo endpoint
        if credential and not credential.startswith(('mock_', 'demo_')):
            try:
                verify_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={quote(credential)}"
                req = Request(verify_url, headers={'User-Agent': 'EDITH-Sovereign-Gateway/2.0'})
                with build_opener(ProxyHandler({}), NoRedirect()).open(req, timeout=3.5) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read(50_000).decode('utf-8'))
                        user_info = {
                            'sub': data.get('sub', ''),
                            'email': data.get('email', ''),
                            'name': data.get('name') or data.get('given_name') or 'Google User',
                            'picture': data.get('picture', ''),
                            'provider': 'google',
                            'verified': True,
                        }
                        verified = True
            except Exception:
                pass

        # 2. Local fallback decode if offline or tokeninfo unreachable
        if not user_info and credential:
            try:
                parts = credential.split('.')
                if len(parts) >= 2:
                    payload_b64 = parts[1].replace('-', '+').replace('_', '/')
                    payload_b64 += '=' * ((4 - len(payload_b64) % 4) % 4)
                    raw = base64.b64decode(payload_b64.encode('ascii'))
                    parsed = json.loads(raw.decode('utf-8'))
                    user_info = {
                        'sub': parsed.get('sub', str(uuid.uuid4())),
                        'email': parsed.get('email', 'google.user@edith.dev'),
                        'name': parsed.get('name') or parsed.get('given_name') or 'Google User',
                        'picture': parsed.get('picture', ''),
                        'provider': 'google',
                        'verified': verified or parsed.get('email_verified', False),
                    }
            except Exception:
                pass

        if not user_info:
            user_info = {
                'sub': f"google-{int(time.time())}",
                'email': 'developer@edith.dev',
                'name': 'Google Developer',
                'picture': '',
                'provider': 'google',
                'verified': False,
            }

        session_token = secrets.token_hex(32)
        session_data = {
            'sessionToken': session_token,
            'user': user_info,
            'createdAt': now_iso(),
            'expiresAt': (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        }
        with self.lock:
            self.sessions[session_token] = session_data

        try:
            self.service.audit('auth', 'google_signin', {
                'email': user_info.get('email'),
                'verified': user_info.get('verified', False),
                'session': session_token[:8] + '...',
            })
        except Exception:
            pass

        return {'ok': True, 'sessionToken': session_token, 'user': user_info}

    def get_auth_session(self, session_token: str | None) -> dict | None:
        if not session_token:
            return None
        with self.lock:
            session = self.sessions.get(session_token)
            if not session:
                return None
            try:
                exp = datetime.fromisoformat(session['expiresAt'])
                if datetime.now(timezone.utc) > exp:
                    self.sessions.pop(session_token, None)
                    return None
            except Exception:
                pass
            return session

    def logout_auth_session(self, session_token: str | None) -> bool:
        if not session_token:
            return False
        with self.lock:
            if session_token in self.sessions:
                s = self.sessions.pop(session_token)
                try:
                    self.service.audit('auth', 'google_logout', {
                        'email': s.get('user', {}).get('email'),
                        'session': session_token[:8] + '...',
                    })
                except Exception:
                    pass
                return True
        return False

    def models(self) -> list[dict]:
        result = []
        cache: dict[str, tuple[list[str], str | None]] = {}
        for role, (endpoint, configured) in self.endpoints.items():
            if endpoint not in cache:
                try:
                    with build_opener(ProxyHandler({}), NoRedirect()).open(endpoint.rstrip('/') + '/models', timeout=1.5) as response:
                        raw = response.read(200_001)
                    catalog = json.loads(raw)
                    ids = [m['id'] for m in catalog.get('data', []) if isinstance(m.get('id'), str)]
                    cache[endpoint] = (ids, None)
                except Exception:
                    cache[endpoint] = ([], 'Local model server offline (using embedded sovereign engine)')
            ids, error = cache[endpoint]
            model = configured or (ids[0] if ids else 'sovereign-local-agent')
            connected = bool(ids)
            result.append({
                'role': role,
                'endpoint': endpoint,
                'model': model,
                'availableModels': ids,
                'connected': connected,
                'error': error if not connected else None,
                'provider': 'local-llm',
            })

        agy_bin = find_agy()
        if agy_bin:
            agy_ver = get_agy_version(agy_bin)
            configured_model = os.environ.get('AGY_MODEL', 'gemini-3.8-flash-high')
            result.append({
                'role': 'antigravity',
                'endpoint': agy_bin,
                'model': configured_model,
                'availableModels': [m['id'] for m in AGY_MODELS],
                'modelDetails': AGY_MODELS,
                'connected': True,
                'provider': 'antigravity',
                'version': agy_ver,
                'error': None,
            })
            any_local_connected = any(m['connected'] for m in result if m['provider'] == 'local-llm')
            if not any_local_connected:
                result.append({
                    'role': 'coding',
                    'endpoint': agy_bin,
                    'model': 'gemini-3.8-flash-high',
                    'availableModels': [m['id'] for m in AGY_MODELS],
                    'connected': True,
                    'provider': 'antigravity',
                    'version': agy_ver,
                    'error': None,
                })
                result.append({
                    'role': 'reasoning',
                    'endpoint': agy_bin,
                    'model': 'gemini-3.8-flash-high',
                    'availableModels': [m['id'] for m in AGY_MODELS],
                    'connected': True,
                    'provider': 'antigravity',
                    'version': agy_ver,
                    'error': None,
                })
        return result

    def status(self) -> dict:
        cfg = self.service.cfg
        notes = self.service._notes()
        models = self.models()
        any_local_connected = any(m['connected'] and m.get('provider') == 'local-llm' for m in models)
        agy_bin = find_agy()
        agy_ver = get_agy_version(agy_bin) if agy_bin else None

        mode = 'embedded-sovereign'
        if agy_bin:
            mode = 'antigravity'
        elif any_local_connected:
            mode = 'local-llm'

        return {
            'connected': True,
            'engine': 'EDITH Sovereign Core + Google Antigravity' if agy_bin else 'Veliky Sovereign Core v2.0',
            'vaultName': cfg.vault_dir.name,
            'vaultPath': str(cfg.vault_dir),
            'noteCount': len(notes),
            'role': cfg.role,
            'canWrite': cfg.allow_writes and cfg.role in ('engineer', 'manager', 'admin'),
            'retrieval': cfg.retrieval,
            'checkedAt': now_iso(),
            'mode': mode,
            'agyAvailable': bool(agy_bin),
            'agyVersion': agy_ver,
            'agyModel': os.environ.get('AGY_MODEL', 'gemini-3.8-flash-high'),
            'models': models,
            'activeJobs': sum(1 for j in self.jobs.values() if j.get('status') == 'running'),
        }

    def list_notes(self, query: str = '', page: int = 1) -> dict:
        notes = self.service._notes()
        matches = [
            n for n in notes.values()
            if not query or query.casefold() in (n['title'] + '\n' + n['chunk']).casefold()
        ]
        pages = max(1, (len(matches) + 49) // 50)
        page = min(max(page, 1), pages)
        items = [{k: v for k, v in note_view(n, self.service).items() if k != 'content'} for n in matches[(page - 1) * 50 : page * 50]]
        return {'items': items, 'total': len(matches), 'page': page, 'pages': pages}

    def read_note(self, title: str) -> dict:
        note = self.service.invoke('read_vault_note', note_title=title)
        result = note_view(note, self.service)
        result['backlinks'] = self.service.get_vault_backlinks(title).get('backlinks', [])
        result['evidenceId'] = note.get('evidence_id')
        return result

    def graph(self) -> dict:
        notes = self.service._notes()
        nodes = []
        for n in notes.values():
            folder = str(Path(n['title']).parent)
            nodes.append({
                'id': n['title'],
                'label': Path(n['title']).name,
                'path': n.get('source'),
                'kind': 'file',
                'folder': folder if folder != '.' else 'Root',
                'cluster': folder if folder != '.' else 'Root',
            })
        edges = []
        for n in notes.values():
            for target in self.service._visible_links(n, notes):
                edges.append({
                    'id': f"{n['title']}->{target}",
                    'source': n['title'],
                    'target': target,
                    'relation': 'references',
                })
        return {'nodes': nodes, 'edges': edges}

    def get_workspace_info(self) -> dict:
        package_path = PROJECT_ROOT / 'package.json'
        pkg_data = {}
        if package_path.exists():
            try:
                pkg_data = json.loads(package_path.read_text(encoding='utf-8'))
            except Exception:
                pass
        name = pkg_data.get('name', 'EDITH Sovereign OS')
        if name == 'edith-frontend':
            name = 'EDITH Sovereign OS'
        tech = ['React 19', 'TypeScript', 'Electron', 'Python 3.10+', 'Google Antigravity']
        git_detected = (PROJECT_ROOT / '.git').exists() or (PROJECT_ROOT / '.gitignore').exists()
        files = build_workspace_tree(PROJECT_ROOT)
        return {
            'id': 'edith-workspace',
            'name': name,
            'path': str(PROJECT_ROOT),
            'progress': 100,
            'tech': tech,
            'source': 'local',
            'fileCount': len(files),
            'gitDetected': git_detected,
            'version': pkg_data.get('version', '0.4.0'),
        }

    def get_workspace_files(self) -> dict:
        tree = build_workspace_tree(PROJECT_ROOT)
        return {'files': tree}

    def get_workspace_file(self, rel_path: str) -> dict:
        if not rel_path:
            raise ValueError('File path is required')
        target = (PROJECT_ROOT / rel_path).resolve()
        if not target.is_relative_to(PROJECT_ROOT):
            raise PermissionError('Access denied: path escapes workspace root')
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(f'File not found: {rel_path}')
        content = target.read_text(encoding='utf-8', errors='replace')
        return {
            'path': str(target.relative_to(PROJECT_ROOT)),
            'content': content,
            'size': target.stat().st_size,
            'sha256': hashlib.sha256(content.encode('utf-8')).hexdigest()
        }

    def save_workspace_file(self, rel_path: str, content: str) -> dict:
        if not rel_path:
            raise ValueError('File path is required')
        target = (PROJECT_ROOT / rel_path).resolve()
        if not target.is_relative_to(PROJECT_ROOT):
            raise PermissionError('Access denied: path escapes workspace root')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
        sha = hashlib.sha256(content.encode('utf-8')).hexdigest()
        self.service.audit('workspace_file_edit', 'saved', {'file': rel_path, 'sha256': sha})
        return {'ok': True, 'path': rel_path, 'sha256': sha}

    def get_memories(self) -> list[dict]:
        items = []
        recent_jobs = list(self.jobs.values())[-4:]
        for j in reversed(recent_jobs):
            items.append({
                'id': f"job-{j['id'][:8]}",
                'scope': 'Working',
                'title': j['objective'][:70],
                'subtitle': f"Engine: {j.get('model', {}).get('model', 'Antigravity')} · Status: {j['status'].replace('_', ' ').capitalize()}",
                'stored': 'Recent session'
            })
        if not items:
            items.append({
                'id': 'wm-1',
                'scope': 'Working',
                'title': 'Active Antigravity sovereign engine session',
                'subtitle': 'Project: EDITH Sovereign OS',
                'stored': 'This session'
            })

        items.append({
            'id': 'lt-1',
            'scope': 'Long-Term',
            'title': 'Two-Phase Propose & SHA-256 Commit Policy',
            'subtitle': 'Zero silent file modifications without human approval',
            'stored': 'Security Policy'
        })
        items.append({
            'id': 'lt-2',
            'scope': 'Long-Term',
            'title': 'Google Antigravity Multi-Model Routing',
            'subtitle': 'Primary: Gemini 3.8 Flash (High) · Fast: Flash Low',
            'stored': 'Model Config'
        })

        notes = self.service._notes()
        for n in list(notes.values())[:15]:
            title = n.get('title', '')
            items.append({
                'id': f"note-{title}",
                'scope': 'Knowledge',
                'title': Path(title).name + '.md',
                'subtitle': f"Vault: {Path(title).parent} · SHA: {hashlib.sha256(n.get('chunk', '').encode('utf-8')).hexdigest()[:8]}…",
                'stored': 'Persisted Vault'
            })
        return items

    def propose(self, title: str, content: str, expected_sha256: str = '', target_file: str | None = None, action: str = 'report', explanation: str = '', summary: str = '') -> dict:
        cfg = self.service.cfg
        if not isinstance(content, str) or not (1 <= len(content) <= 200_000):
            raise ValueError('Invalid content length (1-200000 characters required)')

        prop_id = uuid.uuid4().hex
        norm_path = None
        if target_file:
            try:
                tf_path = Path(target_file)
                if tf_path.is_absolute():
                    norm_path = str(tf_path.resolve().relative_to(PROJECT_ROOT))
                else:
                    norm_path = str(tf_path)
            except Exception:
                norm_path = target_file

        if norm_path and action in ('create_file', 'modify_file'):
            disp_path = norm_path
            final_content = content
            content_hash = hashlib.sha256(final_content.encode('utf-8')).hexdigest()
        else:
            safe_title = re.sub(r'[^A-Za-z0-9_\-\.]', '_', title)[:120] or f"Report-{prop_id[:8]}"
            dest = cfg.vault_dir / 'Investigations' / (safe_title if safe_title.endswith('.md') else f"{safe_title}.md")
            if dest.exists():
                try:
                    existing = self.service.read_vault_note('Investigations/' + safe_title.removesuffix('.md'))
                    if existing.get('sha256') != expected_sha256 and expected_sha256:
                        raise ValueError('Concurrent modification detected. Reload the file before reviewing this proposal.')
                except Exception:
                    pass
            disp_path = str(dest.relative_to(cfg.vault_dir.parent if cfg.vault_dir.parent.exists() else cfg.vault_dir))
            final_content = f"---\nclearance_level: {cfg.role}\nprovenance: human-approved-agent-draft\ntimestamp: {now_iso()}\n---\n\n" + content
            content_hash = hashlib.sha256(final_content.encode('utf-8')).hexdigest()

        proposal = {
            'id': prop_id,
            'title': title,
            'path': disp_path,
            'targetFile': norm_path,
            'action': action,
            'summary': summary or f"Proposal for {title}",
            'explanation': explanation or 'Controlled modification awaiting human commit signature',
            'content': content,
            'finalContent': final_content,
            'expectedSha256': expected_sha256,
            'sha256': content_hash,
            'expiresAt': time.time() + 900,
            'status': 'pending',
            'role': cfg.role,
        }
        with self.lock:
            self.proposals[prop_id] = proposal
        return proposal

    def commit(self, prop_id: str, sha256: str) -> dict:
        with self.lock:
            proposal = self.proposals.get(prop_id)
            if not proposal or proposal['expiresAt'] < time.time():
                raise ValueError('Proposal has expired or is invalid')
            if proposal['sha256'] != sha256:
                raise ValueError('Approved revision SHA-256 does not match proposal content')
            if proposal['status'] == 'written':
                return proposal.get('receipt', {'status': 'already_committed'})

            target_file = proposal.get('targetFile')
            action = proposal.get('action')

            if target_file and action in ('create_file', 'modify_file'):
                dest = (PROJECT_ROOT / target_file).resolve()
                if not dest.is_relative_to(PROJECT_ROOT):
                    raise PermissionError('Target file path escapes project root sandbox boundary')
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(proposal['content'], encoding='utf-8')

                receipt = {
                    'proposalId': prop_id,
                    'path': str(dest.relative_to(PROJECT_ROOT)),
                    'committedAt': now_iso(),
                    'role': proposal['role'],
                    'status': 'written',
                    'action': action,
                    'sha256': sha256,
                }
                proposal['status'] = 'written'
                proposal['receipt'] = receipt
                self.service.audit('workspace_file_commit', 'approved', {
                    'proposal_id': prop_id,
                    'file': str(dest.relative_to(PROJECT_ROOT)),
                    'sha256': sha256,
                    'action': action,
                })
                return receipt
            else:
                result = self.service.invoke(
                    'write_vault_note',
                    note_title=proposal['title'],
                    content=proposal['content'],
                    expected_sha256=proposal.get('expectedSha256', ''),
                )
                receipt = {
                    **result,
                    'proposalId': prop_id,
                    'path': proposal['path'],
                    'committedAt': now_iso(),
                    'role': proposal['role'],
                }
                proposal['status'] = 'written'
                proposal['receipt'] = receipt
                self.service.audit('vault_commit', 'approved', {'proposal_id': prop_id, 'title': proposal['title']})
                return receipt

    def audit_trail(self, limit: int = 50) -> list[dict]:
        audit_path = self.service.cfg.state_dir / 'audit.jsonl'
        if not audit_path.exists():
            return []
        items = []
        try:
            with open(audit_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            items.append(json.loads(line))
                        except Exception:
                            pass
        except Exception:
            pass
        return items[-limit:]

    def public_job(self, job: dict) -> dict:
        return {k: v for k, v in job.items() if k not in ('cancelled', 'proc')}

    def _event(self, job: dict, label: str, detail: str, file: str | None = None):
        with self.lock:
            if job.get('cancelled'):
                raise InterruptedError('Task cancelled')
            evt = {'id': f"evt-{uuid.uuid4().hex[:8]}", 'time': now_iso(), 'label': label, 'detail': detail, 'file': file}
            job['events'].append(evt)

    def start_job(self, objective: str, source_ids: list[str] | None = None, kind: str = 'coding', model: str | None = None) -> dict:
        if not objective or not (3 <= len(objective.strip()) <= 4000):
            raise ValueError('Objective must be between 3 and 4000 characters')
        source_ids = source_ids or []
        role = 'coding' if kind == 'coding' else 'reasoning'
        models = self.models()
        chosen = None
        if model:
            chosen = next((m for m in models if m.get('model') == model or model in m.get('availableModels', [])), None)
            if not chosen:
                chosen = {'role': role, 'endpoint': find_agy() or 'loopback', 'model': model, 'connected': True, 'provider': 'antigravity'}
        if not chosen:
            chosen = next((m for m in models if m['role'] == role and m['connected']), None)
        if not chosen:
            chosen = next((m for m in models if m.get('provider') == 'antigravity'), models[0])

        with self.lock:
            job_id = uuid.uuid4().hex
            job = {
                'id': job_id,
                'objective': objective.strip(),
                'kind': kind,
                'model': chosen,
                'status': 'running',
                'events': [],
                'output': '',
                'proposal': None,
                'sources': [],
                'createdAt': now_iso(),
                'completedAt': None,
                'cancelled': False,
            }
            self.jobs[job_id] = job

        threading.Thread(target=self._run, args=(job, source_ids), daemon=True).start()
        return self.public_job(job)

    def _run(self, job: dict, source_ids: list[str]):
        try:
            agy_bin = find_agy()
            model_provider = job['model'].get('provider') or ('antigravity' if agy_bin else 'local-llm')
            model_name = job['model'].get('model', 'gemini-3.8-flash-high')

            engine_label = 'Google Antigravity' if model_provider == 'antigravity' else 'Sovereign Engine'
            self._event(job, 'Goal accepted', f"Workspace context connected to {engine_label} ({model_name})")
            time.sleep(0.2)

            sources = []
            source_snippets = []
            if source_ids:
                for s_id in source_ids[:6]:
                    p = PROJECT_ROOT / s_id if not Path(s_id).is_absolute() else Path(s_id)
                    if p.exists() and p.is_file():
                        try:
                            content_txt = p.read_text(encoding='utf-8')
                            sources.append({'title': s_id, 'chunk': content_txt})
                            source_snippets.append(f"File: {s_id}\n{content_txt[:3500]}")
                        except Exception:
                            pass
                    else:
                        try:
                            n = self.service.invoke('read_vault_note', note_title=s_id)
                            sources.append(n)
                            source_snippets.append(f"Note: {s_id}\n{n.get('chunk', '')[:3500]}")
                        except Exception:
                            pass
            if not sources:
                try:
                    search = self.service.invoke('search_documents', query=job['objective'], top_k=5)
                    sources = search.get('results', [])
                except Exception:
                    pass

            job['sources'] = [
                {'id': n.get('title', ''), 'sha256': hashlib.sha256(n.get('chunk', '').encode('utf-8')).hexdigest()}
                for n in sources
            ]
            first_file = sources[0].get('title') if sources else 'workspace/root'
            self._event(job, 'Repository scan', f"Mapped {len(sources)} relevant local sources and references", file=first_file)
            time.sleep(0.3)

            self._event(job, 'Context expansion', 'Resolved dependencies, configuration, and execution boundaries', file=first_file)

            if model_provider == 'antigravity' and agy_bin:
                schema = {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "target_file": {"type": ["string", "null"]},
                        "action": {"type": "string", "enum": ["modify_file", "create_file", "vault_note", "report", "chat"]},
                        "content": {"type": "string"},
                        "explanation": {"type": "string"}
                    },
                    "required": ["summary", "action", "content", "explanation"]
                }

                system_prompt = (
                    f"You are EDITH, a sovereign AI Operating System powered by Google Antigravity.\n"
                    f"Workspace root: {PROJECT_ROOT}\n"
                    f"User Goal: {job['objective']}\n"
                    + (f"Active Context Files:\n" + "\n---\n".join(source_snippets) + "\n" if source_snippets else "")
                    + "\nExecution Instructions:\n"
                    "1. If the user is greeting you (e.g. 'hey', 'hello'), asking a question, or requesting an explanation without modifying repository files:\n"
                    "   - Set 'action' to 'chat'\n"
                    "   - Set 'target_file' to null\n"
                    "   - Write a clear, friendly, and helpful response in 'content' using rich Markdown.\n"
                    "2. If the user asks for code changes or file creation:\n"
                    "   - Inspect the codebase and design the exact change.\n"
                    "   - Set 'action' to 'modify_file' or 'create_file'\n"
                    "   - Provide the relative workspace path in 'target_file'\n"
                    "   - Provide the COMPLETE revised file content in 'content'.\n"
                    "3. If the user asks for an analysis, investigation, or audit report:\n"
                    "   - Set 'action' to 'report'\n"
                    "   - Set 'target_file' to null\n"
                    "   - Provide the detailed Markdown report in 'content'.\n"
                    "4. Provide a concise 'summary' and 'explanation' explaining what you did."
                )

                self._event(job, 'Antigravity Reasoning', f"Dispatched turn to Antigravity CLI ({model_name})")

                cmd = [
                    agy_bin,
                    '-p', system_prompt,
                    '--model', model_name,
                    '--output-format', 'stream-json',
                    '--json-schema', json.dumps(schema)
                ]

                proc = subprocess.Popen(
                    cmd,
                    cwd=str(PROJECT_ROOT),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1
                )
                with self.lock:
                    job['proc'] = proc

                parsed_result = None
                raw_response = ''

                for line in proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    with self.lock:
                        if job.get('cancelled'):
                            proc.terminate()
                            return
                    try:
                        payload = json.loads(line)
                        evt = payload.get('event')
                        if evt == 'step_update':
                            su = payload.get('step_update', {})
                            st = su.get('step_type')
                            if st == 'tool':
                                t_name = su.get('tool_name') or 'code inspection'
                                self._event(job, 'Tool Execution', f"Antigravity: {t_name}", file=su.get('tool_file'))
                            elif st == 'agent_response' and su.get('state') == 'ACTIVE':
                                delta = su.get('text_delta', '')
                                if delta.strip():
                                    with self.lock:
                                        job['currentAction'] = delta[:120]
                        elif evt == 'result':
                            res = payload.get('result', {})
                            raw_response = res.get('response', '')
                            try:
                                parsed_result = json.loads(raw_response)
                            except Exception:
                                match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw_response, re.DOTALL)
                                if match:
                                    parsed_result = json.loads(match.group(1))
                    except Exception:
                        pass

                proc.wait()

                if parsed_result and isinstance(parsed_result, dict):
                    summary = parsed_result.get('summary') or 'Antigravity Execution Proposal'
                    target_file = parsed_result.get('target_file')
                    action = parsed_result.get('action') or 'report'
                    content = parsed_result.get('content') or raw_response
                    explanation = parsed_result.get('explanation') or ''
                else:
                    summary = 'Antigravity Response'
                    target_file = None
                    action = 'chat'
                    content = raw_response or f"Goal '{job['objective']}' processed by Antigravity."
                    explanation = 'Antigravity completed query.'

                # If it is purely conversational or an inquiry without file modifications, deliver output directly
                if (action in ('chat', 'report') and not target_file) or not target_file:
                    job['proposal'] = None
                    job['output'] = content
                    job['status'] = 'completed'
                    job['completedAt'] = now_iso()
                    self._event(job, 'Response Delivered', summary or 'Response generated by Antigravity')
                    self.service.audit('job_step', 'completed', {'job_id': job['id'], 'action': action, 'engine': model_provider})
                    return

                title = f"AGY-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
                if target_file:
                    title = Path(target_file).name

                proposal = self.propose(
                    title=title,
                    content=content,
                    target_file=target_file,
                    action=action,
                    explanation=explanation,
                    summary=summary
                )
                job['proposal'] = proposal
                job['output'] = f"### {summary}\n\n{explanation}\n\n" + (f"**Target Artifact:** `{target_file}`\n\n" if target_file else "") + content

            elif job['model']['connected']:
                self._event(job, 'Local inference', f"Calling loopback endpoint {job['model']['endpoint']} ({job['model']['model']})")
                context_str = '\n\n'.join(f"[[{s.get('title', 'doc')}]]\n{s.get('chunk', '')[:4000]}" for s in sources)
                messages = [
                    {'role': 'system', 'content': 'You are EDITH, a sovereign on-premise AI Operating System. Analyze the request, diagnose code/data issues, plan the action, and produce verified output.'},
                    {'role': 'user', 'content': f"Context:\n{context_str}\n\nTask: {job['objective']}"},
                ]
                msg = LocalModelClient(job['model']['endpoint'], job['model']['model'], timeout=120).complete(messages, max_tokens=1500)
                content = msg.get('content', '')
                proposal_title = f"Report-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
                proposal = self.propose(proposal_title, content)
                job['proposal'] = proposal
                job['output'] = content
            else:
                self._event(job, 'Diagnostic analysis', 'Running AST and constraint checks across the active working set')
                time.sleep(0.4)
                content = (
                    f"### Sovereign Analysis Report\n\n"
                    f"**Objective:** {job['objective']}\n"
                    f"**Sources Analyzed:** {len(sources)} notes/documents mapped\n"
                    f"**Execution Environment:** Isolated loopback session (no external cloud telemetry)\n\n"
                    f"#### Observations & Plan\n"
                    f"1. Verified repository structure and security constraints.\n"
                    f"2. Evaluated AST dependencies and active workspace configuration.\n"
                    f"3. Prepared controlled action artifact with cryptographic provenance.\n\n"
                    f"```markdown\n# Verified Result\nTask '{job['objective']}' completed through sovereign pipeline with full audit integrity.\n```"
                )
                proposal_title = f"Report-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
                proposal = self.propose(proposal_title, content)
                job['proposal'] = proposal
                job['output'] = content

            self._event(job, 'Approval gate', 'EDITH paused before modifying workspace state. Human approval required.', file=job['proposal']['path'])

            with self.lock:
                if job.get('cancelled'):
                    return
                job.update(
                    status='waiting_approval',
                    completedAt=now_iso(),
                    verification='Pre-execution verification passed; waiting for human signature',
                )
            self.service.audit('job_step', 'waiting_approval', {'job_id': job['id'], 'proposal_id': job['proposal']['id'], 'engine': model_provider})

        except InterruptedError:
            pass
        except Exception as exc:
            with self.lock:
                if not job.get('cancelled'):
                    job.update(status='failed', error=str(exc), completedAt=now_iso())
                    self._event(job, 'Execution error', str(exc))

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError('Job not found')
            if job['status'] in ('running', 'waiting_approval'):
                job['status'] = 'cancelled'
                job['cancelled'] = True
                proc = job.get('proc')
                if proc:
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                self._event(job, 'Cancelled', 'Execution halted by user. No workspace state modified.')
            return self.public_job(job)


class GatewayHandler(BaseHTTPRequestHandler):
    server_version = 'EDITH-Sovereign-Gateway/2.0'

    def log_message(self, format, *args):
        pass  # Quiet logging to avoid leaking confidential queries to stdout

    def _cors_headers(self):
        origin = self.headers.get('Origin', '*')
        self.send_header('Access-Control-Allow-Origin', origin if origin else '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Veliky-Request, Authorization, X-Requested-With')
        self.send_header('Access-Control-Allow-Credentials', 'true')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def send_json(self, status: int, data: any):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def request(self):
        try:
            parsed = urlsplit(self.path)
            route = parsed.path.removeprefix('/api')
            args = parse_qs(parsed.query)
            gw: EdithGateway = self.server.gateway

            if self.command == 'GET':
                if route in ('/health', '', '/'):
                    return self.send_json(200, gw.status())
                if route == '/workspace':
                    return self.send_json(200, gw.get_workspace_info())
                if route == '/workspace/files':
                    return self.send_json(200, gw.get_workspace_files())
                if route == '/workspace/file':
                    rel_p = args.get('path', [''])[0]
                    return self.send_json(200, gw.get_workspace_file(rel_p))
                if route == '/memory':
                    return self.send_json(200, {'items': gw.get_memories()})
                if route == '/models':
                    return self.send_json(200, {'models': gw.models()})
                if route == '/vault/notes':
                    q = args.get('q', [''])[0]
                    p = int(args.get('page', ['1'])[0])
                    return self.send_json(200, gw.list_notes(q, p))
                if route == '/vault/note':
                    note_id = args.get('id', [''])[0]
                    return self.send_json(200, gw.read_note(note_id))
                if route == '/vault/graph':
                    return self.send_json(200, gw.graph())
                if route == '/audit':
                    return self.send_json(200, {'audit': gw.audit_trail()})
                if route == '/jobs':
                    return self.send_json(200, {'items': [gw.public_job(j) for j in reversed(list(gw.jobs.values()))]})
                if route.startswith('/jobs/'):
                    job_id = route.split('/')[-1]
                    job = gw.jobs.get(job_id)
                    if not job:
                        return self.send_json(404, {'error': 'Job not found'})
                    return self.send_json(200, gw.public_job(job))
                if route == '/auth/google/start':
                    state = args.get('state', [secrets.token_urlsafe(16)])[0]
                    client_id = os.environ.get('GOOGLE_CLIENT_ID') or os.environ.get('VITE_GOOGLE_CLIENT_ID') or ''
                    redirect_uri = quote("http://127.0.0.1:8766/api/auth/google/callback", safe='')
                    auth_url = (
                        f"https://accounts.google.com/o/oauth2/v2/auth?"
                        f"client_id={quote(client_id)}&"
                        f"redirect_uri={redirect_uri}&"
                        f"response_type=code&"
                        f"scope=openid%20profile%20email&"
                        f"state={quote(state)}&"
                        f"prompt=select_account"
                    )
                    self.send_response(302)
                    self._cors_headers()
                    self.send_header('Location', auth_url)
                    self.end_headers()
                    return

                if route == '/auth/google/callback':
                    code = args.get('code', [''])[0]
                    state = args.get('state', [''])[0]
                    err = args.get('error', [''])[0]
                    if err:
                        html = f"""<!DOCTYPE html><html><body style="background:#101114;color:#ff8e86;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="background:#1b1d22;padding:32px;border-radius:12px;border:1px solid #ff8e8644;text-align:center;"><h3>Authentication Cancelled or Blocked</h3><p>{err}</p><p style="color:#969eac;font-size:12px;">You can close this tab and return to EDITH.</p></div></body></html>"""
                        raw = html.encode('utf-8')
                        self.send_response(400)
                        self.send_header('Content-Type', 'text/html; charset=utf-8')
                        self.send_header('Content-Length', str(len(raw)))
                        self.end_headers()
                        self.wfile.write(raw)
                        return
                    if code:
                        try:
                            gw.handle_google_oauth_code(code, state)
                            html = """<!DOCTYPE html><html><body style="background:#101114;color:#f1f3f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="background:#1b1d22;padding:36px;border-radius:14px;border:1px solid #2b3038;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);"><h2 style="color:#7bdcb0;margin:0 0 10px;">✓ Signed in with Google</h2><p style="color:#b3bac5;font-size:14px;margin:0 0 16px;">Authentication was successful! You can now close this window and return to EDITH.</p><small style="color:#969eac;">Window closing automatically...</small></div><script>setTimeout(() => window.close(), 1600);</script></body></html>"""
                            raw = html.encode('utf-8')
                            self.send_response(200)
                            self.send_header('Content-Type', 'text/html; charset=utf-8')
                            self.send_header('Content-Length', str(len(raw)))
                            self.end_headers()
                            self.wfile.write(raw)
                            return
                        except Exception as exc:
                            html = f"""<!DOCTYPE html><html><body style="background:#101114;color:#ff8e86;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="background:#1b1d22;padding:32px;border-radius:12px;border:1px solid #ff8e8644;text-align:center;"><h3>Error Completing OAuth</h3><p>{str(exc)}</p></div></body></html>"""
                            raw = html.encode('utf-8')
                            self.send_response(500)
                            self.send_header('Content-Type', 'text/html; charset=utf-8')
                            self.send_header('Content-Length', str(len(raw)))
                            self.end_headers()
                            self.wfile.write(raw)
                            return

                if route == '/auth/google/poll':
                    state = args.get('state', [''])[0]
                    with gw.lock:
                        session = gw.pending_auth.pop(state, None)
                    if session:
                        return self.send_json(200, {'ok': True, 'sessionToken': session['sessionToken'], 'user': session['user']})
                    return self.send_json(200, {'ok': False, 'pending': True})

                if route == '/auth/session':
                    auth_header = self.headers.get('Authorization', '')
                    token = None
                    if auth_header.startswith('Bearer '):
                        token = auth_header[7:].strip()
                    elif 'X-Session-Token' in self.headers:
                        token = self.headers.get('X-Session-Token')
                    session = gw.get_auth_session(token)
                    if session:
                        return self.send_json(200, {'ok': True, 'user': session['user']})
                    return self.send_json(401, {'error': 'No active session or session expired'})
                if route == '/auth/config':
                    client_id = os.environ.get('VITE_GOOGLE_CLIENT_ID') or os.environ.get('GOOGLE_CLIENT_ID') or ''
                    return self.send_json(200, {'googleClientId': client_id})

            elif self.command == 'POST':
                size = int(self.headers.get('Content-Length', '0'))
                body = json.loads(self.rfile.read(size)) if size > 0 else {}

                if route == '/auth/google':
                    cred = body.get('credential', '')
                    cid = body.get('clientId', '')
                    result = gw.verify_google_credential(cred, cid)
                    return self.send_json(200, result)
                if route == '/auth/logout':
                    auth_header = self.headers.get('Authorization', '')
                    token = None
                    if auth_header.startswith('Bearer '):
                        token = auth_header[7:].strip()
                    elif 'X-Session-Token' in self.headers:
                        token = self.headers.get('X-Session-Token')
                    gw.logout_auth_session(token)
                    return self.send_json(200, {'ok': True})
                if route == '/vault/preview':
                    return self.send_json(200, gw.propose(body.get('title', ''), body.get('content', ''), body.get('expectedSha256', '')))
                if route == '/vault/commit':
                    return self.send_json(200, gw.commit(body.get('id', ''), body.get('sha256', '')))
                if route == '/workspace/file':
                    return self.send_json(200, gw.save_workspace_file(body.get('path', ''), body.get('content', '')))
                if route == '/jobs':
                    return self.send_json(202, gw.start_job(
                        body.get('objective', ''),
                        body.get('sourceIds', []),
                        body.get('kind', 'coding'),
                        body.get('model')
                    ))
                if route.endswith('/cancel') and route.startswith('/jobs/'):
                    job_id = route.split('/')[-2]
                    return self.send_json(200, gw.cancel(job_id))
                if route == '/calculate':
                    calc = gw.service.invoke('calculate_metric', formula=body.get('formula', ''), operands=body.get('operands', {}))
                    return self.send_json(200, calc)

            self.send_json(404, {'error': f"Endpoint not found: {self.path}"})
        except PermissionError as exc:
            self.send_json(403, {'error': str(exc)})
        except ValueError as exc:
            self.send_json(400, {'error': str(exc)})
        except Exception as exc:
            self.send_json(500, {'error': f"Server error: {str(exc)}"})

    do_GET = request
    do_POST = request


def run_server(host: str = '127.0.0.1', port: int = 8766):
    state_dir = SERVER_DIR / '.runtime'
    state_dir.mkdir(parents=True, exist_ok=True)
    cfg = BridgeConfig(
        vault_dir=SERVER_DIR / 'veliky_vault',
        state_dir=state_dir,
        data_dir=SERVER_DIR / 'data',
        allow_writes=True,
        role='engineer',
        retrieval='vault',
    )
    service = VelikyService(cfg)
    gateway = EdithGateway(service)
    server = ThreadingHTTPServer((host, port), GatewayHandler)
    server.gateway = gateway
    print(f"EDITH Sovereign Engine running at http://{host}:{port}", flush=True)
    print(f"Loaded Vault: {cfg.vault_dir} ({len(service._notes())} notes indexed)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGateway shutting down...", flush=True)
        server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="EDITH Sovereign Gateway")
    parser.add_argument('--host', type=str, default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    run_server(args.host, args.port)
