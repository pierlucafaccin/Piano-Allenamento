"""Tiny read-only client for Garmin's Personal API. Standard library only.

The API key is read from .env.local and is never printed or logged.
The 24-hour access token is cached in data/token.json and renewed after 20 hours.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
ENV_FILE = os.path.join(HERE, ".env.local")
TOKEN_FILE = os.path.join(DATA, "token.json")

BASE = "https://personal.connectapi.garmin.com"
TOKEN_URL = BASE + "/personalapitoken-service/personal-api/personal-api-key/token"
TOKEN_MAX_AGE = 20 * 3600
UA = "garmin-dashboard/1.0 (personal use)"
PAUSE = 0.4  # seconds between calls


class KeyProblem(Exception):
    """The key is missing, mistyped or expired."""


class TooLarge(Exception):
    """Garmin returned HTTP 500 (response over ~256 KB). Use a smaller range."""


def _load_key():
    key = os.environ.get("GARMIN_PERSONAL_API_KEY", "").strip()
    if not key and os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GARMIN_PERSONAL_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise KeyProblem("GARMIN_PERSONAL_API_KEY missing (GitHub Secret or local .env.local)")
    return key


def _read_cached_token():
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            t = json.load(f)
        if t.get("token") and time.time() - t.get("obtained_at", 0) < TOKEN_MAX_AGE:
            return t["token"]
    except (OSError, ValueError):
        pass
    return None


def _new_token():
    key = _load_key()
    req = urllib.request.Request(
        TOKEN_URL, data=b"", method="POST",
        headers={"Authorization": "ApiKey " + key, "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8").strip()
    except urllib.error.HTTPError as e:
        raise KeyProblem(f"Garmin refused the key (HTTP {e.code})") from None
    # The body is the token as plain text; tolerate a JSON-quoted string just in case.
    if body.startswith('"') and body.endswith('"'):
        body = json.loads(body)
    if not body:
        raise KeyProblem("Garmin returned an empty token")
    os.makedirs(DATA, exist_ok=True)
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        json.dump({"token": body, "obtained_at": time.time()}, f)
    return body


_token = None


def token(force_new=False):
    global _token
    if force_new or not _token:
        _token = (None if force_new else _read_cached_token()) or _new_token()
    return _token


def get(path, params=None, retries=4):
    """GET a JSON endpoint. Returns parsed JSON (or None for an empty body)."""
    url = BASE + path
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    renewed = False
    attempt = 0
    while True:
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + token(),
            "Accept": "application/json",
            "User-Agent": UA,
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
            time.sleep(PAUSE)
            if not raw.strip():
                return None
            return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 401 and not renewed:
                token(force_new=True)
                renewed = True
                continue
            if e.code == 500:
                raise TooLarge(path) from None
            if e.code == 404 or e.code == 204:
                return None
            if e.code in (429, 502, 503, 504) and attempt < retries:
                attempt += 1
                wait = 5 * attempt if e.code != 429 else 15 * attempt
                time.sleep(wait)
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries:
                attempt += 1
                time.sleep(5 * attempt)
                continue
            raise
