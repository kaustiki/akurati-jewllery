# Akurati costing and guide

A small static website for Akurati Fine Jewellery, served by GitHub Pages.

- **Costs and prices**: what each design costs to make and what to sell it for, worked out from the day's gold
  rate. The numbers are encrypted (`data/costs.enc.json`, AES-256-GCM, key from a password with PBKDF2) and only
  open in the browser with the password.
- **Gold and diamond guide**: Picture guide 1, "Gold and diamond words", page for page as in the PDF.

No build step: `index.html`, `assets/`, `img/` and `data/` are the site. To look at it locally:
`python3 -m http.server` in this folder, then open http://localhost:8000 (opening the file directly can't load the data).

## Adding a quote

```
python3 tools/publish.py --open     # asks for the password, unlocks the data into tools/costs.json
# edit tools/costs.json (a design's status, its quote lines), then:
python3 tools/publish.py            # locks it again into data/costs.enc.json
git add -A && git commit -m "Quote for <design>" && git push
```

`tools/costs.json` and `tools/password.txt` are git-ignored: nothing in this repo holds cost prices in plain text,
and the password is the only key. Keep it somewhere safe; without it the cost data can't be opened.
