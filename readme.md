# Nyatik Nayan

An intelligent retail platform built for **HackArena 2.0** that combines **real-time
checkout fraud detection** with a **cost-aware, security-hardened conversational AI**
that resolves post-purchase refund/return claims automatically — verifying both that a
returned item is genuinely **damaged** and that it actually belongs to the customer's
**checkout record**, before issuing a refund and initiating pickup.

Built by **Team Schrodinger**.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [The Two Pillars](#the-two-pillars)
3. [Key Features](#key-features)
4. [Tech Stack](#tech-stack)
5. [Architecture](#architecture)
6. [Project Structure](#project-structure)
7. [Pillar A — Checkout Fraud Detection](#pillar-a--checkout-fraud-detection)
8. [Pillar B — Conversational Auditor & Refund Flow](#pillar-b--conversational-auditor--refund-flow)
9. [Cost-Aware AI: Budget Engine & Three-Tier Routing](#cost-aware-ai-budget-engine--three-tier-routing)
10. [Security: Two-Stage Prompt-Injection Screening](#security-two-stage-prompt-injection-screening)
11. [Getting Started](#getting-started)
12. [Environment Variables](#environment-variables)
13. [Database & Migrations](#database--migrations)
14. [Refund Demo (Milo & Colgate)](#refund-demo-milo--colgate)
15. [API Reference](#api-reference)
16. [Tooling](#tooling)
17. [Cron Jobs & Alerting](#cron-jobs--alerting)
18. [Team](#team)

---

## What It Does

**At checkout**, when a cashier or customer scans a barcode, Nyatik Nayan runs it through
a sub-second, multi-layer verification pipeline: it cross-references inventory, analyzes
scan frequency and barcode age for anomalies, validates manufacturer serial numbers
(MK-IDs), computes a fraud-risk score, and either approves or blocks the transaction —
firing an AI-explained email alert on fraud.

**After purchase**, a customer can open the support chatbot, give their **transaction ID**
and a **photo** of the product, and request a refund. The **Conversational Auditor**
resolves the claim end-to-end without a human: it checks whether the item is **broken**,
verifies the item against the **checkout database** for that transaction (anti-fraud), and
— only if both pass — replies **"Refund request done and pickup initiated."** Every AI call
is routed through a **cost-aware budget engine** and screened by a **two-stage
prompt-injection** defense.

---

## The Two Pillars

| | Pillar A — Checkout | Pillar B — Post-Purchase |
|---|---|---|
| Trigger | Barcode scan at the terminal | Refund request in the chatbot |
| Goal | Block counterfeit / mismatched goods | Auto-resolve return claims, prevent refund fraud |
| AI | YOLO + OCR + RapidFuzz + Redis intelligence | Damage detection + MK-ID OCR + checkout-DB match |
| Output | APPROVED / PARTIAL / BLOCKED | APPROVED (refund + pickup) / DENIED / NEEDS_REVIEW |

---

## Key Features

- **Admin-controlled customer sessions** — time-bound, token-based shopper sessions, expired on payment or admin logout.
- **UID uniqueness enforcement** — each barcode+MK-ID can be scanned once per session (anti double-scan).
- **Multi-layer fraud intelligence** — scan-frequency tracking, barcode-age analysis, fuzzy matching, YOLO detection, OCR label verification.
- **Conversational Auditor** — automated 30-day return-policy resolution combining **visual damage detection** and **checkout-database verification**.
- **MK-ID OCR refund** — reads the manufacturer serial (MK-ID) straight off the customer's photo and matches it to the transaction.
- **Anti-refund-fraud** — a refund is issued only when the item is damaged **and** matches the transaction (and optionally the user's purchase history).
- **Cost-aware AI** — a three-tier (Light/Medium/High) router with a hard per-session USD budget and graceful degradation under pressure.
- **Two-stage prompt-injection defense** — sub-ms regex (Stage 1) + a self-hosted LSTM classifier (Stage 2).
- **AI-powered fraud explanations** — human-readable alerts via the Otari LLM gateway, emailed via SendGrid.
- **Real-time WebSocket updates**, **low-stock detection**, and **atomic payment/stock** management.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 + React Router 7 |
| Gateway | Node.js + Express 5 |
| AI Engine | FastAPI (Python) + YOLOv8/v10 + EasyOCR |
| Security ML | Self-hosted LSTM (PyTorch) prompt-injection classifier |
| AI Explanations / NLP | Otari LLM Gateway (Mozilla.ai, OpenAI-compatible) |
| Cache / Session Store | Redis (ioredis) |
| Database | PostgreSQL (pg) |
| Email | Nodemailer (SMTP) + SendGrid |
| Real-time | WebSocket (ws) |
| Scheduled Jobs | node-cron |
| Algorithms | YOLOv10 (detection), RapidFuzz (fuzzy match), EasyOCR (label/MK-ID OCR), Levenshtein near-match |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       React Frontend (Vite)                          │
│  admin-login · customer-login · signup · home · checkout             │
│  transaction · admin-dashboard · chatbot · floating-assistant        │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ REST + WebSocket
┌────────────────────────────▼─────────────────────────────────────────┐
│                Node.js Express Gateway  :3000                         │
│  Auth · Redis sessions · UID gate · txn lock · FastAPI proxy          │
│  Customer Assistant + Conversational Auditor (lib/)                   │
│  Budget engine · model router · 2-stage injection filter · Otari      │
└───────────┬──────────────────────────────────────┬────────────────────┘
            │ HTTP                                  │ read/write
┌───────────▼────────────────────────┐  ┌──────────▼─────────────────────┐
│  FastAPI  :8000                     │  │  Redis                          │
│  /verify · /match · /inventory      │  │  Sessions · txn locks · UID set │
│  /audit/refund-pickup               │  │  scan freq · barcode age        │
│  /audit/verify-claim · -purchase    │  │  budget · low-stock dedup       │
│  /security/injection-check          │  └─────────────────────────────────┘
│  YOLOv8/v10 · EasyOCR · LSTM        │  ┌─────────────────────────────────┐
└───────────┬─────────────────────────┘  │  PostgreSQL (Netra)              │
            │                            │  products · transactions         │
            └────────────────────────────►  checkout_images · delivery_images│
                                         │  customer_purchases · model_usage │
                                         │  injection_events · return_claims │
                                         └─────────────────────────────────┘
```

---

## Project Structure

```
HachArena-2.0/
├── api/                              # FastAPI Python AI engine
│   ├── main.py                       # All routes, YOLO/OCR, refund + damage logic
│   ├── ai_core.py                    # Model loading, MOCK_DB (barcode→product+MK-IDs), OCR
│   ├── purchase_verifier.py          # Anti-fraud: MK-ID extraction + purchase-history check
│   ├── injection_model.py            # Self-hosted LSTM prompt-injection classifier
│   └── AI_Model/                     # Trained YOLO weights (.pt)
│
├── client/src/                       # React frontend
│   ├── checkout.jsx · transaction.jsx        # Scanner + pay flow
│   ├── chatbot.jsx · floating-assistant.jsx  # Support chatbot (refund flow)
│   ├── admin-dashboard.jsx · admin-login.jsx # Admin console
│   └── home.jsx · login.jsx · signup.jsx ...
│
├── lib/                              # Node gateway intelligence
│   ├── aiConfig.js                   # Tier defs, costs, budget ceiling, task taxonomy
│   ├── modelRouter.js                # Routes each task to a tier (budget-aware)
│   ├── budgetEngine.js               # Per-session USD budget + degradation phases
│   ├── auditor.js                    # Conversational Auditor (refund pipeline)
│   ├── customerAssistant.js          # Hybrid assistant: intent → KB/DB/auditor/LLM
│   ├── knowledgeBase.js              # Intent detection + canned answers
│   ├── injectionFilter.js            # Stage-1 regex prompt-injection screen
│   ├── otariClient.js                # Otari LLM gateway client
│   └── txnId.js                      # Unique transaction-ID generator
│
├── db/
│   ├── migration_admin_sessions.sql  # Admin + customer_sessions
│   ├── migration_otari.sql           # model_usage, injection_events, return_claims,
│   │                                 #   checkout_images, delivery_images, customer_purchases
│   ├── migration_refund_mkid.sql     # Adds checkout_images.mk_id (transaction → MK-ID link)
│   └── seed_refund_demo.sql          # Pure-SQL Milo+Colgate demo seed (no Node needed)
│
├── tools/
│   └── make_mkid_label.py            # Stamp an MK-ID label onto a product photo (for OCR)
│
├── samples/                          # Demo images (milo.jpg, colgate.jpg, delivery_photo.jpg)
├── seed-refund-demo.js               # Seeds Milo + Colgate refund transactions
├── seed-images.js                    # Store a checkout/delivery image for a transaction
├── index.js                          # Node.js Express gateway (main server)
└── package.json
```

---

## Pillar A — Checkout Fraud Detection

When a barcode is scanned:

1. HID scanner types the barcode; a `keydown` burst listener fires on `Enter`.
2. Node checks **UID uniqueness** (Redis Set per session) → 409 on duplicate.
3. A **Redis NX lock** (`txn:lock:{shopId}:{barcode}`, 5s TTL) prevents double-processing.
4. Proxy to FastAPI `/verify` → PostgreSQL lookup + base fraud risk.
5. Two intelligence checks run in parallel:
   - **Scan frequency** (`scan:freq:{shopId}:{barcode}`, 1h): 5+ → +0.20 (ELEVATED), 10+ → +0.40 (HIGH/CRITICAL).
   - **Barcode age** (`barcode:first_seen:...`, 30d): never seen → +0.30 (NEW_BARCODE), <30 min → +0.25 (FRESH_LABEL).
6. **MK-ID validation** — wrong serial for the barcode adds +0.35 and blocks.
7. Risk > **0.7** → blocked + **SendGrid fraud alert** with an Otari-generated explanation.
8. Result logged to PostgreSQL and pushed to the UI via **WebSocket**; Redis lock released.

Image-based verification (home page) runs YOLO (class) + EasyOCR (label) + RapidFuzz against
inventory; a trust score below ~65% triggers a BLOCK. `fraud_type` ∈ `LABEL_SWAP`,
`PARTIAL_MISMATCH`, `LOW_CONFIDENCE`, `BARCODE_NOT_FOUND`, `null`.

---

## Pillar B — Conversational Auditor & Refund Flow

The flagship post-purchase feature. The customer opens the chatbot, provides a
**transaction ID** and a **product photo** (and optionally types the MK-ID), and asks for a
refund. The Auditor pipeline (every stage routed + budget-charged):

```
0. Prompt-injection screen (Stage 1 regex → Stage 2 LSTM)
1. Intent capture        (Medium tier — refund / exchange / faq / issue type)
2. FAQ branch            (Light tier — canned policy text, ~free)
3. Refund verification   (High tier — POST /audit/refund-pickup)
4. Automated decision    (APPROVED / DENIED / NEEDS_REVIEW)
```

### The refund decision: damage check **AND** checkout-DB match

`POST /audit/refund-pickup` does two things and only refunds when **both** pass:

1. **Is the product broken?** — `_analyze_intactness()` inspects the uploaded photo
   (YOLO detection confidence + image sharpness as an intactness proxy).
2. **Does it match the checkout database?** — the MK-ID read from the photo (OCR) — or
   typed — must match an MK-ID/barcode linked to that **transaction** (`checkout_images`).
   If a `user_id` is supplied, the item must also exist in that user's purchase history
   (`customer_purchases`).

| Broken? | Matches checkout DB? | Result |
|---------|----------------------|--------|
| Yes | Yes | ✅ **APPROVED** — "Refund request done and pickup initiated" |
| Yes | No  | ❌ **DENIED** — item doesn't match your purchase (anti-fraud) |
| No  | Yes | ❌ **DENIED** — item appears intact / undamaged |
| Unclear / no photo | Yes | 🔎 **NEEDS_REVIEW** — asks for a clearer photo |
| Transaction not found | — | ❌ **DENIED** |

### How the transaction is linked to the MK-ID

Each purchased unit is stored per-transaction in `checkout_images` with its `barcode` and
`mk_id` (added by `db/migration_refund_mkid.sql`). So a transaction maps to the exact
MK-ID(s) the customer bought — that's the "checkout database" the refund is checked against.

### MK-ID OCR (reading the serial off the photo)

`recognize_mk_id()` → EasyOCR → `extract_mk_id_from_texts()`. OCR often splits the serial
across boxes or drops the hyphens, so extraction is tolerant: strict match → loose
(separators optional) → separator-stripped, reconstructing the canonical
`MK-CODE-YYYY-SUFFIX`. A normalized **Levenshtein ≤ 1** near-match absorbs single-character
slips (e.g. `O`↔`0`) while still rejecting a wrong product.

To make OCR readable on a plain product photo, stamp the MK-ID on first:

```bash
python tools/make_mkid_label.py --mk-id MK-MILO-2024-A001 \
    --base samples/milo.jpg --out samples/milo_mkid.jpg --product "Nestle Milo 500g"
```

### Deterministic demo damage mode (recommended for the hackathon)

Damage detection is a heuristic, not a trained model — so for a 100% reproducible demo,
`REFUND_DEMO_MODE` (**on by default**) lets the uploaded **filename** decide the condition:

- filename contains `broken` / `damaged` / `cracked` / `torn` … → **damaged** → refund
- filename contains `intact` / `undamaged` / `sealed` / `good` … → **intact** → no refund
- no keyword → falls back to the visual model

Name your four test files `milo_broken.jpg`, `milo_intact.jpg`, `colgate_broken.jpg`,
`colgate_intact.jpg` and the flow behaves exactly as the table above. Set
`REFUND_DEMO_MODE=false` to always use the model (tune it with `AUDIT_INTACT_THRESHOLD`).

> The damage detector sits behind a clean `_analyze_intactness()` contract in `api/main.py`
> — swap in a fine-tuned seal/damage-integrity model for production without touching the
> rest of the flow.

---

## Cost-Aware AI: Budget Engine & Three-Tier Routing

Every AI task is routed to the cheapest tier that can do the job, charged against a hard
per-session USD budget (`SESSION_BUDGET_USD`, default **$2.00**), and degraded gracefully as
the budget drains. Config lives in `lib/aiConfig.js`.

| Tier | Backing model | Est. cost / call | Latency target | Used for |
|------|---------------|------------------|----------------|----------|
| **Light** | rule engine | ~$0.0002 | 50 ms | barcode lookup, FAQ/policy text, logging, injection_classify |
| **Medium** | Otari gateway (e.g. `gpt-4o-mini`) | ~$0.01 | 500 ms | intent parsing, injection escalation, trend analysis |
| **High** | YOLO vision (+ OCR) | ~$0.08 | 2000 ms | refund image audit, ticket-switch detection |

**Degradation phases** (fraction of budget remaining): `NORMAL` → `WARNING` (≤50%) →
`CRITICAL` (≤20%, conversational tasks locked to Light, High tier reserved for real-time
fraud) → `EXHAUSTED`. Usage is logged per call to `model_usage` for a transparency dashboard.

---

## Security: Two-Stage Prompt-Injection Screening

Before any refund reasoning runs, the customer's message is screened:

- **Stage 1 — regex (`lib/injectionFilter.js`)**: sub-millisecond pattern pass. A hit is a
  hard block with **zero** model spend.
- **Stage 2 — self-hosted LSTM (`api/injection_model.py`, `POST /security/injection-check`)**:
  a local PyTorch classifier (no external AI) catches obfuscated attempts. **Fails open** —
  if torch/the model is unavailable, Stage-1 regex still protects the system.

Both stages log to `injection_events` for the security transparency view.

---

## Getting Started

### Prerequisites
- Node.js ≥ 20, Python ≥ 3.10, PostgreSQL, Redis

### 1. Install dependencies
```bash
npm install
pip install fastapi uvicorn asyncpg rapidfuzz python-dotenv redis aioredis \
            ultralytics opencv-python numpy easyocr pillow torch
```
> `easyocr`/`pillow` power MK-ID OCR + the label tool; `torch` powers the Stage-2
> injection LSTM. Each fails soft if missing.

### 2. Configure `.env` (see [Environment Variables](#environment-variables))

### 3. Set up the database (see [Database & Migrations](#database--migrations))

### 4. Build the frontend
```bash
npm run build
```

### 5. Start the FastAPI engine
```bash
cd api && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
On boot you should see: `✅ FastAPI connected to PostgreSQL + Redis`,
`✅ YOLOv8 model loaded`, `✅ EasyOCR reader warmed up`.

### 6. Start the Node gateway
```bash
npm start
```
Open `http://localhost:3000`.

---

## Environment Variables

```env
PORT=3000
FASTAPI_URL=http://localhost:8000

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=Netra
DB_USER=postgres
DB_PASSWORD=yourpassword
# FastAPI uses DATABASE_URL (defaults to the values above):
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/Netra

REDIS_URL=redis://localhost:6379
SESSION_SECRET=your_secret_here

# Email
MAIL_USER=your@gmail.com
MAIL_PASS=your_app_password
SENDGRID_API_KEY=your_sendgrid_key
SENDGRID_FROM=alerts@yourdomain.com

# Otari LLM Gateway (Mozilla.ai). Leave unset to run local (LLM → human handoff).
OTARI_BASE_URL=https://api.otari.ai
OTARI_API_KEY=your_otari_gateway_key
OTARI_MODEL=gpt-4o-mini

# Cost-aware AI (lib/aiConfig.js)
SESSION_BUDGET_USD=2.00
BUDGET_WARNING_PCT=0.50
BUDGET_CRITICAL_PCT=0.20

# Refund / auditor
RETURN_WINDOW_DAYS=30
AUDIT_INTACT_THRESHOLD=0.55     # model damage threshold (when demo mode is off)
REFUND_DEMO_MODE=true           # filename-driven deterministic damage verdict

# Checkout
LOW_STOCK_THRESHOLD=5
APP_URL=http://localhost:3000
```

---

## Database & Migrations

Create the core checkout tables (`retailers`, `products`, `transactions`,
`fraud_incidents`, `audit_log`) as in your base schema, then apply the migrations:

```bash
# Admin + customer sessions
psql -U postgres -d Netra -f db/migration_admin_sessions.sql

# Auditor + security + refund tables:
#   model_usage, injection_events, return_claims,
#   checkout_images, delivery_images, customer_purchases
psql -U postgres -d Netra -f db/migration_otari.sql

# Link a transaction to the purchased MK-ID (adds checkout_images.mk_id)
psql -U postgres -d Netra -f db/migration_refund_mkid.sql
```

> `seed-refund-demo.js` also self-heals the schema it needs (it runs
> `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS mk_id`), so a forgotten
> migration won't break seeding or the refund lookup.

---

## Refund Demo (Milo & Colgate)

```bash
# Option A — Node seeder (uses DB_* env, same defaults as the gateway)
npm run seed:refund-demo

# Option B — pure SQL, targets the EXACT database the API uses (avoids env mismatch)
psql "$DATABASE_URL" -f db/seed_refund_demo.sql
```

This creates two transactions:

| Product | Transaction ID | MK-ID | Image | Channel |
|---------|----------------|-------|-------|---------|
| Nestle Milo 500g | `100000000001` | `MK-MILO-2024-A001` | `samples/milo.jpg` | offline |
| Colgate 150ml | `100000000002` | `MK-CLG-2024-P010` | `samples/colgate.jpg` | online |

**Test in the chatbot** — paste the Transaction ID, type the MK-ID (or attach a
`*_mkid.jpg` so OCR reads it), attach the product photo, and say *"I want a refund."*

| Txn ID | MK-ID | Attach | Expected |
|--------|-------|--------|----------|
| `100000000001` | `MK-MILO-2024-A001` | `milo_broken.jpg` | ✅ Refund + pickup |
| `100000000001` | `MK-MILO-2024-A001` | `milo_intact.jpg` | ❌ "appears intact" |
| `100000000002` | `MK-CLG-2024-P010` | `colgate_broken.jpg` | ✅ Refund + pickup |
| `100000000001` | `MK-CLG-2024-P010` | `colgate_broken.jpg` | ❌ mismatch — wrong transaction |

> The last row demonstrates the anti-fraud checkout-DB match (fully real logic, independent
> of the demo damage mode). See `samples/README.md` for the full 4-image workflow.

---

## API Reference

### Node.js Gateway (port 3000)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/admin/register` · `/api/admin/login` · `/api/admin/logout` | Public/Admin | Admin auth + session control |
| POST | `/api/admin/create-customer-session` · `/api/admin/expire-customer-session` | Admin | Customer session lifecycle |
| GET  | `/api/admin/active-sessions` | Admin | List sessions |
| POST | `/api/customer/enter` | Public | Join with a session token |
| POST | `/api/checkout/verify` | Auth | Gate + verify a barcode scan |
| POST | `/api/checkout/match-verify` | Auth | Image OCR + YOLO match |
| POST | `/api/checkout/pay` | Auth | Finalize cart + decrement stock (stores checkout images + MK-IDs) |
| POST | `/api/checkout/upload-image` | Auth | Attach a product image (+ MK-ID) to a transaction |
| POST | `/api/chatbot/ask` | Public | Customer Assistant (intent → KB/DB/auditor/LLM) |
| POST | `/api/chatbot/audit` | Public | Conversational Auditor (refund) directly |
| GET  | `/api/inventory` · `/api/inventory/low-stock` · `/api/audit-log` | Auth | Inventory + audit proxies |
| GET  | `/api/health` | Public | Redis + DB health |

### FastAPI Engine (port 8000)

| Method | Path | Description |
|---|---|---|
| POST | `/audit/refund-pickup` | **Refund decision**: damage check + checkout-DB MK-ID match → refund + pickup |
| POST | `/audit/verify-claim` | High-tier visual damage/intactness audit (offline + online/delivery) |
| POST | `/audit/verify-purchase` | Anti-fraud: recognized MK-ID vs the user's purchase history |
| POST | `/audit/verify-refund` | Transaction-anchored ORB/OCR visual match (legacy refund check) |
| POST | `/security/injection-check` | Stage-2 LSTM prompt-injection classifier |
| POST | `/verify` · `/match` | Barcode verify + risk; OCR/YOLO fuzzy match |
| GET  | `/inventory` · `/audit-log` · `/mk-ids` · `/health` | Inventory, logs, MK-ID list, status |

#### `POST /audit/refund-pickup` (request)
```json
{
  "transaction_id": "100000000001",
  "image_b64": "data:image/jpeg;base64,...",
  "mk_id": "MK-MILO-2024-A001",
  "image_name": "milo_broken.jpg",
  "user_id": "USER_9921",
  "product_name": "Nestle Milo 500g"
}
```
#### (response)
```json
{
  "transaction_id": "100000000001",
  "matched": true, "damaged": true, "intact": false,
  "refund_done": true, "reason": "verified_damaged",
  "recognized_mk_id": "MK-MILO-2024-A001",
  "recognition_method": "provided_mk_id",
  "product_name": "Nestle Milo 500g",
  "message": "Refund request done and pickup initiated for Nestle Milo 500g (MK-ID MK-MILO-2024-A001) under transaction 100000000001 — the item was verified as damaged and matches your purchase."
}
```

---

## Tooling

- **`tools/make_mkid_label.py`** — stamps a high-contrast MK-ID label onto a product photo
  (or generates a standalone label) so EasyOCR can read the serial. Requires Pillow (ships
  with EasyOCR). `--mk-id`, `--base`, `--out`, `--product`.
- **`seed-refund-demo.js`** / **`db/seed_refund_demo.sql`** — seed the Milo + Colgate refund demo.
- **`seed-images.js`** — attach a checkout/delivery image (and MK-ID) to a transaction:
  `node seed-images.js checkout <txn_id> <image> [shop_id] [barcode] [channel] [mk_id]`.

---

## Cron Jobs & Alerting

| Schedule | Job | Channel |
|---|---|---|
| Daily 20:00 | Transaction digest (approved/blocked stats) | SendGrid |
| Daily 09:00 | Low-stock sweep across shops | SendGrid |
| Hourly | Fraud-flag escalation (3+ blocks in 24h) | SendGrid |
| On signup | Welcome / onboarding | Nodemailer |
| On block (risk > 0.6) | Fraud alert + Otari AI explanation | SendGrid |
| Low stock after sale | Restock warning (24h dedup) | SendGrid |

---

## Team

Built by **Team Schrodinger** for **HackArena 2.0**.
