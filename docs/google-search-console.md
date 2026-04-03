# Google Search Console

Use [Google Search Console](https://search.google.com/search-console) to see how Google indexes the site and to submit your sitemap.

## 1. Add a property

1. Open [Search Console](https://search.google.com/search-console) and sign in with a Google account you want as owner.
2. Click **Add property**.
3. Choose one:
   - **Domain** — `rettmarkfirearms.com` (covers `www` and non-`www`). Verification is via a **DNS TXT** record at your DNS host. No change to this repo.
   - **URL prefix** — e.g. `https://rettmarkfirearms.com/` (exact URL). You can verify with the **HTML tag** method below.

If you use **both** `https://rettmarkfirearms.com` and `https://www.rettmarkfirearms.com`, add **both** URL-prefix properties (or use **Domain** once).

## 2. Verify with HTML tag (URL prefix)

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

## 3. Submit sitemap

After the property is verified:

1. In Search Console, open your property → **Sitemaps** (under **Indexing**).
2. Enter: `sitemap.xml` (or full URL `https://rettmarkfirearms.com/sitemap.xml`).
3. Submit. Status may show “Success” or “Couldn’t fetch” until Google has crawled it; check again later.

Your `robots.txt` already includes `Sitemap: https://rettmarkfirearms.com/sitemap.xml`, which helps discovery.

## 4. Optional checks

- **Page experience / Core Web Vitals** — reported over time in Search Console.
- **Coverage** — see indexed vs excluded URLs.

## Alternate name for the env var

You can use **`GOOGLE_SEARCH_CONSOLE_VERIFICATION`** instead of `GOOGLE_SITE_VERIFICATION` if you prefer; the inject script accepts either.
