# Capture-Decision E2E Verification Runbook

Step-by-step verification of the checkout capture-match decision pipeline across
the six target scenarios. The pure decision logic (scenarios 1–5) is covered
deterministically by `npm run test:capture`
(`tools/test-capture-decision.js`); this runbook verifies the **full stack**
(HTTP + WebSocket + Redis + PostgreSQL + FastAPI/YOLO + camera), which can't run
in the CI sandbox.

---

## 0. Prerequisites

Bring the stack up (see the main README):

```bash
# Redis + PostgreSQL running; migrations applied, including:
psql "$DATABASE_URL" -f db/migration_capture_match_thresholds.sql
# FastAPI engine (YOLO + OCR)
cd api && uvicorn main:app --host 0.0.0.0 --port 8000
# Node gateway
npm start           # :3000
```

Seed one product **with a linked reference image** (the capture is scored against
it). Use an admin session; `reference_image_path`/`reference_image_status='linked'`
must be set for the barcode (see `/api/admin/*` reference-image endpoints or
`migration_reference_images.sql`).

Helper env for the commands below:

```bash
BASE=http://localhost:3000
CJAR=/tmp/cashier.cookies      # cashier/customer session (isAuth)
AJAR=/tmp/admin.cookies        # admin session (isAdmin)
BARCODE=8901234567890          # a barcode that HAS a linked reference image
```

### Observability cheat-sheet

```bash
# Live WebSocket feed for the shop (CAPTURE_STATE / CAPTURE_REVIEW_REQUEST / LANE_FROZEN …)
npx wscat -c ws://localhost:3000/ws        # then send: {"shopId": <SHOP_ID>}

# Redis state
redis-cli GET  "txn:capture:<CAP-…>"        # lifecycle state (status, image, match)
redis-cli GET  "capture:decision:<shop>:<barcode>"   # pay-gate band
redis-cli GET  "capture:fault:<shop>"       # rolling lane-fault counter
redis-cli TTL  "capture:fault:<shop>"       # ~<=900s window
redis-cli GET  "lane:frozen:<shop>"         # freeze flag (if present)

# Postgres audit trail
psql "$DATABASE_URL" -c "SELECT id,barcode,capture_match_score,capture_match_decision FROM transactions ORDER BY scanned_at DESC LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT barcode,action,risk_score,incident_at FROM fraud_incidents ORDER BY incident_at DESC LIMIT 5;"
```

### Forcing bands deterministically

The band depends on the YOLO capture-match **confidence** vs the store's
thresholds. Two ways to drive each scenario:

- **Realistic:** put the matching / a different / a partially-occluded product in
  frame (scenarios 1/2/3 respectively).
- **Deterministic:** tune the per-store thresholds so a known image lands where
  you want:

```bash
# e.g. force everything to auto-approve, or squeeze the review band, etc.
curl -s -b $AJAR -X POST $BASE/api/admin/capture-thresholds \
  -H 'Content-Type: application/json' -d '{"auto_approve":0.90,"auto_block":0.60}'
curl -s -b $AJAR $BASE/api/admin/capture-thresholds        # read back + band descriptions
```

The capture flow is: `POST /api/checkout/verify` (returns a `capture_token`) →
`POST /api/checkout/capture` (upload the frame) → server scores fire-and-forget →
WebSocket `CAPTURE_STATE` transitions. Grab a `capture_token` first:

```bash
TOKEN=$(curl -s -b $CJAR -X POST $BASE/api/checkout/verify \
  -H 'Content-Type: application/json' -d "{\"barcode\":\"$BARCODE\"}" \
  | tee /dev/stderr | python3 -c 'import sys,json;print(json.load(sys.stdin).get("capture_token",""))')
```

---

## Scenario 1 — Legitimate match, high confidence → auto-approve

1. Put the **correct** product in frame; upload the captured frame:
   ```bash
   IMG=$(base64 -w0 samples/correct_product.jpg)
   curl -s -b $CJAR -X POST $BASE/api/checkout/capture \
     -H 'Content-Type: application/json' \
     -d "{\"capture_token\":\"$TOKEN\",\"image_b64\":\"data:image/jpeg;base64,$IMG\"}"
   ```
2. **Expect** on the WebSocket feed, in order:
   `image_uploading → image_uploaded → yolo_processing → approved`
   with `confidence > 0.90`.
3. **Confirm** the pay-gate lets it through end-to-end:
   ```bash
   redis-cli GET "capture:decision:<shop>:$BARCODE"     # band = auto_approve
   curl -s -b $CJAR -X POST $BASE/api/checkout/pay \
     -H 'Content-Type: application/json' -d "{\"items\":[{\"barcode\":\"$BARCODE\",\"qty\":1}]}"
   # → ok:true, item NOT in captureBlocked/captureReview; stock decremented; item on the return-eligible ledger
   psql "$DATABASE_URL" -c "SELECT capture_match_decision FROM transactions WHERE barcode='$BARCODE' ORDER BY scanned_at DESC LIMIT 1;"  # auto_approve
   ```

**PASS:** decision `auto_approve`, `/api/checkout/pay` runs the post-approval
actions (inventory decrement + ledger staging + low-stock check).

---

## Scenario 2 — Deliberate mismatch (wrong product) → auto-block

1. Put a **different** product in frame than the scanned SKU; upload it (same
   `POST /api/checkout/capture` as above with the mismatched image).
2. **Expect** WebSocket: `… → yolo_processing → blocked` with `confidence <= 0.60`.
3. **Confirm** the fraud-alert flow fired and the sale is refused:
   ```bash
   redis-cli GET "capture:decision:<shop>:$BARCODE"     # band = auto_block
   psql "$DATABASE_URL" -c "SELECT action FROM fraud_incidents ORDER BY incident_at DESC LIMIT 1;"  # CAPTURE_MISMATCH_BLOCKED
   # a fraud-alert email is sent + a FRAUD_EXPLANATION is broadcast
   curl -s -b $CJAR -X POST $BASE/api/checkout/pay -H 'Content-Type: application/json' \
     -d "{\"items\":[{\"barcode\":\"$BARCODE\",\"qty\":1}]}"
   # → item appears in captureBlocked; if it's the only item → HTTP 409
   ```

**PASS:** low score → `auto_block`, `fraud_incidents` row `CAPTURE_MISMATCH_BLOCKED`,
alert dispatched, pay refuses the item.

---

## Scenario 3 — Borderline image (partial occlusion / bad angle) → manager review

1. Upload a **partially occluded / poorly angled** frame of the correct product.
2. **Expect** WebSocket: `… → yolo_processing → pending_manager` with
   `0.60 < confidence <= 0.90`, **plus** a `CAPTURE_REVIEW_REQUEST` message
   carrying the captured image (data URL), score, thresholds, product context and
   a 60s deadline (this is what the manager tablet renders).
3. **Confirm** the sale is held:
   ```bash
   redis-cli GET "capture:review:<CAP-…>"   # {status:"pending", deadline_at, …}
   redis-cli GET "capture:decision:<shop>:$BARCODE"   # band = manager_review
   curl -s -b $CJAR -X POST $BASE/api/checkout/pay -H 'Content-Type: application/json' \
     -d "{\"items\":[{\"barcode\":\"$BARCODE\",\"qty\":1}]}"   # item in captureReview (held)
   ```

**PASS:** borderline confidence → `pending_manager`, tablet gets the review
request, pay holds the item.

---

## Scenario 4 — Manager approves within 60s → commit; no response → auto-block on timeout

Uses `POST /api/checkout/capture-review/:txnRef` (admin). `CAP-…` = the txn_ref
from scenario 3.

**4a. Approve within 60s:**
```bash
curl -s -b $AJAR -X POST $BASE/api/checkout/capture-review/CAP-XXXX \
  -H 'Content-Type: application/json' -d '{"action":"approve"}'
# → ok:true, outcome:"manager_approved"
```
- **Expect** WebSocket `CAPTURE_STATE approved` (`resolved_by:"manager"`); the
  pay-gate band flips to `auto_approve`; a re-attempted `/api/checkout/pay`
  now completes. `transactions.capture_match_decision = manager_approved`.

**4b. Reject:** same call with `{"action":"reject"}` → `blocked`,
`fraud_incidents.action = CAPTURE_REVIEW_REJECTED`, `decision = manager_rejected`.

**4c. Timeout (no response):** trigger a borderline capture (scenario 3) and **do
nothing** for 60s (`CAPTURE_REVIEW_TIMEOUT_S`, default 60).
- **Expect** the server-side timer fires: WebSocket `CAPTURE_STATE blocked`
  (`resolved_by:"timeout"`); pay-gate band `auto_block`.
- **Confirm the timeout is logged DISTINCTLY from a rejection** (for tuning):
  ```bash
  psql "$DATABASE_URL" -c "SELECT action FROM fraud_incidents ORDER BY incident_at DESC LIMIT 1;"  # CAPTURE_REVIEW_TIMEOUT (not …REJECTED)
  psql "$DATABASE_URL" -c "SELECT capture_match_decision FROM transactions WHERE barcode='$BARCODE' ORDER BY scanned_at DESC LIMIT 1;"  # review_timeout
  ```
- A late approve/reject after resolution returns **HTTP 409** (resolved exactly once).

**PASS:** approve commits; timeout auto-blocks and is recorded as
`review_timeout` / `CAPTURE_REVIEW_TIMEOUT`, distinct from `manager_rejected`.

---

## Scenario 5 — Local storage failure → retry-then-fallback

Force the local write to fail (the frame directory is unwritable):

```bash
# Point captures at a read-only dir and restart the gateway
export CHECKOUT_CAPTURES_DIR=/tmp/ro-captures
mkdir -p /tmp/ro-captures && chmod 500 /tmp/ro-captures
npm start
```

Upload a frame (scenario 1 command). **Expect** in the gateway logs:
```
⏳ capture write CAP-… failed (attempt 1/3): … — retrying in 1000ms
⏳ capture write CAP-… failed (attempt 2/3): … — retrying in 2000ms
💾 Capture write FAILED after 3 attempts — …
```
> Backoff schedule note: the write uses `CAPTURE_WRITE_MAX_ATTEMPTS=3` with a 1s
> base that doubles (exponential family 1s → 2s → 4s …); with 3 attempts the two
> inter-attempt waits are **1s then 2s**. Set `CAPTURE_WRITE_MAX_ATTEMPTS=4` to
> realise the full 1s → 2s → 4s.

Then the store `CAPTURE_WRITE_FAILURE_POLICY` decides:

- **`hmac_fallback` (default):** HTTP 200 `{fallback:"hmac_only", faults:N}`, the
  scan continues (HMAC-verified, image-less, logged); WebSocket shows the degraded
  state. The rolling counter increments:
  ```bash
  redis-cli GET "capture:fault:<shop>"     # 1,2,3 accepted…
  ```
  On the **4th** failure within 15 min the lane **freezes**: HTTP 423
  `{frozen:true}`, a `LANE_FROZEN` broadcast, and `fraud_incidents.action = LANE_FROZEN`.
  Restore it:
  ```bash
  curl -s -b $AJAR $BASE/api/admin/lane/status      # {frozen:true, faults:4, …}
  curl -s -b $AJAR -X POST $BASE/api/admin/lane/unfreeze   # LANE_THAWED broadcast
  ```
- **`hard_block`:** set `CAPTURE_WRITE_FAILURE_POLICY=hard_block` and restart →
  the same write failure returns HTTP 507 and the capture is blocked (no fallback).

Clean up: `chmod 700 /tmp/ro-captures` (or unset `CHECKOUT_CAPTURES_DIR`).

**PASS:** 3 attempts with 1s/2s backoff, then policy-correct behaviour
(fallback under cap → freeze over cap, or hard-block), all logged.

---

## Scenario 6 — Latency: camera fire → decision under realistic load

End-to-end latency = frame upload + local write + **YOLO capture-match (dominant)**
+ decision. Measure each layer:

1. **YOLO capture-match on the host hardware** (the dominant term) — the FastAPI
   engine ships a benchmark:
   ```bash
   curl -s "http://localhost:8000/audit/capture-match/benchmark?n=20&size=640" | python3 -m json.tool
   # → per-run + mean/median match latency in ms on THIS machine
   ```
   Run it while the box is under representative load (concurrent scans) to get a
   realistic figure. Note the scoring is **fire-and-forget**, so it never blocks
   the cashier's scan/pay path.
2. **Decision layer (Node)** — negligible: `npm run test:capture` measures
   `classify()` at well under 1µs/call (≈0.05µs in CI). The threshold-band choice
   adds no meaningful latency.
3. **Upload + local write** — the `/api/checkout/capture` response time
   (millisecond-scale local write; see the gateway timing log
   `📸 Checkout capture stored …`).

Wall-clock camera→decision: read the WebSocket `CAPTURE_STATE.status_at`
timestamps from `yolo_processing` to `approved`/`blocked` for a real end-to-end
number.

**PASS:** end-to-end dominated by YOLO inference (benchmarked via the FastAPI
endpoint); Node decision/threshold overhead is sub-millisecond and off the
critical path.

---

## Automated coverage

```bash
npm run test:capture     # scenarios 1–5 decision logic + decision latency, deterministic
```
Covers: band classification (S1/S2/S3 + boundaries + per-store), review-outcome
mapping incl. distinct timeout vs reject labels (S4), exponential-backoff schedule
and retry recover/exhaust + fallback/freeze/hard-block policy (S5), and the
`classify()` micro-benchmark (S6, Node portion).
