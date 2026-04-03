# Google Search Console

Use [Google Search Console](https://search.google.com/search-console) to see how Google indexes the site and to submit your sitemap.

## Recommended setup (Domain + DNS — skip optionals)

If you verified with a **Domain** property and a **DNS TXT** record at Squarespace (or similar):

| Step | Action |
|------|--------|
| Done | Domain verification |
| **Do once in GSC** | [Submit sitemap](#3-submit-sitemap-do-this-in-search-console) (`sitemap.xml`) |
| Skip | Second property for `www` only — not needed for a Domain property |
| Skip | **`GOOGLE_SITE_VERIFICATION`** in Netlify — only for HTML-tag + URL-prefix verification |

## 1. Add a property

1. Open [Search Console](https://search.google.com/search-console) and sign in with a Google account you want as owner.
2. Click **Add property**.
3. Choose one:
   - **Domain** — `rettmarkfirearms.com` (covers `www` and non-`www`). Verification is via a **DNS TXT** record at your DNS host. No change to this repo.
   - **URL prefix** — e.g. `https://rettmarkfirearms.com/` (exact URL). You can verify with the **HTML tag** method below.

If you use **both** `https://rettmarkfirearms.com` and `https://www.rettmarkfirearms.com`, add **both** URL-prefix properties (or use **Domain** once).

## 2. Verify with HTML tag (URL prefix)

**Skip this section** if you already verified with **Domain** + **DNS** (recommended path above).

1. In Search Console, choose **HTML tag** verification.
2. Copy **only** the `content` value from the meta tag Google shows (the long string inside `content="..."`).
3. In **Netlify** → Site → **Environment variables**, add:
   - **Key:** `GOOGLE_SITE_VERIFICATION`
   - **Value:** paste that string only (no quotes).
   - **Scopes:** **Builds** (or **All**) — it must be available when `npm run build` runs.
4. **Trigger a new deploy** (clear cache optional).
5. Open your live homepage, **View page source**, and confirm you see  
   `<meta name="google-site-verification" content="…" />` in `<head>`.
6. In Search Console, click **Verify**.

The build script `scripts/inject-google-site-verification.cjs` inserts that tag into `index.html` during the Netlify build. The token is **not** a password, but keeping it in Netlify avoids committing it to git.

## 3. Submit sitemap (do this in Search Console)

After verification, **you still add the sitemap in the Search Console UI** (nothing in git submits it for you).

1. Open [Google Search Console](https://search.google.com/search-console) and select your **property** (`rettmarkfirearms.com` if you used Domain).
2. In the left menu, open **Sitemaps** (under **Indexing**; on small screens use the ☰ menu).
3. Under **Add a new sitemap**, enter the **full URL** (Domain properties often reject `sitemap.xml` alone):
   - **`https://rettmarkfirearms.com/sitemap.xml`**
4. Click **Submit**.
5. The table below may show **Success**, **Pending**, or **Couldn’t fetch** at first. **Pending** is normal for a few hours. If it stays failed after 24–48 hours, confirm the live file loads:  
   **https://rettmarkfirearms.com/sitemap.xml**

**Already in the repo (no extra step for discovery):**

- `robots.txt` includes `Sitemap: https://rettmarkfirearms.com/sitemap.xml`.
- `sitemap.xml` is generated on each Netlify build (`scripts/generate-sitemap.cjs`).

## 3b. After DNS verification: other choices

| Topic | Recommended? | Notes |
|--------|----------------|--------|
| **Submit sitemap** (above) | **Yes — do this** | Tells Google your URL list explicitly; low effort, standard practice. |
| **Separate `www` URL-prefix property** | **Optional** | With a **Domain** property you already own the whole domain; a second property for `https://www.…` is only if you want split reports or used URL-prefix verification for `www` only. Not required for indexing both. |
| **`GOOGLE_SITE_VERIFICATION` in Netlify** | **Optional / skip** | Only for **HTML tag** verification on **URL prefix**. If you verified with **DNS** on a **Domain** property, you **do not** need this env var; leaving it unset is fine. |

## 4. Optional checks

- **Page experience / Core Web Vitals** — reported over time in Search Console.
- **Coverage** — see indexed vs excluded URLs.

## Alternate name for the env var

You can use **`GOOGLE_SEARCH_CONSOLE_VERIFICATION`** instead of `GOOGLE_SITE_VERIFICATION` if you prefer; the inject script accepts either.
