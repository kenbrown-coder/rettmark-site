# Agent / contributor: discount code changes

Same intent as `.cursor/rules/discount-codes-workflow.mdc` (for Cursor).

- **`data/discount-codes.local.txt`** must stay an **exact copy** of the private GitHub rules file (plain text file; body is valid JSON). When changing promos, edit the local file, then the owner pastes **the whole file** into the private **`.json`** file and pushes.
- Update **`data/discount-codes.example.json`** to match **`discount-codes.local.txt`** whenever rules change, so the committed example stays accurate (unless placeholders are intentional).
- Do **not** add site-wide discount logic in checkout JS or new Netlify behavior unless the product owner explicitly asks for engineering work (e.g. new rule types).
- **Hunters HD Gold** never receives merchandise discounts from rules (server excludes those lines); **$299.99** catalog pricing for HHDG is preserved for merchandise math.

After adding **new JSON fields** or server logic for new rule types, **redeploy** Netlify so updated function code is live; GitHub-only edits are enough when only rule **values** change and the schema is already supported.
