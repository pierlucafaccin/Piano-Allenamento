"""Garmin sync + rebuild, safely serialized and runnable without the dashboard open."""
from __future__ import annotations
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent
LOCAL=ROOT/'local'
STATUS=LOCAL/'sync-status.json'
LOCK=LOCAL/'sync.lock'
LOG=LOCAL/'sync-output.log'
GARMIN=ROOT/'garmin'


def status(state,error=None):
    obj={'status':state,'updatedAt':dt.datetime.now().isoformat(timespec='seconds')}
    if error:
        obj['error']=str(error)[:500]
    tmp=STATUS.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,STATUS)


def main():
    LOCAL.mkdir(parents=True,exist_ok=True)
    try:
        fd=os.open(LOCK,os.O_CREAT | os.O_EXCL | os.O_WRONLY,0o600)
    except FileExistsError:
        # A stale lock caused by a crash should not permanently block the task.
        if time.time()-LOCK.stat().st_mtime>7200:
            LOCK.unlink(missing_ok=True)
            return main()
        print('Sincronizzazione già in corso.',file=sys.stderr)
        return 2
    try:
        os.close(fd)
        status('running')
        if not (GARMIN/'.env.local').exists():
            raise RuntimeError('File garmin/.env.local mancante: esegui import-existing.bat')
        with LOG.open('a',encoding='utf-8') as log:
            log.write('\n--- '+dt.datetime.now().isoformat(timespec='seconds')+' ---\n')
            for script in ('pull.py','build.py'):
                log.write('RUN '+script+'\n')
                log.flush()
                result=subprocess.run([sys.executable,'-u',script],cwd=str(GARMIN),
                                      stdout=log,stderr=subprocess.STDOUT,timeout=3600)
                if result.returncode:
                    raise RuntimeError(f'{script} terminato con codice {result.returncode}. Consulta local/sync-output.log')
        status('ok')
        print('Garmin aggiornato correttamente.')
        return 0
    except Exception as e:
        status('error',e)
        print('Errore durante sincronizzazione:',str(e),file=sys.stderr)
        return 1
    finally:
        LOCK.unlink(missing_ok=True)

if __name__=='__main__':
    sys.exit(main())
