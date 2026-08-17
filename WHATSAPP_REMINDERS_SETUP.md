# WhatsApp Session Reminders — Full Setup Guide

End-to-end setup for the WhatsApp appointment-reminder feature. Follow the parts in
order — each part produces values you paste into a later part.

Reminders are sent to patients ~1-2 hours (configurable) before their scheduled **clinic**
sessions, using the **Meta WhatsApp Cloud API**, driven by a scheduled **Cloudflare Worker**.
Session times are treated as **Asia/Kolkata (IST)**. Home-visit sessions are skipped.

---

## Part A — Before you start, gather these

You'll collect 4 secrets and confirm 2 template names along the way. Keep a scratch note:

| Value | Where it comes from |
|---|---|
| `SUPABASE_URL` | Part D |
| `SUPABASE_SERVICE_KEY` | Part D |
| `WHATSAPP_PHONE_NUMBER_ID` | Part B |
| `WHATSAPP_TOKEN` | Part B (temporary) / Part H (permanent) |
| `TRIGGER_TOKEN` | you invent a random string |

Requirements:

- A Facebook account.
- A phone number for WhatsApp sending that is **not currently active on the WhatsApp app**
  (you can use Meta's free test number to start).
- Node.js + npm installed locally.
- Your Supabase project (already used by the portal).

---

## Part B — Meta / Facebook + WhatsApp Cloud API

### B1. Create a Meta Business Portfolio

1. Go to [business.facebook.com](https://business.facebook.com) and sign in.
2. **Settings (gear) → Business portfolios → Create** if you don't already have one. Fill in
   business name, your name, email.

### B2. Create a Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**.
2. Use case: choose **Other** → **Next**.
3. App type: **Business** → **Next**.
4. Name the app (e.g. "PhysioCare Reminders"), pick your Business portfolio → **Create app**.

### B3. Add the WhatsApp product

1. In the app dashboard, find **WhatsApp** → click **Set up**.
2. It will create/link a **WhatsApp Business Account (WABA)**. Select your Business portfolio
   if asked.

### B4. Get your Phone Number ID and test number

1. Left menu → **WhatsApp → API Setup**.
2. You'll see a **"From" number** section with a free **test number** provided by Meta. Under
   it is the **Phone number ID** — copy it → this is `WHATSAPP_PHONE_NUMBER_ID`.
3. Also note the **WhatsApp Business Account ID** shown on this page (needed later for
   templates / permanent token).

### B5. Add a test recipient (required while in development)

While your app is in Development mode, WhatsApp only delivers to pre-approved numbers.

1. On the same **API Setup** page, find **"To"** → **Manage phone number list** → add your own
   mobile number and verify it via the code WhatsApp sends you.

### B6. Get a temporary access token (for first tests)

1. On **API Setup**, copy the **Temporary access token** (valid ~24 hours) → use this as
   `WHATSAPP_TOKEN` for now.
2. We'll replace it with a permanent one in Part H before going live.

> At this point you can already use the "Send test message" button on the API Setup page to
> confirm your number receives WhatsApp messages.

---

## Part C — Create and get the two message templates approved

Reminders are sent outside the 24-hour window, so WhatsApp requires **pre-approved
templates**. The Worker sends body parameters positionally, so the order matters exactly.

1. Go to [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates)
   (WhatsApp Manager → **Manage templates**). Pick your WABA.
2. Click **Create template**.

### Template 1 — with location

- **Category:** Utility
- **Name:** `appointment_reminder_location`  (must match `TEMPLATE_WITH_LOCATION`)
- **Language:** English → must match `TEMPLATE_LANG` (`en`)
- **Body:**

```
Hi {{1}}, this is a reminder for your physiotherapy session at {{2}} on {{3}} at {{4}}. Location: {{5}}. Please reply if you need to reschedule.
```

- Provide **sample values** when prompted (e.g. `Olivia`, `Central Physio Studio`,
  `11 Jul 2026`, `5:30 PM`, `45 Wellness Street`).
- Parameter order: `{{1}}` patient name, `{{2}}` clinic name, `{{3}}` date, `{{4}}` time,
  `{{5}}` address.
- **Submit.**

### Template 2 — without location

- **Category:** Utility
- **Name:** `appointment_reminder`  (must match `TEMPLATE_NO_LOCATION`)
- **Language:** English (`en`)
- **Body:**

```
Hi {{1}}, this is a reminder for your physiotherapy session at {{2}} on {{3}} at {{4}}. Please reply if you need to reschedule.
```

- Parameter order: `{{1}}` name, `{{2}}` clinic, `{{3}}` date, `{{4}}` time.
- **Submit.**

3. Wait for status to become **Approved** (usually minutes to a few hours). Both templates are
   used depending on the "include location" setting and whether a clinic has an address.

> If you prefer different names/wording, that's fine — just update `TEMPLATE_WITH_LOCATION`,
> `TEMPLATE_NO_LOCATION`, and `TEMPLATE_LANG` in `wrangler.toml` to match.

---

## Part D — Supabase (tables + credentials)

### D1. Create the tables

1. Open your Supabase project → **SQL Editor → New query**.
2. Paste the entire contents of `supabase_migration.sql` (repo root) and **Run**. It's
   idempotent and adds `reminder_settings` and `session_reminders` (plus a seeded, disabled
   global settings row).

### D2. Get the URL and service-role key

1. **Project Settings → API**.
2. Copy **Project URL** → `SUPABASE_URL` (e.g. `https://abcd1234.supabase.co`).
3. Copy the **service_role** secret key → `SUPABASE_SERVICE_KEY`.

> The service-role key bypasses RLS and must stay server-side only. It is used solely as a
> Cloudflare Worker secret — never put it in the frontend.

---

## Part E — Deploy the Cloudflare Worker

### E1. Install and log in to Wrangler

```bash
cd workers/whatsapp-reminders
npm install
npx wrangler login
```

`wrangler login` opens a browser to authorize your Cloudflare account (create a free one at
[dash.cloudflare.com](https://dash.cloudflare.com) if needed).

### E2. Set the secrets

Run each command and paste the value when prompted:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put TRIGGER_TOKEN
```

For `TRIGGER_TOKEN`, invent a long random string (e.g. run `openssl rand -hex 24` and paste
the output). You'll use it to trigger test runs.

### E3. Confirm the non-secret config

Open `workers/whatsapp-reminders/wrangler.toml` and verify:

- `crons = ["*/15 * * * *"]`
- `DEFAULT_COUNTRY_CODE = "91"` (change if not India)
- `TEMPLATE_WITH_LOCATION` / `TEMPLATE_NO_LOCATION` / `TEMPLATE_LANG` match your approved
  templates.

### E4. Deploy

```bash
npm run deploy
```

Wrangler prints your Worker URL, e.g.
`https://physio-whatsapp-reminders.<your-subdomain>.workers.dev`. The cron trigger is
registered automatically — confirm it in the Cloudflare dashboard under **Workers & Pages →
your worker → Triggers → Cron Triggers**.

---

## Part F — Turn reminders on in the portal

1. Log in to the portal as an **admin**.
2. Open the **Reminders** page (left sidebar).
3. In **Global defaults**: set **Reminders = On**, **lead hours = 1 or 2**, and choose
   **Include clinic location = Yes**. Click **Save**.
4. (Optional) Under **Per-clinic overrides**, click **Override** on any clinic to give it a
   different schedule; otherwise it follows the global default.
5. Make sure each clinic has an **Address** filled in (Clinics page) if you want the location
   line to appear.
6. Make sure patients have a valid **phone number**. Numbers can be 10-digit local (the Worker
   prepends `91`) or full international.

---

## Part G — Test end to end

You have two ways to verify without waiting for the 15-minute cron.

**Option 1 — manual trigger endpoint:**

```bash
curl -X POST https://physio-whatsapp-reminders.<your-subdomain>.workers.dev/run \
  -H "Authorization: Bearer <TRIGGER_TOKEN>"
```

The JSON response reports `scanned`, `sent`, `failed`, `skipped`.

**Set up a realistic test:**

1. In the portal, schedule a **clinic** session for your **test recipient** patient (the number
   you verified in B5), timed so that "now" is inside the lead window — e.g. if lead = 2 hours,
   schedule it ~90 minutes from now.
2. Hit the `/run` endpoint. You should receive the WhatsApp message.
3. Check Supabase → `session_reminders` table for a row with `status = sent` (or
   `failed`/`skipped` with an error message you can act on).

**Live logs while testing:**

```bash
npx wrangler tail
```

Notes:

- A reminder is sent only **once** per session (deduped via `session_reminders`).
- Home-visit sessions are intentionally skipped.
- Times are interpreted as **IST**.

---

## Part H — Go live (production)

While in Development mode you can only message verified test numbers and use a 24h token. To
message real patients:

### H1. Generate a permanent access token (System User)

1. [business.facebook.com](https://business.facebook.com) → **Settings → Users → System users
   → Add**. Create one (role: Admin or Employee).
2. **Add assets** → assign your **App** and your **WhatsApp Business Account** to this system
   user (with full control).
3. Click **Generate new token** → select your app → choose permissions
   **`whatsapp_business_messaging`** and **`whatsapp_business_management`** → set expiration to
   **Never** → **Generate**.
4. Copy the token and update the Worker secret:

```bash
cd workers/whatsapp-reminders
npx wrangler secret put WHATSAPP_TOKEN
npm run deploy
```

### H2. Business verification + publish the app

1. In the App dashboard, complete **Business Verification** (Meta reviews your business
   documents).
2. Add a **real/production phone number** to the WABA (WhatsApp Manager → Phone numbers) if you
   don't want to use the test number, and update `WHATSAPP_PHONE_NUMBER_ID` accordingly, then
   redeploy.
3. Switch the app from **Development** to **Live** (toggle at the top of the App dashboard).

Once verified and live, the Worker sends to any patient number — no per-recipient
allow-listing.

---

## Quick troubleshooting

- **401 from `/run`** → `TRIGGER_TOKEN` mismatch; re-set the secret and redeploy.
- **`failed` rows in `session_reminders` with "template not found"** → template name/language
  doesn't match `wrangler.toml`, or it's not **Approved** yet.
- **Nothing sent, `scanned` is 0** → the session isn't inside its lead window yet, it's not a
  `clinic` session, its status isn't `scheduled`, or reminders are disabled in the portal.
- **`skipped` with "invalid phone"** → patient phone is empty/malformed; fix it or check
  `DEFAULT_COUNTRY_CODE`.
- **Delivered to you but not to real patients** → app still in Development mode or business not
  verified (Part H).
- **Message fees** → Cloudflare hosting is free; WhatsApp charges per Utility conversation
  (varies by country).

---

## Reference — configuration values

Set in `workers/whatsapp-reminders/wrangler.toml` (non-secret):

| Var | Default | Meaning |
|---|---|---|
| `META_API_VERSION` | `v21.0` | Meta Graph API version |
| `TEMPLATE_LANG` | `en` | Language code of your approved templates |
| `DEFAULT_COUNTRY_CODE` | `91` | Prepended to local (10-digit) patient numbers |
| `TEMPLATE_WITH_LOCATION` | `appointment_reminder_location` | Template used when location is included |
| `TEMPLATE_NO_LOCATION` | `appointment_reminder` | Template used without location |

Set via `wrangler secret put` (secret):

| Secret | Meaning |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key (server-side only) |
| `WHATSAPP_TOKEN` | Meta access token (temporary, then permanent) |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp phone number ID |
| `TRIGGER_TOKEN` | Bearer token for the manual `/run` test endpoint |

Behavior configured in the portal (**Reminders** page), stored in `reminder_settings`:

- **enabled** — whether reminders are sent
- **lead hours** — how many hours before the session to send (1-2 recommended)
- **include location** — whether to include the clinic address (uses the with-location template)

A single global row applies to all clinics; per-clinic rows override it.
