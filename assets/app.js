// Akurati costing site.
// Tab 1 shows nothing until the password decrypts data/costs.enc.json (made by vajra/costing/publish.py:
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
const S = { data: null, rate24: 0, mode: 'today', markup: 1.5, gateway: 0, shipping: 0, ads: 0, filter: 'all' };

const pureRate = () => S.rate24 / 0.999;                       // ₹ per gram of pure gold
const makerRate14 = () => pureRate() * S.data.gold.maker_purity;  // 14K as the maker bills it
const quotedRate14 = () => S.data.gold.maker_base_995 / 0.995 * S.data.gold.maker_purity;
const goldRate = q => (S.mode === 'quoted' ? q.gold.rate : makerRate14());

const KINDS = {
  gold: ['Gold', 'var(--c-gold)'], diamond: ['Diamonds', 'var(--c-diamond)'],
  labour: ['Labour', 'var(--c-labour)'], other: ['CAD, IGI, hallmark', 'var(--c-other)'],
};

function costOf(q) {
  const d = S.data.defaults, gr = goldRate(q), g = q.gold.g;
  const lines = [
    { k: 'gold', what: '14K gold', how: `${g} g × ${inr(gr)} per gram`, amt: g * gr },
    ...q.stones.map(s => ({ k: 'diamond', what: s.what, how: `${s.ct} ct × ${inr(s.rate)} per carat · ${s.about}`, amt: s.ct * s.rate })),
    { k: 'labour', what: 'Labour: making and setting', how: `${g} g × ${inr(q.labour_per_g)} per gram`, amt: g * q.labour_per_g },
    { k: 'other', what: 'CAD design', how: 'Once per design, not on repeat orders', amt: q.cad_charge },
    { k: 'other', what: 'IGI certificate', how: 'Laboratory report for the diamonds', amt: q.igi },
    { k: 'other', what: 'BIS hallmark + HUID', how: `${q.pieces} pieces × ${inr(d.hallmark)}. Not in the quote; added by us`, amt: q.pieces * d.hallmark, added: true },
  ];
  const total = lines.reduce((a, l) => a + l.amt, 0);
  const quotedLines = lines.filter(l => !l.added).reduce((a, l) => a + l.amt, 0);
  return { lines, total, quotedLines, gr };
}

function priceOf(cost) {
  const gst = S.data.defaults.gst;
  const tag = Math.round(cost * S.markup * (1 + gst) / 100) * 100;   // price tag, rounded to ₹100
  const ex = tag / (1 + gst);                                         // what you keep before GST
  const profit = ex - cost;
  const net = profit - tag * S.gateway - S.shipping - ex * S.ads;
  return { tag, ex, profit, net };
}

// ---------------------------------------------------------------- render
function start() {
  const d = S.data.defaults;
  S.rate24 = Number(store.get('akurati-rate24')) || S.data.gold.rate24;
  S.markup = Number(store.get('akurati-markup')) || d.markup;
  S.mode = store.get('akurati-mode') === 'quoted' ? 'quoted' : 'today';
  S.gateway = d.gateway; S.shipping = d.shipping; S.ads = d.ads;
  $('#app').innerHTML = shell();
  wire();
  render();
}

function shell() {
  const g = S.data.gold, d = S.data.defaults, e = S.data.estimate;   // maker's numbers live only in the locked data
  return `
  <section class="panel">
    <div class="gold">
      <div class="rate">
        <label for="rate24">Today's 24K gold rate, ₹ per gram</label>
        <input id="rate24" type="number" inputmode="decimal" min="1000" step="1">
        <p class="small">Saved rate: ${inr(g.rate24)} on ${esc(g.date)} (${esc(g.source)}).
          Check today: <a href="https://www.goodreturns.in/gold-rates/" target="_blank" rel="noopener">Goodreturns</a> ·
          <a href="https://ibjarates.com/" target="_blank" rel="noopener">IBJA</a></p>
      </div>
      <div>
        <div class="chips">
          <div class="chip"><b id="c-pure"></b><span>pure gold per gram (24K ÷ 99.9%)</span></div>
          <div class="chip key"><b id="c-14"></b><span>14K per gram, as the maker bills it (${(g.maker_purity * 100).toFixed(1)}% gold)</span></div>
          <div class="chip"><b>${inr(g.quoted_rate14)}</b><span>14K in the quote: ${inr(g.maker_base_995)} for 995 gold, ÷ 99.5% × ${(g.maker_purity * 100).toFixed(1)}% = ${inr(quotedRate14())}, rounded</span></div>
        </div>
        <p class="small">The maker's 14K rate: pure gold × ${(g.maker_purity * 100).toFixed(1)}%. The hallmark is 58.5%; the extra 1% covers their alloy loss.
          The gold is re-priced on the day you book it for production.</p>
      </div>
      <div class="controls">
        <div class="seg" role="group" aria-label="Gold rate to use">
          <button type="button" data-mode="today">Today's gold</button>
          <button type="button" data-mode="quoted">Gold as quoted</button>
        </div>
        <div class="markup">
          <label for="markup">Markup</label>
          <input id="markup" type="range" min="1.2" max="2.5" step="0.05">
          <output id="markup-out"></output>
          <p class="small" id="markup-words"></p>
        </div>
        <details class="costs-more">
          <summary>Selling costs, for the profit you keep</summary>
          <div class="sell-costs">
            <label>Payment gateway, % of price<input id="s-gateway" type="number" step="0.01" min="0" value="${(d.gateway * 100).toFixed(2)}"></label>
            <label>Shipping + box, ₹ per order<input id="s-shipping" type="number" step="50" min="0" value="${d.shipping}"></label>
            <label>Ads, % of price<input id="s-ads" type="number" step="1" min="0" value="${Math.round(d.ads * 100)}"></label>
          </div>
          <p class="small">Razorpay is about 2% + 18% GST on the fee. Insured courier and a gift box run about ₹1,000. Ads are your guess: start at 10%.</p>
        </details>
      </div>
    </div>
  </section>

  <section class="panel">
    <h2>How a selling price is built</h2>
    <p class="small">Every quote from the maker has the same parts. Add them up for the cost, multiply by the markup, then add 3% GST.</p>
    <div class="formula-strip">
      <div class="fbox gold-b"><b>Gold</b><span>grams × 14K rate</span></div><span class="op">+</span>
      <div class="fbox dia-b"><b>Diamonds</b><span>carats × rate per carat</span></div><span class="op">+</span>
      <div class="fbox lab-b"><b>Labour</b><span>grams × ₹ per gram</span></div><span class="op">+</span>
      <div class="fbox"><b>CAD, IGI, hallmark</b><span>fixed amounts</span></div><span class="op">=</span>
      <div class="fbox total"><b>Cost</b><span>to make it</span></div><span class="op">×</span>
      <div class="fbox"><b id="f-markup">1.5</b><span>markup</span></div><span class="op">+</span>
      <div class="fbox"><b>3% GST</b><span>for the government</span></div><span class="op">=</span>
      <div class="fbox price"><b>Price tag</b><span>what the customer pays</span></div>
    </div>
  </section>

  <div class="section-h"><h2>Quoted by the maker</h2><p id="n-quoted"></p></div>
  <div id="quoted"></div>

  <div class="section-h"><h2>Samples ordered</h2><p>Waiting for the maker's price</p></div>
  <div id="samples" class="samples"></div>

  <div class="section-h"><h2>Waiting for CAD</h2>
    <div class="filters" role="group" aria-label="Filter by piece">
      <button type="button" data-f="all">All</button><button type="button" data-f="earrings">Earrings</button>
      <button type="button" data-f="nose pins">Nose pins</button><button type="button" data-f="nose rings">Nose rings</button>
    </div>
  </div>
  <div id="waiting" class="grid"></div>

  <div class="section-h"><h2>Quick estimate</h2><p>Check a new quote before it is added here</p></div>
  <section class="panel">
    <div class="est">
      <label>Gold, grams<input id="e-g" type="number" step="0.1" min="0" value="${e.gold_g}"></label>
      <label>Pieces (2 for a pair)<input id="e-pcs" type="number" step="1" min="1" value="${e.pieces}"></label>
      <label>Small diamonds, carats<input id="e-sct" type="number" step="0.01" min="0" value="${e.small_ct}"></label>
      <label>₹ per carat<input id="e-sr" type="number" step="100" min="0" value="${e.small_rate}"></label>
      <label>Big diamonds, carats<input id="e-bct" type="number" step="0.01" min="0" value="${e.big_ct}"></label>
      <label>₹ per carat<input id="e-br" type="number" step="100" min="0" value="${e.big_rate}"></label>
      <label>Labour, ₹ per gram<input id="e-lab" type="number" step="50" min="0" value="${e.labour_per_g}"></label>
      <label>CAD + IGI, ₹<input id="e-fix" type="number" step="50" min="0" value="${e.fixed}"></label>
    </div>
    <div class="pricebox est-out" id="e-out"></div>
  </section>

  <div class="section-h"><h2>Maker's diamond rate list</h2><p>${esc(S.data.rate_list.date)}</p></div>
  <table class="rl">
    <thead><tr><th>Sieve size</th><th>About</th><th>₹ per carat</th></tr></thead>
    <tbody>${S.data.rate_list.rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${inr(r[2])}</td></tr>`).join('')}</tbody>
  </table>
  <p class="small">${esc(S.data.rate_list.note)}</p>

  <div class="foot-note">
    <span>Data updated ${esc(S.data.updated)}. To add a quote: edit <code>vajra/costing/costs.json</code>, run <code>python3 costing/publish.py</code>.</span>
    <button type="button" class="ghost" id="relock">Lock this device</button>
  </div>
  <dialog class="zoom" id="zoom"><img alt=""></dialog>`;
}

function wire() {
  const rate = $('#rate24');
  rate.value = S.rate24;
  rate.addEventListener('input', () => {
    const v = Number(rate.value);
    if (v > 1000) { S.rate24 = v; store.set('akurati-rate24', v); render(); }
  });
  $$('.seg button').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode; store.set('akurati-mode', S.mode); render();
  }));
  const m = $('#markup');
  m.value = S.markup;
  m.addEventListener('input', () => { S.markup = Number(m.value); store.set('akurati-markup', S.markup); render(); });
  const num = (id, f) => $(id).addEventListener('input', e => { f(Number(e.target.value) || 0); render(); });
  num('#s-gateway', v => { S.gateway = v / 100; });
  num('#s-shipping', v => { S.shipping = v; });
  num('#s-ads', v => { S.ads = v / 100; });
  $$('.filters button').forEach(b => b.addEventListener('click', () => { S.filter = b.dataset.f; render(); }));
  $$('.est input').forEach(i => i.addEventListener('input', renderEstimate));
  $('#relock').addEventListener('click', () => { store.del('akurati-pw'); location.reload(); });
  $('#app').addEventListener('click', e => {
    const img = e.target.closest('.cad-img');
    if (!img) return;
    const z = $('#zoom');
    z.querySelector('img').src = img.src;
    z.showModal();
  });
  $('#zoom').addEventListener('click', e => e.currentTarget.close());
}

function render() {
  $('#c-pure').textContent = inr(pureRate());
  $('#c-14').textContent = inr(makerRate14());
  $$('.seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
  $('#markup-out').textContent = '×' + S.markup.toFixed(2);
  $('#f-markup').textContent = '×' + S.markup.toFixed(2);
  $('#markup-words').textContent = `${Math.round((S.markup - 1) * 100)}% on top of cost: ${pct(1 - 1 / S.markup)} of the price before GST is profit. `
    + 'We recommend ×1.5; do not go under ×1.35.';
  $$('.filters button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === S.filter));

  const ds = S.data.designs;
  const quoted = ds.filter(d => d.status === 'quoted');
  $('#n-quoted').textContent = `${quoted.length} of ${ds.length} designs`;
  $('#quoted').innerHTML = quoted.map(quotedCard).join('');
  $('#samples').innerHTML = ds.filter(d => d.status === 'sample').map(d => `
    <article class="scard"><img src="img/designs/${esc(d.slug)}.jpg" alt="${esc(d.name)}" loading="lazy">
      <div><h3>${esc(d.name)}</h3><span class="badge sample">Sample ordered</span>
      <p class="small">${esc(d.code)} · ${esc(d.type)} · ${esc(d.collection)}</p><p>${esc(d.note || '')}</p></div></article>`).join('');
  const waiting = ds.filter(d => d.status === 'waiting' && (S.filter === 'all' || d.type === S.filter));
  $('#waiting').innerHTML = waiting.map(d => `
    <article class="dcard"><img src="img/designs/${esc(d.slug)}.jpg" alt="${esc(d.name)}" loading="lazy">
      <div><h3>${esc(d.name)}</h3><p>${esc(d.meaning)}</p><p>${esc(d.type)} · ${esc(d.collection)}</p>
      <span class="badge waiting">Waiting for CAD</span></div></article>`).join('');
  renderEstimate();
}

function quotedCard(d) {
  const q = d.quote, c = costOf(q), p = priceOf(c.total);
  const share = k => c.lines.filter(l => l.k === k).reduce((a, l) => a + l.amt, 0) / c.total;
  const goldShare = share('gold');
  const rows = c.lines.map(l => `
    <tr class="${l.added ? 'added' : ''}"><td><div class="what"><i class="dot" style="background:${KINDS[l.k][1]}"></i>${esc(l.what)}</div>
      <div class="how">${esc(l.how)}</div></td><td>${inr(l.amt)}</td></tr>`).join('');
  const bar = Object.keys(KINDS).map(k => `<i style="width:${share(k) * 100}%;background:${KINDS[k][1]}" title="${KINDS[k][0]}"></i>`).join('');
  const legend = Object.keys(KINDS).map(k => `<span><i style="background:${KINDS[k][1]}"></i>${KINDS[k][0]} ${pct(share(k))}</span>`).join('');
  const diff = c.quotedLines - q.quoted_total;
  const check = S.mode === 'quoted'
    ? `The maker's total is <b>${inr(q.quoted_total)}</b>; the lines above add up to ${inr(c.quotedLines)} before our hallmark line${Math.abs(diff) < 1 ? ', so the sum is right.' : '.'}`
    : `At today's gold, the maker's lines come to <b>${inr(c.quotedLines)}</b>: ${inr(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than their quote of ${inr(q.quoted_total)}.`;
  const perGram = c.gr + q.labour_per_g;
  return `
  <article class="qcard">
    <div class="qhead">
      <div><h3>${esc(d.name)} <span class="badge">Quoted</span></h3>
        <div class="sub">${esc(d.meaning)} · ${esc(d.type)}, ${q.pieces === 2 ? 'a pair' : 'one piece'} · ${esc(d.collection)}</div></div>
      <div class="sub">${esc(d.code)} · maker's code ${esc(q.maker_code)} · quote ${esc(q.date)}</div>
    </div>
    <div class="qgrid">
      <div class="qimgs">
        <div class="pics">
          <figure><img src="img/designs/${esc(d.slug)}.jpg" alt="${esc(d.name)}"><figcaption>Our design</figcaption></figure>
          <figure><img class="cad-img" src="${q.cad_image}" alt="Maker's CAD drawing of ${esc(d.name)}"><figcaption>Maker's CAD (tap to enlarge)</figcaption></figure>
        </div>
        <dl class="facts">
          <dt>Length</dt><dd>${q.cad.length_mm} mm</dd>
          <dt>Gold in the CAD</dt><dd>${q.cad.gold_g} g 14K (quote bills ${q.gold.g} g)</dd>
          <dt>Diamonds</dt><dd>${q.cad.stones} stones, ${q.cad.carats} ct in all</dd>
        </dl>
        <p class="asked"><b>We asked for:</b> ${esc(q.asked)}</p>
      </div>
      <div>
        <table class="ct"><tbody>${rows}
          <tr class="sum"><td>Cost to make, before GST</td><td>${inr(c.total)}</td></tr>
          <tr class="gst"><td>+ 3% GST paid to the maker (claimed back from the GST you collect)</td><td>${inr(c.total * S.data.defaults.gst)}</td></tr>
        </tbody></table>
        <div class="bar" aria-hidden="true">${bar}</div>
        <div class="legend">${legend}</div>
        <div class="pricebox">
          <div class="pb tag"><b>${inr(p.tag)}</b><span>price tag at ×${S.markup.toFixed(2)}, with 3% GST</span></div>
          <div class="pb"><b>${inr(p.profit)}</b><span>profit: ${pct(p.profit / p.ex)} of the price before GST</span></div>
          <div class="pb"><b>${inr(p.net)}</b><span>kept after payment fee, shipping and ads</span></div>
        </div>
        <p class="check-line">${check}</p>
        <p class="tipline">Each gram less gold saves ${inr(perGram)} of cost (gold + labour), about ${inr(perGram * S.markup * (1 + S.data.defaults.gst))} off the price tag.
          ${goldShare > 0.65 ? `Gold is ${pct(goldShare)} of this piece's cost, and customers can price gold themselves, so a lighter version is the way to a better price.` : ''}</p>
      </div>
    </div>
    <details class="qs"><summary>Open questions for the maker (${q.questions.length})</summary>
      <ol>${q.questions.map(x => `<li>${esc(x)}</li>`).join('')}</ol></details>
  </article>`;
}

function renderEstimate() {
  const v = id => Number($(id).value) || 0;
  const g = v('#e-g');
  const cost = g * makerRate14() + v('#e-sct') * v('#e-sr') + v('#e-bct') * v('#e-br') + g * v('#e-lab') + v('#e-fix')
    + v('#e-pcs') * S.data.defaults.hallmark;
  const p = priceOf(cost);
  $('#e-out').innerHTML = `
    <div class="pb"><b>${inr(cost)}</b><span>cost at today's gold (${inr(makerRate14())}/g), with hallmark</span></div>
    <div class="pb tag"><b>${inr(p.tag)}</b><span>price tag at ×${S.markup.toFixed(2)}, with 3% GST</span></div>
    <div class="pb"><b>${inr(p.profit)}</b><span>profit · ${inr(p.net)} kept after selling costs</span></div>`;
}
