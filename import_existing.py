"""Copy existing private Garmin data & key from your own local garmin-dashboard directory.
This script only reads a local directory. It never uploads or prints any secrets.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
ALLOW={'activities.json','daily.json','hrv.json','sleep.json','weight.json',
       'profile.json','state.json','token.json','journal.json'}

def main():
    p=argparse.ArgumentParser(description='Importa lo storico Garmin esistente nel progetto Copenhagen21K')
    p.add_argument('source',help='Cartella del progetto garmin-dashboard originale')
    a=p.parse_args()
    src=Path(a.source).expanduser().resolve()
    dst=HERE/'garmin'
    if not (src/'pull.py').is_file() or not (src/'data').is_dir():
        p.error('Cartella non valida: seleziona la root del progetto garmin-dashboard, dove si trova pull.py')
    count=0
    (dst/'data').mkdir(exist_ok=True)
    for name in ALLOW:
        old=src/'data'/name
        if old.is_file():
            shutil.copy2(old,dst/'data'/name)
            count+=1
    if (src/'.env.local').is_file():
        shutil.copy2(src/'.env.local',dst/'.env.local')
        print('Configurazione Garmin importata localmente (chiave non mostrata).')
    else:
        print('Chiave assente: dovrai ricreare garmin/.env.local sul tuo PC.')
    print(f'Importati {count} file di dati privati. Questi file sono esclusi da Git.')
    print('Rigenero la pagina analitica…')
    subprocess.run([sys.executable,'build.py'],cwd=str(dst),check=True)
    print('Pronto. Avvia start.bat per vedere la dashboard integrata.')

if __name__=='__main__':
    main()
