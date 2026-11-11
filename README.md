# Piano-Allenamento · Copenhagen 21K

Aggiornamento **della repository esistente** `pierlucafaccin/Piano-Allenamento` (ex LISBONA21K). Nessuna nuova repository. Obiettivo: **Copenhagen Half Marathon, 19 settembre 2027** (SuperHalfs).

## Contenuti

- Web dashboard su **GitHub Pages**: `/Piano-Allenamento/`, con riepilogo, schede del lunedì e martedì, progressione tapis di 8 settimane, diario e analisi Garmin complete.
- Le schede di mercoledì, giovedì e venerdì sono predisposte ma **non inventate**: per venerdì è confermata soltanto la seconda sessione sul tapis.
- Il weekend alterna, senza ordine fisso, REST totale e REST attivo: 30–40 minuti di camminata e mobilità.
- I dati Garmin originali, disponibili fino al **2 novembre 2026** nello ZIP fornito, sono inclusi come punto di partenza; non sono spacciati per aggiornati.
- I dati Garmin, i grafici, sonno e HRV **sono pubblici** per tua scelta. Possono rivelare informazioni personali e abitudini di spostamento. **Credenziali e token non vanno mai pubblicati**, nemmeno in repository private.

## Installazione nella repository GIA' ESISTENTE

In PowerShell, dopo aver estratto lo ZIP (include `Aggiorna-Piano-Allenamento.ps1` e `repo-files/`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Aggiorna-Piano-Allenamento.ps1
```

Lo script esegue un `git clone` in `C:\Siti\Piano-Allenamento` solo se la cartella non esiste, **non sovrascrive modifiche non salvate**, verifica che l'origin sia la repository corretta, aggiorna i soli file forniti, e mostra l'elenco prima di committare e pubblicare. Non usa `--force`.

La vecchia dashboard Lisbona rimane nello storico Git dei commit precedenti; nessuna branch nuova. Se preferisci una copia consultabile, salva il vecchio `index.html` prima dell'aggiornamento.

## Attivazione GitHub Pages

Repository > Settings > Pages > Deploy from a branch > `main` / `(root)` > Save.
Sito: `https://pierlucafaccin.github.io/Piano-Allenamento/` (potrebbero volerci alcuni minuti per il primo deploy).

## Aggiornamento Garmin CLOUD completamente automatico

1. Repository > Settings > Secrets and variables > Actions > New repository secret.
2. Nome **`GARMIN_PERSONAL_API_KEY`**. Incolla **solo il valore** già presente sul tuo PC nel file originale `garmin-dashboard/.env.local`. **Non** pubblicare mai l'intero `.env.local`, una password o il contenuto di `token.json`.
3. Settings > Actions > General > Workflow permissions: assicurati che GitHub Actions possa scrivere i contenuti (Read and write permissions, se disponibile).
4. Actions > `Aggiorna Garmin e dashboard` > Run workflow per il primo aggiornamento.

Il job esegue `garmin/pull.py`, `garmin/build.py` e `tools/make_public.py`, poi committa gli output su `main`. È programmato **ogni giorno alle 05:30 UTC (06:30 inverno, 07:30 estate in Italia)**; gli orari dei job GitHub Actions non sono garantiti al minuto e GitHub può ritardarne o saltarne qualcuno. Un PC acceso non serve. L'accesso a Garmin dipende dalla validità della tua Personal API key.

## Uso locale e diario

- Per usare il server locale con salvataggio su file, `start.bat`; per aggiornare solo i dati, `refresh.bat`.
- Online su GitHub Pages, le annotazioni del diario vengono salvate **nel browser via localStorage**. Le annotazioni iniziali del 9 e 10 novembre sono precaricate da `training-log-public.json`. Il bottone **Esporta diario** crea un JSON da conservare. Le modifiche browser **non si sincronizzano automaticamente tra PC e telefono** e non vengono committate su GitHub: questa è una possibile funzionalità futura.
- Per pubblicare su GitHub gli aggiornamenti del diario già fatti nel browser, va aggiornato `training-log-public.json` con il JSON esportato e committato (i diversi browser manterranno una propria copia locale).
- Se conservi il progetto completo nella vecchia cartella Garmin, il file `.env.local` resta sempre escluso da Git.

### File di dati pubblicati

`garmin/data/{activities,daily,hrv,profile,sleep,state,weight}.json`, `garmin/dashboard.html`, `garmin/summary.json`, `training-log-public.json`. Non verranno pubblicati `garmin/data/token.json`, `garmin/.env.local`, `_samples`, `local/` o altri file con credenziali.

## Per ulteriori schede

Modifica `training-plan.json > schedule.wed`, `schedule.thu` e `schedule.fri` quando arrivano le foto. Le fasi successive al blocco di riabilitazione sono segnaposti, non prescrizioni per gli allenamenti futuri.
