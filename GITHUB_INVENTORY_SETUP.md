# GitHub Inventory Sync Setup

This sets up GitHub to keep `inventory.csv` updated from a spreadsheet export URL.

## 1) Push this project to GitHub

If this folder is not a git repo yet:

```powershell
git init
git add .
git commit -m "initial site"
```

Create a GitHub repo, then:

```powershell
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## 2) Publish your spreadsheet as CSV

Use a CSV export URL that returns headers:

`sku,qty,description`

Google Sheets example:

- File -> Share -> Publish to web
- Pick the inventory tab
- Format: CSV
- Copy that URL

## 3) Add the URL as a GitHub Secret

In your GitHub repo:

- Settings -> Secrets and variables -> Actions -> New repository secret
- Name: `INVENTORY_CSV_URL`
- Value: your published CSV URL

## 4) Run the workflow

Workflow file is:

- `.github/workflows/inventory-sync.yml`

It runs:

- manually (`workflow_dispatch`)
- hourly (`15 * * * *`)

If `inventory.csv` changes, it commits and pushes automatically.

## 5) Confirm deploy behavior

If your site host (Netlify) is connected to this GitHub repo, each commit triggers a deploy and your inventory updates live.

## CSV rules

- Must include `sku` and `qty`.
- `qty` must be an integer `>= 0`.
- `description` is optional and ignored by runtime logic (for human readability only).

