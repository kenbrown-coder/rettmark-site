/**
 * Cloudflare Turnstile site key (public). Default empty for local clones.
 * Production: Netlify runs scripts/inject-turnstile-config.cjs and sets this from
 * the TURNSTILE_SITE_KEY environment variable (Netlify: Site configuration, Environment variables).
 */
window.RETTMARK_TURNSTILE_SITE_KEY = "";
