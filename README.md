# Trading Bot — Cloudflare Workers

Bot di trading automatico che gira 24/7 su Cloudflare Workers (GRATIS).

## Deploy in 3 minuti

### 1. Installa Wrangler (se non ce l'hai)
```bash
npm install -g wrangler
wrangler login
```

### 2. Clona la cartella e installa
```bash
cd trading-bot-cf
```

### 3. Inizializza il database D1
```bash
npx wrangler d1 execute trading-bot --file=schema.sql --remote
```

### 4. Deploya il Worker
```bash
npx wrangler deploy
```

### 5. Secret opzionali per i datasource
```bash
# US stocks real-time
wrangler secret put ALPACA_KEY
wrangler secret put ALPACA_SECRET

# Crypto via Revolut X
wrangler secret put REVOLUT_X_API_KEY
wrangler secret put REVOLUT_X_PRIVATE_KEY
```

Se non configuri questi secret, il bot continua a usare Yahoo Finance come fallback.

Fatto! Il bot è online su `https://trading-bot.<tuo-account>.workers.dev`

## Come funziona

- **Cron trigger** ogni 5 minuti → scansiona 18 asset (12 azioni + 6 crypto)
- **D1 Database** per salvare posizioni, trade, pesi del Brain
- **Dashboard web** su `/` — accessibile da qualsiasi browser
- **API REST** per la GUI desktop o integrazioni

## API Endpoints

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/` | Dashboard web |
| GET | `/api/status` | Stato completo (posizioni, equity, brain) |
| GET | `/api/scan` | Trigger scan manuale |
| POST | `/api/close` | Chiudi posizione `{ticker:"AAPL"}` |
| POST | `/api/close-all` | Chiudi tutte |
| POST | `/api/reset` | Reset a €5.000 |

## Costi
- Cloudflare Workers Free: 100.000 richieste/giorno
- D1 Free: 5GB storage, 5M rows read/day
- Cron trigger: illimitati
- **Totale: €0/mese**
