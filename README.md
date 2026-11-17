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
# edit tools/costs.json: give the design a "quote" (copy Veena's), then:
python3 tools/publish.py            # locks it again into data/costs.enc.json
git add -A && git commit -m "Quote for <design>" && git push
```

## Recording a purchase (booking the gold)

Until a design's gold is booked, its cost uses today's gold rate from the box at the top. When you book the gold
with the maker, tap **Book gold** next to its name (or **Change** on its 14K gold line), confirm, and type the day, the 24K rate that day (it
fills the 14K rate at the maker's 59.5%) or the 14K rate on the bill, and the gold weight. **Save**. The cost then
follows that booking; the selling price still follows today's rate, and the profit is the selling price minus what
was paid. **Change** edits it later (say, when the final bill's weight comes); **Not booked yet** undoes it.

A booking typed on the page stays on that device only. To put it in the locked data for every device, add
`"bought"` to that design's `quote` the same way as a quote, then lock and push:

```
"bought": {"date": "2026-11-20", "rate14": 8150, "g": 5.8, "ct": [0.78, 1.5]}
```

`rate14` is the 14K price per gram on the bill. `g` (gold weight) and `ct` (carats, in the order of `stones`) are
only needed when the bill's weights differ from the quote. A booking typed on a device wins over this one there.

`tools/costs.json` and `tools/password.txt` are git-ignored: nothing in this repo holds cost prices in plain text,
and the password is the only key. Keep it somewhere safe; without it the cost data can't be opened.
