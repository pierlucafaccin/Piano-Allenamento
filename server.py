"""Copenhagen21K private dashboard. Standard library, loopback only.
Do not expose this server to public networks or deploy /garmin or /local as static files.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / 'local'
GD = ROOT / 'garmin' / 'data'
LOG_FILE = LOCAL / 'workout-log.json'
STATUS = LOCAL / 'sync-status.json'
LOCK = threading.RLock()
ALLOWED = {
    '/':'index.html', '/index.html':'index.html', '/style.css':'style.css',
    '/app.js':'app.js', '/training-plan.json':'training-plan.json',
    '/favicon.svg':'favicon.svg', '/garmin/dashboard':'garmin/dashboard.html',
}


def read_json(path, fallback):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return fallback


def atomic_json(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, path)


def metrics():
    activities = read_json(GD / 'activities.json', [])
    day = read_json(GD / 'daily.json', {})
    sleep = read_json(GD / 'sleep.json', {})
    hrv = read_json(GD / 'hrv.json', {})
    state = read_json(GD / 'state.json', {})
    today = dt.date.today()
    week_start = today - dt.timedelta(days=today.weekday())
    recent = []
    weekly = {'runs':0,'runKm':0.,'gym':0,'ride':0,'other':0}
    for a in activities if isinstance(activities, list) else []:
        d = str(a.get('startTimeLocal', ''))[:10]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', d):
            continue
        typ = (a.get('activityType') or {}).get('typeKey', '').lower()
        if 'run' in typ:
            sport = 'run'
        elif 'cycl' in typ or 'bik' in typ or 'spin' in typ:
            sport = 'ride'
        elif any(t in typ for t in ('strength','training','hiit','fitness','yoga','pilates','mobility')):
            sport = 'gym'
        else:
            sport = 'other'
        km = round((a.get('distance') or 0) / 1000, 2)
        if week_start.isoformat() <= d <= today.isoformat():
            if sport == 'run':
                weekly['runs'] += 1
                weekly['runKm'] += km
            else:
                weekly[sport] += 1
        recent.append({'date':d, 'name':str(a.get('activityName') or typ or 'Attività')[:100],
                       'sport':sport,'km':km, 'min':round((a.get('duration') or 0)/60,1),
                       'hr':a.get('averageHR')})
    weekly['runKm'] = round(weekly['runKm'], 2)
    recent.sort(key=lambda a:a['date'], reverse=True)
    def last_metric(store, prop, converter=None):
        if not isinstance(store, dict):
            return None
        for d in sorted(store, reverse=True):
            item = store[d]
            v = item.get(prop) if isinstance(item, dict) else None
            if v is not None and isinstance(v, (int, float)):
                return {'value':converter(v) if converter else v,'date':d}
        return None
    return {
        'available':bool(recent or day or sleep or hrv),
        'lastPull':state.get('last_pull'),
        'totalActivities':len(recent), 'weekly':weekly,
        'recent':recent[:6],
        'metrics':{'rhr':last_metric(day,'rhr'), 'sleep':last_metric(sleep,'total',lambda x:round(x/3600,1)),
                   'hrv':last_metric(hrv,'night')},
        'keyConfigured':(ROOT/'garmin'/'.env.local').exists(),
        'dashboardBuilt':(ROOT/'garmin'/'dashboard.html').exists(),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def send_data(self, status, body, content_type='application/json; charset=utf-8'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Cache-Control','no-store, max-age=0')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Frame-Options','SAMEORIGIN')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlsplit(self.path).path
        if p == '/api/bootstrap':
            return self.send_data(200,{'logs':read_json(LOG_FILE, {}), 'garmin':metrics(),
                                       'sync':read_json(STATUS, {'status':'never'})})
        if p == '/api/status':
            return self.send_data(200,{'garmin':metrics(),'sync':read_json(STATUS, {'status':'never'})})
        if p == '/api/backup':
            return self.send_data(200,read_json(LOG_FILE, {}))
        if p not in ALLOWED:
            return self.send_data(404,{'error':'Risorsa non disponibile'})
        f = ROOT / ALLOWED[p]
        if p == '/garmin/dashboard' and not f.is_file():
            return self.send_data(200,'''<!doctype html><html lang="it"><meta charset="utf-8"><title>Garmin</title>
            <style>body{background:#101821;color:#e9eef5;font:16px system-ui;max-width:600px;margin:5rem auto;padding:20px}p{color:#9aabbd}</style>
            <h1>Garmin non ancora collegato</h1><p>Importa i dati dal tuo vecchio progetto con import-existing.bat, poi genera la dashboard tramite refresh.bat oppure build.py.</p></html>''','text/html; charset=utf-8')
        if not f.is_file():
            return self.send_data(404,{'error':'File non trovato'})
        ext = f.suffix
        ct = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
              '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
              '.svg':'image/svg+xml'}.get(ext,'application/octet-stream')
        return self.send_data(200,f.read_bytes(),ct)

    def do_POST(self):
        p = urlsplit(self.path).path
        # JSON + a custom header prevents simple cross-site form submissions.
        origin = self.headers.get('Origin','')
        expected = f'http://127.0.0.1:{self.server.server_port}'
        if origin != expected or self.headers.get('X-Local-Dashboard') != '1':
            return self.send_data(403, {'error':'Origine non autorizzata'})
        if self.headers.get('Content-Type','').split(';')[0].strip() != 'application/json':
            return self.send_data(415,{'error':'Richiesta JSON necessaria'})
        try:
            n = int(self.headers.get('Content-Length','0'))
        except ValueError:
            n = 0
        if n < 2 or n > 128000:
            return self.send_data(413,{'error':'Dimensione richiesta non valida'})
        try:
            payload = json.loads(self.rfile.read(n))
        except (json.JSONDecodeError,UnicodeError):
            return self.send_data(400,{'error':'JSON non valido'})
        if p == '/api/logs':
            if not isinstance(payload,dict):
                return self.send_data(400,{'error':'Formato non valido'})
            d,entry = payload.get('date'),payload.get('entry')
            if not isinstance(d,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',d):
                return self.send_data(400,{'error':'Data non valida'})
            try:
                dt.date.fromisoformat(d)
            except ValueError:
                return self.send_data(400,{'error':'Data non valida'})
            if not isinstance(entry, dict):
                return self.send_data(400,{'error':'Seduta non valida'})
            if entry.get('status') not in ('partial','done','skipped'):
                return self.send_data(400,{'error':'Stato non valido'})
            entries = entry.get('exercises',{})
            if not isinstance(entries,dict) or len(entries)>40:
                return self.send_data(400,{'error':'Esercizi non validi'})
            for item in entries.values():
                if not isinstance(item,dict) or any(not isinstance(v,str) or len(v)>2000 for v in item.values()):
                    return self.send_data(400,{'error':'Dettagli non validi'})
            if not isinstance(entry.get('notes',''),str) or len(entry.get('notes',''))>10000:
                return self.send_data(400,{'error':'Note troppo lunghe'})
            for name in ('rpe', 'painAfter', 'minutes'):
                value = entry.get(name, '')
                try:
                    if value not in ('',None):
                        val=float(value)
                        if not (0 <= val <= (600 if name=='minutes' else 10)):
                            raise ValueError()
                except (TypeError,ValueError):
                    return self.send_data(400,{'error':name+' non valido'})
            with LOCK:
                log = read_json(LOG_FILE,{})
                log[d] = {'status':entry['status'], 'notes':entry.get('notes',''),
                          'rpe':entry.get('rpe',''),'painAfter':entry.get('painAfter',''),
                          'minutes':entry.get('minutes',''),
                          'exercises':entries,'updatedAt':dt.datetime.now().isoformat(timespec='seconds')}
                atomic_json(LOG_FILE, log)
            # Rebuild the detailed Garmin dashboard after manual log edits so
            # its rehab/calendar widgets always reflect confirmed sessions.
            try:
                subprocess.run([sys.executable,'build.py'], cwd=str(ROOT/'garmin'),
                               check=True, timeout=45, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
                updated = True
            except (subprocess.SubprocessError, OSError):
                updated = False  # The log was saved even if analytics failed.
            return self.send_data(200,{'ok':True,'analyticsUpdated':updated})
        if p == '/api/refresh':
            sync = read_json(STATUS,{})
            if sync.get('status') == 'running':
                lockfile = ROOT/'local'/'sync.lock'
                if lockfile.exists() and (dt.datetime.now().timestamp() - lockfile.stat().st_mtime < 7200):
                    return self.send_data(409,{'error':'Sincronizzazione già in corso'})
            # Config must remain local, never transmitted to the browser.
            if not (ROOT/'garmin'/'.env.local').exists():
                return self.send_data(400,{'error':'Prima importa la configurazione Garmin dal vecchio progetto.'})
            subprocess.Popen([sys.executable,str(ROOT/'sync.py')],cwd=str(ROOT),
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                             creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            return self.send_data(202,{'ok':True,'message':'Sincronizzazione avviata'})
        return self.send_data(404,{'error':'Endpoint sconosciuto'})


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--port',type=int,default=8766)
    p.add_argument('--no-open',action='store_true')
    args = p.parse_args()
    LOCAL.mkdir(exist_ok=True)
    httpd = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    url=f'http://127.0.0.1:{args.port}'
    print(f'\nCopenhagen 21K · Dashboard privata: {url}\nPremi Ctrl+C per fermarla.\n')
    if not args.no_open:
        threading.Timer(0.7,lambda:webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == '__main__':
    main()
