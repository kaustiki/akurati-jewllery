# Akurati costing and guide

A small static website for Akurati Fine Jewellery, served by GitHub Pages.

- **Costs and prices**: what each design costs to make and what to sell it for, worked out from the day's gold
  rate. The numbers are encrypted (`data/costs.enc.json`, AES-256-GCM, key from a password with PBKDF2) and only
  open in the browser with the password.
- **Gold and diamond guide**: Picture guide 1, "Gold and diamond words", page for page as in the PDF.

No build step: `index.html`, `assets/`, `img/` and `data/` are the site. To look at it locally:
`python3 -m http.server` in this folder, then open http://localhost:8000 (opening the file directly can't load the data).

The cost data and the scripts that update this site live in a separate private repo; nothing in this repo holds
cost prices in plain text.
