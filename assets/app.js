// Akurati costing site.
// Tab 1 shows nothing until the password decrypts data/costs.enc.json (made by tools/publish.py:
// PBKDF2-SHA256 -> AES-256-GCM). Tab 2 is static HTML in index.html.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => Math.round(x * 100) + '%';
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
const S = { data: null, rate24: 0, markup: 1.5 };

const rate14 = () => S.rate24 / 0.999 * S.data.gold.maker_purity;   // 14K per gram, as the maker bills it

function costOf(q) {
  const g = q.gold.g, r = rate14();
  const lines = [
    ['14K gold', `${g} g × ${inr(r)} per gram`, g * r],
    ...q.stones.map(s => [s.what, `${s.count} stones · ${s.ct} ct × ${inr(s.rate)} per carat`, s.ct * s.rate]),
    ['Labour', `${g} g × ${inr(q.labour_per_g)} per gram`, g * q.labour_per_g],
    ['CAD design', 'one time', q.cad_charge],
    ['IGI certificate', '', q.igi],
    ['BIS hallmark + HUID', `${q.pieces} × ${inr(S.data.hallmark)}`, q.pieces * S.data.hallmark],
  ];
  return { lines, total: lines.reduce((a, l) => a + l[2], 0) };
}

function priceOf(cost) {
  const gst = S.data.gst;
  const tag = Math.round(cost * S.markup * (1 + gst) / 100) * 100;   // price tag, rounded to ₹100
  const profit = tag / (1 + gst) - cost;
  return { tag, profit, share: profit / (tag / (1 + gst)) };
}

// ---------------------------------------------------------------- render
function start() {
  S.rate24 = Number(store.get('akurati-rate24')) || S.data.gold.rate24;
  S.markup = Number(store.get('akurati-markup')) || S.data.markup;
  $('#app').innerHTML = `
  <section class="panel controls">
    <div class="rate">
      <label for="rate24">Today's 24K gold rate, ₹ per gram</label>
      <input id="rate24" type="number" inputmode="decimal" min="1000" step="1">
      <a class="small" href="https://www.goodreturns.in/gold-rates/" target="_blank" rel="noopener">Check today's rate</a>
    </div>
    <div class="chip key"><b id="c-14"></b><span>14K gold per gram today</span></div>
    <div class="markup">
      <label for="markup">Markup</label>
      <input id="markup" type="range" min="1.2" max="2.5" step="0.05">
      <output id="markup-out"></output>
    </div>
  </section>
  <div id="quoted"></div>
  <div class="section-h"><h2>Not priced yet</h2><p id="n-waiting"></p></div>
  <div id="waiting" class="grid"></div>
  <div class="foot-note"><button type="button" class="ghost" id="relock">Lock this device</button></div>
  <dialog class="zoom" id="zoom"><img alt=""></dialog>`;

  const rate = $('#rate24');
  rate.value = S.rate24;
  rate.addEventListener('input', () => {
    const v = Number(rate.value);
    if (v > 1000) { S.rate24 = v; store.set('akurati-rate24', v); render(); }
  });
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
  render();
}

function render() {
  $('#c-14').textContent = inr(rate14());
  $('#markup-out').textContent = `×${S.markup.toFixed(2)} · ${Math.round((S.markup - 1) * 100)}% on cost`;
  const ds = S.data.designs;
  $('#quoted').innerHTML = ds.filter(d => d.quote).map(card).join('');
  const waiting = ds.filter(d => !d.quote);
  $('#n-waiting').textContent = `${waiting.length} designs`;
  $('#waiting').innerHTML = waiting.map(d => `
    <article class="dcard"><img src="img/designs/${esc(d.slug)}.jpg" alt="${esc(d.name)}" loading="lazy">
      <div><h3>${esc(d.name)}</h3><span class="badge waiting">Waiting for price</span></div></article>`).join('');
}

function card(d) {
  const q = d.quote, c = costOf(q), p = priceOf(c.total);
  const rows = c.lines.map(([what, how, amt]) => `
    <tr><td><div class="what">${esc(what)}</div>${how ? `<div class="how">${esc(how)}</div>` : ''}</td><td>${inr(amt)}</td></tr>`).join('');
  return `
  <article class="qcard">
    <div class="qhead">
      <h3>${esc(d.name)}</h3>
      <div class="sub">${esc(d.type)}, ${q.pieces === 2 ? 'a pair' : 'one piece'} · ${esc(d.collection)} · ${esc(d.code)} · maker's code ${esc(q.maker_code)}</div>
    </div>
    <div class="qgrid">
      <div class="pics">
        <figure><img src="img/designs/${esc(d.slug)}.jpg" alt="${esc(d.name)}"><figcaption>Our design</figcaption></figure>
        <figure><img class="cad-img" src="${q.cad_image}" alt="Maker's CAD drawing of ${esc(d.name)}"><figcaption>Maker's CAD (tap to enlarge)</figcaption></figure>
      </div>
      <div>
        <table class="ct"><tbody>${rows}
          <tr class="sum"><td>Cost price, before GST</td><td>${inr(c.total)}</td></tr>
        </tbody></table>
        <div class="pricebox">
          <div class="pb tag"><b>${inr(p.tag)}</b><span>selling price, with 3% GST</span></div>
          <div class="pb"><b>${inr(p.profit)}</b><span>profit · ${pct(p.share)} of the price before GST</span></div>
        </div>
      </div>
    </div>
  </article>`;
}
