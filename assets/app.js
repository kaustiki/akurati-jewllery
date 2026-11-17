// Akurati costing site.
// Tab 1 shows nothing until the password decrypts data/costs.enc.json (made by tools/publish.py:
// PBKDF2-SHA256 -> AES-256-GCM). Tab 2 is static HTML in index.html.
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
function showTab() {
  const tab = location.hash === '#guide' ? 'guide' : 'costs';
  $$('[data-tab]').forEach(a => a.setAttribute('aria-selected', a.dataset.tab === tab));
  $$('.tab-panel').forEach(p => { p.hidden = p.id !== tab; });
}
addEventListener('hashchange', () => { showTab(); scrollTo(0, 0); });
showTab();

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
  start();
}

$('#lock').addEventListener('submit', e => {
  e.preventDefault();
  unlock($('#pw').value, $('#remember').checked);
});
const saved = store.get('akurati-pw');
if (saved) unlock(saved, true);

// ---------------------------------------------------------------- state and maths
const S = { data: null, rate24: 0, markup: 1.5, set: null };

const rate14 = () => S.rate24 / 0.999 * S.data.gold.maker_purity;   // 14K per gram, as the maker bills it
const sum = lines => lines.reduce((a, l) => a + l[2], 0);
const whole = lines => lines.map(([what, how, amt]) => [what, how, Math.round(amt)]);   // lines in rupees, so a bill adds up
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayTxt = iso => new Date(iso + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Two gold rates. Until a piece is bought, its gold is costed at today's rate (the box at the top). Once bought,
// quote.bought holds the maker's final bill: date, rate14 (14K ₹ per gram as billed), and g / ct when the bill's
// weights differ from the quote. The cost then uses that bill; the selling price still follows today's rate
// (today = true: the same piece at today's rate).
// Not GST-registered: the maker's GST can't be claimed back, so it is part of the cost, and the price carries no GST.
// Registered: the maker's GST comes back as input credit, so cost is before GST and GST is added to the price.
function costOf(q, today = false) {
  const b = q.bought || {}, booked = !today && !!b.rate14;
  const g = b.g ?? q.gold.g, r = booked ? b.rate14 : rate14(), { gst, hallmark, registered } = S.set;
  const bill = whole([
    ['14K gold', `${g} g × ${inr(r)} per gram, ${booked ? `booked ${dayTxt(b.date)}` : "today's rate"}`, g * r],
    ...q.stones.map((s, i) => {
      const ct = b.ct?.[i] ?? s.ct;
      return [s.what, `${s.count} stones · ${ct} ct × ${inr(s.rate)} per carat`, ct * s.rate];
    }),
    ['Labour', `${g} g × ${inr(q.labour_per_g)} per gram`, g * q.labour_per_g],
    ['CAD design', 'one time', q.cad_charge],
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
  $('#app').innerHTML = `
  <section class="panel controls">
    <div class="rate">
      <label for="rate24">Today's 24K gold rate, ₹ per gram</label>
      <input id="rate24" type="number" inputmode="decimal" min="3000" max="50000" step="1">
      <a class="small" href="https://www.goodreturns.in/gold-rates/" target="_blank" rel="noopener">Check today's rate</a>
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
  <div class="foot-note"><button type="button" class="ghost" id="relock">Lock this device</button></div>
  <dialog class="zoom" id="zoom"><img alt=""></dialog>`;

  initRate();
  const m = $('#markup');
  m.value = S.markup;
  m.addEventListener('input', () => { S.markup = Number(m.value); store.set('akurati-markup', S.markup); render(); });
  $('#relock').addEventListener('click', () => { store.del('akurati-pw'); location.reload(); });
  $('#app').addEventListener('click', e => {
    const img = e.target.closest('.cad-img');
    if (!img) return;
    $('#zoom img').src = img.src;
    $('#zoom').showModal();
  });
  $('#zoom').addEventListener('click', e => e.currentTarget.close());
  initSettings();
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
  const q = d.quote, b = q.bought, reg = S.set.registered;
  const c = costOf(q), now = b ? costOf(q, true) : c, p = priceOf(now.total, c.total);
  const rows = c.lines.map(([what, how, amt]) => `
    <tr><td><div class="what">${esc(what)}</div>${how ? `<div class="how">${esc(how)}</div>` : ''}</td><td>${inr(amt)}</td></tr>`).join('');
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
