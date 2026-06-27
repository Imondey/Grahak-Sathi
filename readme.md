# Nyatik Nayan

An intelligent retail fraud detection and checkout management platform built for **HackArena 2.0**. Nyatik Nayan enables store admins to manage customer sessions, scan product barcodes at checkout, and instantly detect counterfeit or mismatched goods using AI-powered verification, real-time fraud scoring, and automated alerting.

---

## What It Does

When a cashier or customer scans a barcode, Nyatik Nayan runs it through a multi-layer verification pipeline in under a second. It cross-references your inventory database, analyzes scan frequency and barcode age for anomalies, validates manufacturer serial numbers (MK IDs), computes a fraud risk score, and either approves the transaction or blocks it — flashing the result on screen and firing an email alert (with AI-generated explanation) if fraud is detected.

---

## Key Features

- **Admin-controlled customer sessions** — Admins create time-bound, token-based sessions for shoppers. Sessions are expired on payment or admin logout.
- **UID uniqueness enforcement** — Each barcode+MK ID combination can only be scanned once per session, preventing accidental double-scanning.
- **Multi-layer fraud intelligence** — Scan frequency tracking, barcode age analysis, fuzzy string matching, YOLO object detection, and OCR-based label verification.
- **AI-powered fraud explanations** — Human-readable fraud-alert explanations generated via the Otari LLM gateway (Mozilla.ai) and emailed to the retailer.
- **Real-time WebSocket updates** — Checkout UI receives instant transaction results and session expiry events.
- **Low-stock detection** — Automatic email alerts when inventory drops below configurable thresholds, with 24-hour dedup to prevent spam.
- **Payment flow with stock management** — Atomic stock decrement on payment, with rollback on insufficient inventory.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 + React Router 7 |
| Gateway | Node.js + Express 5 |
| AI Engine | FastAPI (Python) + YOLOv8/v10 + EasyOCR |
| AI Explanations | Otari LLM Gateway (Mozilla.ai, OpenAI-compatible) |
| Cache / Session Store | Redis (ioredis) |
| Database | PostgreSQL (pg) |
| Email (Transactional) | Nodemailer (Gmail SMTP) |
| Email (Fraud Alerts) | SendGrid |
| Real-time | WebSocket (ws) |
| Scheduled Jobs | node-cron |
| Algorithms | YOLOv10 (Class Detection), RapidFuzz (Fuzzy String Matching), EasyOCR (Label OCR), Decision Tree scoring |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     React Frontend (Vite)                            │
│  admin-login · customer-login · signup · home · checkout            │
│  transaction · admin-dashboard · session-expired                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ REST + WebSocket
┌────────────────────────────▼────────────────────────────────────────┐
│              Node.js Express Gateway  :3000                         │
│  Admin + Customer auth · Redis sessions · UID uniqueness gate       │
│  Redis txn lock · FastAPI proxy · Otari gateway · SendGrid          │
│  Nodemailer · node-cron (daily digest, low-stock sweep)             │
└───────────┬─────────────────────────────────────┬───────────────────┘
            │ HTTP proxy                          │ read/write
┌───────────▼───────────────┐   ┌────────────────▼───────────────────┐
│  FastAPI  :8000           │   │  Redis                              │
│  POST /verify             │   │  Sessions · Txn locks · UID sets    │
│  POST /match              │   │  Fraud flag cache · Scan frequency  │
│  GET  /inventory          │   │  Barcode age · Low-stock dedup      │
│  GET  /audit-log          │   └─────────────────────────────────────┘
│  GET  /mk-ids             │   ┌─────────────────────────────────────┐
│  GET  /health             │   │  PostgreSQL (Netra)                  │
└───────────┬───────────────┘   │  retailers · admins · products       │
            │                   │  transactions · fraud_incidents       │
            └───────────────────►  customer_sessions · audit_log       │
                                └─────────────────────────────────────┘
```

---

## Project Structure

```
Team-Schrodinger/
├── api/                            # FastAPI Python AI engine
│   ├── main.py                     # FastAPI routes + YOLO inference
│   ├── ai_core.py                  # YOLO model loading, OCR, fuzzy match pipeline
│   └── AI_Model/                   # Trained model weights (.pt files)
│
├── client/                         # React frontend (Vite)
│   ├── src/
│   │   ├── app.jsx                 # Router + AuthGuard
│   │   ├── admin-login.jsx         # Admin login (email + unique code)
│   │   ├── customer-login.jsx      # Customer session entry (token)
│   │   ├── signup.jsx              # Retailer registration
│   │   ├── home.jsx                # Image upload + OCR/YOLO verify
│   │   ├── checkout.jsx            # HID scanner barcode terminal
│   │   ├── transaction.jsx         # Customer-facing scan + pay flow
│   │   ├── admin-dashboard.jsx     # Session management + audit log
│   │   ├── session-expired.jsx     # Customer session-ended page
│   │   ├── index.css               # Global styles
│   │   └── main.jsx                # React entry point
│   ├── index.html
│   └── vite.config.js
│
├── db/
│   └── migration_admin_sessions.sql  # Admin + customer_sessions DDL
│
├── AI_Model/                       # YOLO training config (YAML)
├── runs/detect/                    # Training run artifacts (metrics, graphs)
│
├── index.js                        # Node.js Express gateway (main server)
├── package.json
└── .gitignore
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- Python >= 3.10
- PostgreSQL running locally
- Redis running locally (`redis-server`)

### 1. Install Node Dependencies

```bash
npm install
```

### 2. Install Python Dependencies

```bash
pip install fastapi uvicorn asyncpg rapidfuzz python-dotenv redis aioredis ultralytics opencv-python numpy easyocr thefuzz torch
```

> `torch` powers the self-hosted prompt-injection LSTM (Stage-2 security classifier, served at `POST /security/injection-check`). If torch isn't installed the model is skipped and the gateway falls back to the Stage-1 regex filter.

### 3. Configure Environment

Create a `.env` file in the root:

```env
PORT=3000
FASTAPI_URL=http://localhost:8000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=Netra
DB_USER=postgres
DB_PASSWORD=yourpassword

REDIS_URL=redis://localhost:6379
SESSION_SECRET=your_secret_here

MAIL_USER=your@gmail.com
MAIL_PASS=your_app_password

SENDGRID_API_KEY=your_sendgrid_key
SENDGRID_FROM=alerts@yourdomain.com

# ── Otari LLM Gateway (Mozilla.ai) — replaces Groq ──
# OpenAI-compatible gateway that manages provider keys, routing & budgets.
# Leave OTARI_BASE_URL unset to run fully local (LLM fallback → human handoff).
OTARI_BASE_URL=https://api.otari.ai
OTARI_API_KEY=your_otari_gateway_key
OTARI_MODEL=gpt-4o-mini

LOW_STOCK_THRESHOLD=5

APP_URL=http://localhost:3000
```

### 4. Set Up the Database

Run the core tables:

```sql
CREATE TABLE retailers (
  id SERIAL PRIMARY KEY,
  owner_name TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  phone TEXT,
  email TEXT UNIQUE NOT NULL,
  address TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  barcode TEXT NOT NULL,
  shop_id INTEGER REFERENCES retailers(id),
  product_name TEXT,
  price NUMERIC,
  quantity INT,
  barcode_format TEXT,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(barcode, shop_id)
);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  shop_id INT REFERENCES retailers(id),
  barcode TEXT,
  product_name TEXT,
  status TEXT,
  fraud_risk NUMERIC,
  barcode_format TEXT,
  intelligence_flags TEXT,
  scan_count INT,
  barcode_age_mins INT,
  scanned_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE fraud_incidents (
  id SERIAL PRIMARY KEY,
  shop_id INT REFERENCES retailers(id),
  barcode TEXT,
  product_name TEXT,
  risk_score NUMERIC,
  action TEXT,
  incident_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  shop_id INT,
  barcode TEXT,
  product_name TEXT,
  status TEXT,
  fraud_risk NUMERIC,
  logged_at TIMESTAMP DEFAULT NOW()
);
```

Then run the admin/session migration:

```bash
psql -U postgres -d Netra -f db/migration_admin_sessions.sql
```

### 5. Build the Frontend

```bash
npm run build
```

### 6. Start the FastAPI Engine

```bash
cd api
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 7. Start the Node.js Gateway

```bash
npm start
```

Open `http://localhost:3000`.

---

## User Flows

### Admin Flow

1. **Admin registers** via `/api/admin/register` with email, shop details, and a unique code.
2. **Admin logs in** at `/` using email + unique code → 16-hour session.
3. **Admin creates customer sessions** from the dashboard — generates a token for shoppers.
4. **Admin monitors** active sessions, audit log, and fraud incidents.
5. **Admin expires sessions** after payment or logs out (auto-expires all active customer sessions).

### Customer Flow

1. **Customer enters** at `/customer` with the session token provided by the admin.
2. **Customer scans products** on the transaction page using HID barcode scanner.
3. **Each scan** is UID-checked (barcode + optional MK ID) to prevent double-scanning.
4. **Customer pays** → stock is atomically decremented → session auto-expires after 5 seconds.

---

## How a Scan Works

1. Cashier/customer scans a barcode — the HID scanner types characters as keystrokes.
2. A `keydown` burst listener captures the buffer and fires on `Enter`.
3. Node.js checks **UID uniqueness** (Redis Set per session). If already scanned, returns 409.
4. A **Redis NX lock** (`txn:lock:{shopId}:{barcode}` with 5s TTL) prevents duplicate processing.
5. The request is proxied to FastAPI `/verify`, which queries PostgreSQL and returns product details + base fraud risk.
6. Two fraud intelligence checks run **in parallel**:
   - **Scan frequency** — how many times this barcode was scanned in the last hour.
   - **Barcode age** — when this barcode was first seen at this store.
7. If an **MK ID** is provided, it's validated against the known manufacturer serials.
8. If the final risk score exceeds **0.7**, the transaction is blocked and a **SendGrid fraud alert** fires (with Llama AI explanation).
9. The result is logged to PostgreSQL and pushed to the checkout UI via **WebSocket**.
10. The Redis lock is released.

---

## Fraud Intelligence

### Scan Frequency (`scan:freq:{shopId}:{barcode}`, TTL 1h)

| Condition | Risk Added | Flag |
|---|---|---|
| 5+ scans in 1 hour | +0.20 | ELEVATED_FREQUENCY |
| 10+ scans in 1 hour | +0.40 | HIGH_FREQUENCY (CRITICAL) |

### Barcode Age (`barcode:first_seen:{shopId}:{barcode}`, TTL 30d)

| Condition | Risk Added | Flag |
|---|---|---|
| Never seen before | +0.30 | NEW_BARCODE |
| First seen < 30 minutes ago | +0.25 | FRESH_LABEL |

### MK ID Validation

If a Manufacturer Key ID is provided and does not match the known serials for that barcode, **+0.35 risk** is added and the transaction is blocked.

### Escalation

If a barcode is blocked **3+ times within 24 hours**, an escalated incident report is sent automatically via SendGrid.

---

## YOLO / EasyOCR Integration

For image-based verification (home page), the AI pipeline:

1. **YOLO** detects the product class label from the image.
2. **EasyOCR** extracts text from the product label.
3. **RapidFuzz** fuzzy-matches the detected label and OCR text against the inventory database.
4. A **trust score** is computed — below 65% triggers a BLOCK with fraud narrative.

```
POST /api/checkout/match-verify
{
  "barcode":      "8901030823437",
  "product_ocr":  "Milo 500g Nestle",
  "barcode_ocr":  "8901030823437",
  "yolo_label":   "Nestle Milo",
  "mk_id":        "MK-MILO-2024-A001"   // optional
}
```

Possible `fraud_type` values: `"LABEL_SWAP"`, `"PARTIAL_MISMATCH"`, `"LOW_CONFIDENCE"`, `"BARCODE_NOT_FOUND"`, `null`.

---

## Alerting

| Event | System | Email Content |
|---|---|---|
| Retailer signs up | Nodemailer (SMTP) | Welcome + onboarding |
| Transaction blocked (risk > 0.6) | SendGrid + Otari gateway | Fraud alert + AI explanation |
| Fraud flag count >= 3 in 24h | SendGrid | Escalated incident report |
| Low stock after sale | SendGrid (24h dedup) | Restock warning with item list |
| Daily at 20:00 | SendGrid (cron) | Transaction digest (approved/blocked stats) |
| Daily at 09:00 | SendGrid (cron) | Low-stock sweep for all shops |

---

## API Reference

### Node.js Gateway (port 3000)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/register` | Public | Register a new retailer |
| POST | `/api/login` | Public | Retailer login (legacy) |
| POST | `/api/logout` | Public | Destroy session |
| GET | `/api/me` | Public | Return current session user |
| POST | `/api/admin/register` | Public | Create a new admin account |
| POST | `/api/admin/login` | Public | Admin login (email + unique code) |
| POST | `/api/admin/logout` | Admin | Admin logout (expires all customer sessions) |
| POST | `/api/admin/create-customer-session` | Admin | Generate a customer session token |
| POST | `/api/admin/expire-customer-session` | Admin | End a customer session after payment |
| GET | `/api/admin/active-sessions` | Admin | List all sessions for this admin |
| POST | `/api/admin/reset-session-uids` | Admin | Clear UID set for re-scanning |
| POST | `/api/customer/enter` | Public | Customer joins with session token |
| GET | `/api/customer/session-status` | Customer | Poll session validity |
| POST | `/api/checkout/verify` | Auth | Gate + verify a barcode scan |
| POST | `/api/checkout/match-verify` | Auth | Image OCR + YOLO match |
| POST | `/api/checkout/pay` | Auth | Finalize cart + decrement stock |
| POST | `/api/alerts/fraud` | Auth | Manually trigger fraud alert |
| GET | `/api/inventory` | Auth | Proxy to FastAPI inventory |
| GET | `/api/inventory/low-stock` | Auth | List products below threshold |
| GET | `/api/audit-log` | Auth | Proxy to FastAPI audit log |
| GET | `/api/health` | Public | Redis + DB health check |

### FastAPI Engine (port 8000)

| Method | Path | Description |
|---|---|---|
| POST | `/verify` | Barcode lookup + risk score + MK ID validation |
| POST | `/match` | OCR + YOLO fuzzy match with optional image inference |
| GET | `/inventory` | Product inventory list (by shop) |
| GET | `/audit-log` | Paginated audit log (by shop) |
| GET | `/mk-ids` | List valid MK IDs for a barcode (demo helper) |
| GET | `/health` | DB + Redis + YOLO status check |

---

## Demo Script (60 seconds)

1. **Admin registers** → `POST /api/admin/register`
2. **Admin logs in** at `/` → 16-hour session established
3. **Admin creates customer session** → token generated (e.g., `a1b2c3d4...`)
4. **Customer enters** at `/customer` with the token → redirected to `/transaction`
5. **Customer scans a valid barcode** → Redis gate → FastAPI → green APPROVED banner
6. **Customer scans same barcode again** → 409 duplicate UID rejection
7. **Customer scans a mismatched barcode** → risk > 0.7 → red BLOCKED banner + Llama AI alert email fires
8. **Customer pays** → stock decremented → session auto-expires in 5 seconds
9. **Admin dashboard** → audit log shows all transactions with risk scores and intelligence flags
10. **Email inbox** → fraud alert with AI-generated explanation arrived in real time

---

## Cron Jobs

| Schedule | Job |
|---|---|
| Daily 20:00 | Transaction digest email to all retailers |
| Daily 09:00 | Low-stock sweep — emails retailers about products below threshold |
| Every hour | Fraud flag escalation check — sends incident reports for 3+ flags in 24h |

---

## Team

Built by **Team Schrodinger** for HackArena 2.0.
