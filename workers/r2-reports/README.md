# Cloudflare R2 report storage

Patient report files (PDF, images, Word docs) are stored in Cloudflare R2 via a small Worker API.

## Setup

1. Create an R2 bucket named `physio-reports` in the Cloudflare dashboard (or change `bucket_name` in `wrangler.toml`).

2. Install worker dependencies and deploy:

```bash
cd workers/r2-reports
npm install
npx wrangler secret put R2_API_TOKEN
npm run deploy
```

Use a long random string for `R2_API_TOKEN`. The same value goes in the frontend env.

3. Update `workers/r2-reports/wrangler.toml`:

- Set `ALLOWED_ORIGINS` to your app URL(s), e.g. `https://your-app.vercel.app,http://localhost:5173`

4. Add to `.env.local`:

```env
VITE_R2_API_URL=https://physio-r2-reports.<your-subdomain>.workers.dev
VITE_R2_API_TOKEN=<same token as worker secret>
```

5. Restart the Vite dev server.

## GitHub Pages production

Vite reads `VITE_*` variables **at build time only**. Local `.env.local` is not used by CI.

1. In GitHub → **Settings → Secrets and variables → Actions**, add:
   - `VITE_R2_API_URL` — your deployed worker URL (e.g. `https://physio-r2-reports.<account>.workers.dev`)
   - `VITE_R2_API_TOKEN` — must match the worker secret from `wrangler secret put R2_API_TOKEN`

2. Ensure `.github/workflows/deploy.yml` passes those secrets into the `npm run build` step (already wired in this repo).

3. Redeploy: push to `main` or run the **Deploy to GitHub Pages** workflow manually.

4. Update worker `ALLOWED_ORIGINS` to your Pages **origin** (host only):
   - Project site `https://user.github.io/repo/` → use `https://user.github.io`
   - Custom domain → use `https://your-domain.com`
   - Then redeploy the worker: `cd workers/r2-reports && npm run deploy`

## Local development

Run the worker locally in one terminal:

```bash
cd workers/r2-reports
npm run dev
```

Set `VITE_R2_API_URL=http://localhost:8787` in `.env.local`.

## API

- `POST /upload` — multipart form: `patientId`, `reportId`, `file`
- `GET /download?key=...` — streams the stored file
- `DELETE /patient-reports?patientId=...` — deletes all report files for a patient

Both endpoints require `Authorization: Bearer <R2_API_TOKEN>`.

Accepted file types: PDF, JPEG, PNG, WebP, DOC, DOCX (max 10 MB).
