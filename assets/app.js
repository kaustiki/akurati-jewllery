// Akurati costing site.
// Tab 1 shows nothing until the password decrypts data/costs.enc.json (made by tools/publish.py:
// PBKDF2-SHA256 -> AES-256-GCM). Tab 2 is static HTML in index.html. Tab 3 (Inputs: the maker's quotes and
// rate sheets) comes from the same locked file, so the one password opens both.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => Math.round(x * 100) + '%';
const rateTxt = x => +(x * 100).toFixed(2) + '%';   // a tax rate keeps its decimals: 1.5%, not 2%
const store = {   // per-device conveniences only; the page works without them
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- tabs
const LOCK_TEXT = {   // the password form moves into whichever private tab is open
  costs: ['Cost prices are private', 'Enter the password to see what each design costs to make and what to sell it for.'],
  inputs: ["The maker's inputs are private", "Enter the password to see the maker's quotes and rate sheets."],
};

function showTab() {
  const tab = ['guide', 'inputs'].find(t => location.hash === '#' + t) || 'costs';
  $$('[data-tab]').forEach(a => a.setAttribute('aria-selected', a.dataset.tab === tab));
  $$('.tab-panel').forEach(p => { p.hidden = p.id !== tab; });
  if (LOCK_TEXT[tab]) {
    const lock = $('#lock');
    $('#' + tab).prepend(lock);
    [$('h1', lock).textContent, $('p', lock).textContent] = LOCK_TEXT[tab];
  }
}
addEventListener('hashchange', () => { showTab(); scrollTo(0, 0); });
showTab();

// ---------------------------------------------------------------- picture zoom (CAD drawings, the maker's sheets)
document.addEventListener('click', e => {
  const img = e.target.closest('.cad-img, .input-img');
  if (!img) return;
  $('#zoom img').src = img.src;
  $('#zoom').showModal();
});
$('#zoom').addEventListener('click', e => e.currentTarget.close());

// ---------------------------------------------------------------- unlock
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function decrypt(file, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(file.salt), iterations: file.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(file.iv) }, key, b64(file.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function unlock(password, remember) {
  const msg = $('#lock-msg');
  msg.textContent = 'Unlocking…';
  let file;
  try {
    file = await (await fetch('data/costs.enc.json', { cache: 'no-cache' })).json();
  } catch {
    msg.textContent = 'Could not load the data. Open the site through its web address, not as a file.';
    return;
  }
  try {
    S.data = await decrypt(file, password);
  } catch {
    msg.textContent = 'That password is not right.';
    store.del('akurati-pw');
    return;
  }
  if (remember) store.set('akurati-pw', password);
  msg.textContent = '';
  $('#lock').hidden = true;
  $('#app').hidden = false;
  $('#inputs-app').hidden = false;
  start();
  renderInputs();
}

$('#lock').addEventListener('submit', e => {
  e.preventDefault();
  unlock($('#pw').value, $('#remember').checked);
});
const saved = store.get('akurati-pw');
if (saved) unlock(saved, true);

// ---------------------------------------------------------------- state and maths
const S = { data: null, rate24: 0, markup: 1.5, set: null, cad: {}, cadEdit: null, bought: {}, buyEdit: null };

const rate14 = () => S.rate24 / 0.999 * S.data.gold.maker_purity;   // 14K per gram, as the maker bills it
const sum = lines => lines.reduce((a, l) => a + l[2], 0);
const whole = lines => lines.map(([what, how, amt, key]) => [what, how, Math.round(amt), key]);   // whole rupees, so a bill adds up
const design = code => S.data.designs.find(d => d.code === code);
const cadOf = d => S.cad[d.code] ?? d.quote.cad_charge;   // this device's CAD charge for a design, else the maker's
const boughtOf = d => S.bought[d.code] ?? d.quote.bought ?? null;   // this device's booking, else the locked bill's
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayTxt = iso => new Date(iso + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Two gold rates. Until a piece is bought, its gold is costed at today's rate (the box at the top). Once bought,
// the booking (typed on the page, or quote.bought in the locked data) holds date, rate14 (14K ₹ per gram as
// billed), and g / ct when the bill's weights differ from the quote. The cost then uses that booking; the selling
// price still follows today's rate (today = true: the same piece at today's rate).
// Not GST-registered: the maker's GST can't be claimed back, so it is part of the cost, and the price carries no GST.
// Registered: the maker's GST comes back as input credit, so cost is before GST and GST is added to the price.
function costOf(d, today = false) {
  const q = d.quote, b = boughtOf(d) || {}, booked = !today && !!b.rate14, cad = cadOf(d);
  const g = b.g ?? q.gold.g, r = booked ? b.rate14 : rate14(), { gst, hallmark, registered } = S.set;
  const bill = whole([
    ['14K gold', `${g} g × ${inr(r)} per gram, ${booked ? `booked ${dayTxt(b.date)}` : "today's rate"}`, g * r, 'gold'],
    ...q.stones.map((s, i) => {
      const ct = b.ct?.[i] ?? s.ct;
      return [s.what, `${s.count} stones · ${ct} ct × ${inr(s.rate)} per carat`, ct * s.rate];
    }),
    ['Labour', `${g} g × ${inr(q.labour_per_g)} per gram`, g * q.labour_per_g],
    ['CAD design', cad === q.cad_charge ? 'one time' : `one time · maker's quote ${inr(q.cad_charge)}`, cad, 'cad'],
    ['IGI certificate', '', q.igi],
  ]);
  const lines = whole([
    ...bill,
    ...(registered ? [] : [["Maker's GST", `${rateTxt(gst)} of the maker's bill, ${inr(sum(bill))}`, sum(bill) * gst]]),
    ['BIS hallmark + HUID', `${q.pieces} × ${inr(hallmark)}`, q.pieces * hallmark],
  ]);
  return { lines, total: sum(lines) };
}

// The price is marked up from the cost at today's rate; profit is what is left after what was (or will be) paid.
function priceOf(todayCost, paidCost = todayCost) {
  const gst = S.set.registered ? S.set.gst : 0;
  const tag = Math.round(todayCost * S.markup * (1 + gst) / 100) * 100;   // price tag, rounded to ₹100
  const profit = tag / (1 + gst) - paidCost;
  return { tag, profit, share: profit / (tag / (1 + gst)) };
}

// ---------------------------------------------------------------- CAD charge per design
// The maker's one-time fee for a design's CAD. It can be changed on a device (to 0 for a repeat order, once the CAD
// is paid), behind Change + a confirm like the tax settings; the maker's amount stays one tap away.
function loadCad() {
  try { S.cad = JSON.parse(store.get('akurati-cad') || '{}') || {}; } catch { S.cad = {}; }
}

function cadHow(d, how) {
  if (S.cadEdit === d.code) return `
    <form class="cad-form" data-code="${esc(d.code)}" autocomplete="off">
      <input type="text" inputmode="numeric" value="${cadOf(d)}" aria-label="CAD charge for ${esc(d.name)}, ₹">
      <button type="submit">Save</button>
      <button type="button" class="ghost cad-cancel">Cancel</button>
      <button type="button" class="ghost cad-reset">Maker's ${inr(d.quote.cad_charge)}</button>
      <p class="lock-msg cad-msg" role="alert"></p>
    </form>`;
  const own = S.cad[d.code] !== undefined;
  return `<div class="how">${esc(how)}${own ? ' <span class="badge changed">changed on this device</span>' : ''}
    · <button type="button" class="link cad-edit" data-code="${esc(d.code)}">Change</button></div>`;
}

function initCad() {
  $('#app').addEventListener('click', e => {
    const t = e.target;
    if (t.matches('.cad-edit')) {
      const d = design(t.dataset.code);
      if (!confirm(`Change the CAD charge for ${d.name}?\nOnly this device changes. Set it to 0 for a repeat order, once the CAD is paid.`)) return;
      S.cadEdit = d.code;
      render();
      $('.cad-form input').focus();
    } else if (t.matches('.cad-cancel')) {
      S.cadEdit = null;
      render();
    } else if (t.matches('.cad-reset')) {
      const f = t.closest('.cad-form');
      f.querySelector('input').value = design(f.dataset.code).quote.cad_charge;   // still needs Save
    }
  });
  $('#app').addEventListener('submit', e => {
    if (!e.target.matches('.cad-form')) return;
    e.preventDefault();
    const f = e.target, d = design(f.dataset.code), raw = f.querySelector('input').value.replace(/[₹,\s]/g, '');
    const v = raw === '' ? NaN : Number(raw);
    if (!(v >= 0 && v <= 50000)) { f.querySelector('.cad-msg').textContent = 'Type the CAD charge in rupees, 0 to 50,000.'; return; }
    if (v === d.quote.cad_charge) delete S.cad[d.code];
    else S.cad[d.code] = v;
    if (Object.keys(S.cad).length) store.set('akurati-cad', JSON.stringify(S.cad));
    else store.del('akurati-cad');
    S.cadEdit = null;
    render();
  });
}

// ---------------------------------------------------------------- 14K rate paid per design
// When the gold is bought, the 14K rate per gram actually paid is typed on the gold line (Change + confirm + Save),
// like the CAD charge, and kept on this device (localStorage akurati-bought {code: {date, rate14, g?, ct?}}).
// The cost and profit use it; the selling price still follows today's rate.
const rateLink = `<a class="small" href="https://www.goodreturns.in/gold-rates/" target="_blank" rel="noopener">Check today's rate</a>`;

function loadBought() {
  try { S.bought = JSON.parse(store.get('akurati-bought') || '{}') || {}; } catch { S.bought = {}; }
}

function saveBought() {
  if (Object.keys(S.bought).length) store.set('akurati-bought', JSON.stringify(S.bought));
  else store.del('akurati-bought');
}

function goldHow(d, how) {
  if (S.buyEdit === d.code) return `
    <form class="buy-form" data-code="${esc(d.code)}" autocomplete="off">
      <input type="text" inputmode="decimal" value="${boughtOf(d)?.rate14 ?? Math.round(rate14())}"
        aria-label="14K gold rate paid for ${esc(d.name)}, ₹ per gram"> <span>₹ per gram of 14K</span>
      <button type="submit">Save</button>
      <button type="button" class="ghost buy-cancel">Cancel</button>
      ${S.bought[d.code] ? `<button type="button" class="ghost buy-clear">${d.quote.bought ? 'Back to the locked bill' : "Back to today's rate"}</button>` : ''}
      <p class="lock-msg buy-msg" role="alert"></p>
    </form>`;
  return `<div class="how">${esc(how)} · <button type="button" class="link buy-edit" data-code="${esc(d.code)}">Change</button>
    · ${rateLink}</div>`;
}

function initBought() {
  $('#app').addEventListener('click', e => {
    const t = e.target;
    if (t.matches('.buy-edit')) {
      const d = design(t.dataset.code);
      if (!confirm(`Change the 14K gold rate for ${d.name}?\nType the rate per gram you paid. The cost and profit use it; `
        + "the selling price still follows today's rate. Only this device changes.")) return;
      S.buyEdit = d.code;
      render();
      $('.buy-form input').focus();
    } else if (t.matches('.buy-cancel')) {
      S.buyEdit = null;
      render();
    } else if (t.matches('.buy-clear')) {
      delete S.bought[t.closest('.buy-form').dataset.code];
      saveBought();
      S.buyEdit = null;
      render();
    }
  });
  $('#app').addEventListener('submit', e => {
    if (!e.target.matches('.buy-form')) return;
    e.preventDefault();
    const f = e.target, d = design(f.dataset.code), raw = f.querySelector('input').value.replace(/[₹,\s]/g, '');
    const v = raw === '' ? NaN : Number(raw);
    if (!(v >= 1500 && v <= 35000)) {
      f.querySelector('.buy-msg').textContent = v > 35000 ? 'That looks like the price for 10 grams. Type the price for 1 gram of 14K.'
        : 'Type the 14K rate in rupees per gram.';
      return;
    }
    const { rate24, ...b } = boughtOf(d) || {};   // weights from a locked bill stay; the old 24K field is gone
    S.bought[d.code] = { ...b, date: b.date || todayISO(), rate14: v };
    saveBought();
    S.buyEdit = null;
    render();
  });
}

// ---------------------------------------------------------------- today's gold rate
// Each device remembers the last rate typed and the day it was typed, so an old rate can't pass for today's.
// Only a per-gram rate is taken: the 10 g price (as IBJA and many sites show it) is refused, not divided.
function rateNote(err = '') {
  const el = $('#rate-note'), stale = S.rateDay !== todayISO();
  el.hidden = !err && !stale;
  el.innerHTML = err ? esc(err)
    : `${S.rateDay ? `This rate is from ${dayTxt(S.rateDay)}.` : 'This rate is from an earlier day.'} Type today's rate. `
      + '<button type="button" class="link" id="rate-keep">It is still today\'s rate</button>';
}

function setRate(v) {
  S.rate24 = v;
  S.rateDay = todayISO();
  store.set('akurati-rate24', v);
  store.set('akurati-rate24-day', S.rateDay);
  rateNote();
  render();
}

function initRate() {
  const rate = $('#rate24'), ok = v => v >= 3000 && v <= 50000;
  rate.value = S.rate24;
  rate.addEventListener('input', () => { const v = Number(rate.value); if (ok(v)) setRate(v); });
  rate.addEventListener('change', () => {
    const v = Number(rate.value);
    if (!ok(v)) rateNote(v > 50000 ? 'That looks like the price for 10 grams. Type the price for 1 gram.'
      : 'That is too low for 24K gold per gram. Check the number.');
  });
  $('#rate-note').addEventListener('click', e => { if (e.target.id === 'rate-keep') setRate(S.rate24); });
  rateNote();
}

// ---------------------------------------------------------------- tax settings
// GST rate, hallmark fee and GST registration. Defaults come from the locked data; a change made on the page stays
// on this device only. Editing takes "Change", a confirm, then "Save", so a stray tap can't move every price.
const SETTINGS = { gst: 'akurati-gst', hallmark: 'akurati-hallmark', registered: 'akurati-registered' };
const defaults = () => ({ gst: S.data.gst, hallmark: S.data.hallmark, registered: !!S.data.gst_registered });
const changed = () => Object.keys(SETTINGS).some(k => store.get(SETTINGS[k]) !== null);

function loadSettings() {
  const d = defaults(), get = k => store.get(SETTINGS[k]);
  S.set = {
    gst: get('gst') === null ? d.gst : Number(get('gst')),
    hallmark: get('hallmark') === null ? d.hallmark : Number(get('hallmark')),
    registered: get('registered') === null ? d.registered : get('registered') === '1',
  };
}

function saveSettings(set) {
  const d = defaults();
  S.set = set;
  for (const k of Object.keys(SETTINGS)) {
    if (set[k] === d[k]) store.del(SETTINGS[k]);
    else store.set(SETTINGS[k], k === 'registered' ? (set[k] ? '1' : '0') : set[k]);
  }
}

function fillSettings(set) {
  $('#set-gst').value = +(set.gst * 100).toFixed(2);
  $('#set-hm').value = set.hallmark;
  $('#set-reg').checked = set.registered;
  $('#set-msg').textContent = '';
}

function closeSettings() {
  $('#set-form').hidden = true;
  $('#set-edit').hidden = false;
}

function initSettings() {
  $('#set-edit').addEventListener('click', () => {
    if (!confirm('Change the GST rate, hallmark fee or GST registration?\nEvery price on this device changes with them.')) return;
    fillSettings(S.set);
    $('#set-form').hidden = false;
    $('#set-edit').hidden = true;
    $('#set-gst').focus();
  });
  $('#set-cancel').addEventListener('click', closeSettings);
  $('#set-reset').addEventListener('click', () => fillSettings(defaults()));   // still needs Save
  $('#set-form').addEventListener('submit', e => {
    e.preventDefault();
    const num = s => (s.trim() === '' ? NaN : Number(s.replace(/[%₹,\s]/g, '')));
    const gst = num($('#set-gst').value), hallmark = num($('#set-hm').value);
    if (!(gst >= 0 && gst <= 28)) { $('#set-msg').textContent = 'GST rate should be a number from 0 to 28.'; return; }
    if (!(hallmark >= 0 && hallmark <= 2000)) { $('#set-msg').textContent = 'Hallmark fee should be a number of rupees, 0 to 2,000.'; return; }
    saveSettings({ gst: gst / 100, hallmark, registered: $('#set-reg').checked });
    closeSettings();
    render();
  });
}

// ---------------------------------------------------------------- render
function start() {
  const typed = Number(store.get('akurati-rate24'));
  S.rate24 = typed || S.data.gold.rate24;
  S.rateDay = typed ? store.get('akurati-rate24-day') : S.data.gold.date;   // null: typed before days were kept
  S.markup = Number(store.get('akurati-markup')) || S.data.markup;
  loadSettings();
  loadCad();
  loadBought();
  $('#app').innerHTML = `
  <section class="panel controls">
    <div class="rate">
      <label for="rate24">Today's 24K gold rate, ₹ per gram</label>
      <input id="rate24" type="number" inputmode="decimal" min="3000" max="50000" step="1">
      ${rateLink}
      <p id="rate-note" class="rate-note" role="status" hidden></p>
    </div>
    <div class="chip key"><b id="c-14"></b><span>14K gold per gram today: the selling price follows this</span></div>
    <div class="markup">
      <label for="markup">Markup</label>
      <input id="markup" type="range" min="1.2" max="2.5" step="0.05">
      <output id="markup-out"></output>
    </div>
    <div class="settings">
      <p id="set-view"></p>
      <button type="button" class="ghost" id="set-edit">Change</button>
    </div>
    <form id="set-form" class="set-form" autocomplete="off" hidden>
      <label>GST rate, %<input id="set-gst" type="text" inputmode="decimal"></label>
      <label>BIS hallmark + HUID, ₹ per piece<input id="set-hm" type="text" inputmode="decimal"></label>
      <label class="check"><input id="set-reg" type="checkbox"> Akurati is GST-registered</label>
      <p class="small note">Not registered: the maker's GST is part of the cost, and the selling price has no GST.
        Registered: the maker's GST comes back to you, and GST is added to the selling price.</p>
      <div class="set-btns">
        <button type="submit">Save</button>
        <button type="button" class="ghost" id="set-cancel">Cancel</button>
        <button type="button" class="ghost" id="set-reset">Back to defaults</button>
      </div>
      <p id="set-msg" class="lock-msg" role="alert"></p>
    </form>
  </section>
  <div id="quoted"></div>
  <div class="section-h"><h2>Not priced yet</h2><p id="n-waiting"></p></div>
  <div id="waiting" class="grid"></div>
  <div class="foot-note"><button type="button" class="ghost" id="relock">Lock this device</button></div>`;

  initRate();
  const m = $('#markup');
  m.value = S.markup;
  m.addEventListener('input', () => { S.markup = Number(m.value); store.set('akurati-markup', S.markup); render(); });
  $('#relock').addEventListener('click', () => { store.del('akurati-pw'); location.reload(); });
  initSettings();
  initCad();
  initBought();
  render();
}

function render() {
  const { gst, hallmark, registered } = S.set;
  $('#c-14').textContent = inr(rate14());
  $('#markup-out').textContent = `×${S.markup.toFixed(2)} · ${Math.round((S.markup - 1) * 100)}% on cost`;
  $('#set-view').innerHTML = `GST <b>${rateTxt(gst)}</b> · Hallmark <b>${inr(hallmark)}</b> per piece · `
    + `<b>${registered ? 'GST-registered' : 'Not GST-registered'}</b>`
    + (changed() ? ' <span class="badge changed">changed on this device</span>' : '');
  const ds = S.data.designs;
  $('#quoted').innerHTML = ds.filter(d => d.quote).map(card).join('');
  const waiting = ds.filter(d => !d.quote);
  $('#n-waiting').textContent = `${waiting.length} designs`;
  $('#waiting').innerHTML = waiting.map(d => `
    <article class="dcard"><img src="img/designs/${esc(d.slug)}.jpg" alt="${esc(d.name)}" loading="lazy">
      <div><h3>${esc(d.name)}</h3><span class="badge waiting">Waiting for price</span></div></article>`).join('');
}

function card(d) {
  const q = d.quote, b = boughtOf(d), reg = S.set.registered;
  const c = costOf(d), now = b ? costOf(d, true) : c, p = priceOf(now.total, c.total);
  const rows = c.lines.map(([what, how, amt, key]) => `
    <tr><td><div class="what">${esc(what)}</div>${key === 'cad' ? cadHow(d, how) : key === 'gold' ? goldHow(d, how)
      : how ? `<div class="how">${esc(how)}</div>` : ''}</td><td>${inr(amt)}</td></tr>`).join('');
  const todayRow = b ? `
    <tr class="today"><td>The same piece at today's gold rate: the selling price is marked up from this</td><td>${inr(now.total)}</td></tr>` : '';
  return `
  <article class="qcard">
    <div class="qhead">
      <h3>${esc(d.name)} <span class="badge${b ? ' booked' : ''}">${b ? `Gold booked ${esc(dayTxt(b.date))}` : 'Gold not booked yet'}</span></h3>
      <div class="sub">${[`${d.type}, ${q.pieces === 2 ? 'a pair' : 'one piece'}`, d.collection, d.code, `maker's code ${q.maker_code}`]
        .map(s => `<span>${esc(s)}</span>`).join(' · ')}</div>
    </div>
    <div class="qgrid">
      <div class="pics">
        <figure><img src="img/designs/${esc(d.slug)}.jpg" alt="${esc(d.name)}"><figcaption>Our design</figcaption></figure>
        <figure><img class="cad-img" src="${q.cad_image}" alt="Maker's CAD drawing of ${esc(d.name)}"><figcaption>Maker's CAD (tap to enlarge)</figcaption></figure>
      </div>
      <div>
        <table class="ct"><tbody>${rows}
          <tr class="sum"><td>${reg ? 'Cost price, before GST' : "Cost price, with the maker's GST"}</td><td>${inr(c.total)}</td></tr>${todayRow}
        </tbody></table>
        <div class="pricebox">
          <div class="pb tag"><b>${inr(p.tag)}</b><span>${reg ? `selling price, with ${rateTxt(S.set.gst)} GST` : 'selling price · no GST, not registered'}</span></div>
          <div class="pb"><b>${inr(p.profit)}</b><span>profit · ${pct(p.share)} of the ${reg ? 'price before GST' : 'selling price'}</span></div>
        </div>
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------- tab 3: the maker's inputs
// Quotes and rate sheets as the maker sent them, newest first: a picture (inlined into the locked data by
// tools/publish.py), or a table typed in when only the numbers were kept.
function renderInputs() {
  const items = [...(S.data.inputs || [])].sort((a, b) => b.date.localeCompare(a.date));
  $('#inputs-app').innerHTML = items.length ? items.map(inputCard).join('') : '<p class="small">No inputs yet.</p>';
}

function inputCard(x) {
  const day = new Date(x.date + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const body = x.image ? `<img class="input-img" src="${x.image}" alt="${esc(x.title)}">` : `
    <table class="ct rates"><thead><tr>${x.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
      ${x.table.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${inr(v)}</td></tr>`).join('')}</tbody></table>`;
  return `
  <article class="qcard input">
    <div class="qhead"><h3>${esc(x.title)}</h3><div class="sub">${esc(x.from)} · ${esc(day)}</div></div>
    ${body}
    ${x.note ? `<p class="small">${esc(x.note)}</p>` : ''}
  </article>`;
}
