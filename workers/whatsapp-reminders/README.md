# WhatsApp session reminders

A scheduled Cloudflare Worker that sends patients a WhatsApp reminder before their
clinic physiotherapy sessions, using the **Meta WhatsApp Cloud API**.

## How it works

- A cron trigger runs every 15 minutes (`*/15 * * * *`).
- Each run reads `reminder_settings` and the upcoming **clinic** sessions from Supabase.
- For every scheduled clinic session that has just entered its clinic's *lead hours before*
  window, it sends a WhatsApp template message and records it in `session_reminders` so it
  is only ever sent once.
- Home-visit sessions are skipped. Session times are treated as **Asia/Kolkata (IST)**.
- Behavior (enabled, lead hours, include location) is configured in the portal under
  **Reminders**, with global defaults plus optional per-clinic overrides. No API
  credentials are stored in the database — those live only as Worker secrets.

## 1. Create the database tables

Run `supabase_migration.sql` (in the repo root) in the Supabase SQL editor. It creates
`reminder_settings` and `session_reminders` and seeds a disabled global settings row.

## 2. Set up Meta WhatsApp Cloud API

1. In [Meta for Developers](https://developers.facebook.com/), create an app of type
   **Business** and add the **WhatsApp** product.
2. Note your **Phone number ID** (WhatsApp → API Setup) — this is `WHATSAPP_PHONE_NUMBER_ID`.
3. Generate a **permanent access token** (via a System User in Meta Business Settings with
   the `whatsapp_business_messaging` permission) — this is `WHATSAPP_TOKEN`.
4. Create and submit **two** message templates (category: **Utility**) and wait for approval.
   The Worker sends body parameters positionally in this exact order:

   **`appointment_reminder_location`** (used when "include location" is on):

   ```
   Hi {{1}}, this is a reminder for your physiotherapy session at {{2}} on {{3}} at {{4}}.
   Location: {{5}}. Please reply if you need to reschedule.
   ```

   Parameters: `{{1}}` patient name, `{{2}}` clinic name, `{{3}}` date, `{{4}}` time, `{{5}}` address.

   **`appointment_reminder`** (used when location is off or the clinic has no address):

   ```
   Hi {{1}}, this is a reminder for your physiotherapy session at {{2}} on {{3}} at {{4}}.
   Please reply if you need to reschedule.
   ```

   Parameters: `{{1}}` patient name, `{{2}}` clinic name, `{{3}}` date, `{{4}}` time.

   If you use different template names or language, update `TEMPLATE_WITH_LOCATION`,
   `TEMPLATE_NO_LOCATION`, and `TEMPLATE_LANG` in `wrangler.toml`.

## 3. Configure and deploy the Worker

```bash
cd workers/whatsapp-reminders
npm install
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put TRIGGER_TOKEN   # any long random string, for the manual /run test
npm run deploy
```

- `SUPABASE_URL` — e.g. `https://xxxx.supabase.co`
- `SUPABASE_SERVICE_KEY` — the Supabase **service-role** key (Project Settings → API). Keep it secret.

Non-secret defaults (`META_API_VERSION`, `TEMPLATE_LANG`, `DEFAULT_COUNTRY_CODE`,
`TEMPLATE_WITH_LOCATION`, `TEMPLATE_NO_LOCATION`) live in `wrangler.toml`.

## 4. Turn reminders on

In the portal, open **Reminders** (admin only), enable them, set the lead time (1–2 hours
recommended), and choose whether to include the clinic location. Add per-clinic overrides
as needed.

## Testing

Trigger a run on demand without waiting for the cron:

```bash
curl -X POST https://physio-whatsapp-reminders.<your-subdomain>.workers.dev/run \
  -H "Authorization: Bearer <TRIGGER_TOKEN>"
```

The response reports how many sessions were scanned, sent, failed, and skipped. Each
attempt is logged in `session_reminders` (including failures with the error message).

## Notes

- WhatsApp requires **pre-approved templates** to message users outside the 24-hour
  customer-service window, which is why reminders use templates rather than free-form text.
- Patient phone numbers are free text in the app. Numbers are normalized to E.164 digits
  using `DEFAULT_COUNTRY_CODE` (default `91`); 10-digit local numbers get the country code
  prepended. Unparseable numbers are skipped and logged rather than failing the run.
