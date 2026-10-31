/**
 * ui-common.js — shared UI pieces for V8 screens: date-range bar and interactive charts (plain HTML/SVG, no library).
 */
(window.V8Ext = window.V8Ext || []).push((ctx) => {
  const { state, h, ic } = ctx;
  const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
  const color = (i) => PALETTE[i % PALETTE.length];

  // ---- one shared date range for Analytics / Portfolio / Reports
  const range = { preset: 'year', from: '', to: '' };
  const getRange = () => Analytics.rangeFor(range.preset, new Date(), range);
  function rangeBar(onChange, presets) {
    const wrap = h('div', { class: 'rangebar' });
    const paint = () => {
      wrap.innerHTML = '';
      wrap.appendChild(h('div', { class: 'chips' }, Analytics.PRESETS.filter((p) => !presets || presets.includes(p[0])).map(([k, l]) => h('button', { class: 'chip' + (range.preset === k ? ' on' : ''), 'data-range': k, onclick: () => { range.preset = k; paint(); onChange(getRange()); } }, l))));
      if (range.preset === 'custom') {
        wrap.appendChild(h('div', { class: 'grid2' }, [
          h('div', { class: 'field' }, [h('label', {}, 'From'), h('input', { class: 'input', type: 'date', id: 'rFrom', value: range.from, onchange: (e) => { range.from = e.target.value; onChange(getRange()); } })]),
          h('div', { class: 'field' }, [h('label', {}, 'To'), h('input', { class: 'input', type: 'date', id: 'rTo', value: range.to, onchange: (e) => { range.to = e.target.value; onChange(getRange()); } })]),
        ]));
      }
    };
    paint();
    return wrap;
  }

  // ---- charts
  /** Interactive donut. entries = [[name, n]]. Tap a slice or a legend row -> onTap(name). */
  function donutChart(entries, o = {}) {
    const total = entries.reduce((a, e) => a + e[1], 0);
    const R = 42, C = 2 * Math.PI * R; let acc = 0;
    const wrap = h('div', { class: 'donut-wrap' });
    const center = { big: String(total), small: (o.unit || 'CASES') };
    const svgHost = h('div');
    const paintSvg = () => {
      const segs = entries.map(([, v], i) => { const len = total ? (v / total) * C : 0; const s = `<circle data-i="${i}" cx="60" cy="60" r="${R}" fill="none" stroke="${color(i)}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 1)} ${C - Math.max(0, len - 1)}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)" style="cursor:pointer"/>`; acc += len; return s; }).join('');
      svgHost.innerHTML = `<svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${o.label || 'Distribution'}"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line)" stroke-width="16"/>${segs}<text id="dBig" x="60" y="60" text-anchor="middle" font-size="24" font-weight="800" fill="var(--ink)">${center.big}</text><text id="dSmall" x="60" y="76" text-anchor="middle" font-size="9" fill="var(--muted)">${center.small}</text></svg>`;
      svgHost.querySelectorAll('circle[data-i]').forEach((c) => c.addEventListener('click', () => pick(Number(c.dataset.i))));
    };
    const pick = (i) => { const [n, v] = entries[i]; const big = svgHost.querySelector('#dBig'), sm = svgHost.querySelector('#dSmall'); big.textContent = v; sm.textContent = (n.length > 14 ? n.slice(0, 13) + '…' : n).toUpperCase() + ' · ' + Math.round((v / total) * 100) + '%'; if (o.onTap) legendRows[i].classList.add('hl'); };
    const legendRows = entries.map(([n, v], i) => h('button', { class: 'lg-row', onclick: () => { pick(i); o.onTap && o.onTap(n); } }, [h('i', { style: `background:${color(i)}` }), h('span', {}, n), h('b', {}, v)]));
    paintSvg();
    wrap.append(svgHost, h('div', { class: 'legend' }, legendRows));
    return total ? wrap : h('div', { class: 'muted' }, 'No data in this period.');
  }

  /** Horizontal bars. entries = [[name, n]]. */
  function hbars(entries, o = {}) {
    if (!entries.length) return h('div', { class: 'muted' }, 'No data in this period.');
    const max = Math.max(1, ...entries.map((e) => e[1])), total = entries.reduce((a, e) => a + e[1], 0);
    return h('div', {}, entries.slice(0, o.limit || 12).map(([name, n], i) => h(o.onTap ? 'button' : 'div', { class: 'bar-row', onclick: o.onTap ? () => o.onTap(name) : null }, [
      h('div', { class: 'top' }, [h('span', {}, name), h('b', {}, o.pct ? `${n} · ${Math.round((n / total) * 100)}%` : n)]),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(n / max) * 100}%;background:${o.color || color(i)}` })),
    ])));
  }

  /** Column chart with tap-to-read caption. */
  function columnChart(values, labels, o = {}) {
    const max = Math.max(1, ...values);
    const cap = h('div', { class: 'col-cap muted' }, o.hint || 'Tap a column for details');
    const cols = h('div', { class: 'cols' }, values.map((v, i) => h('button', { class: 'colb' + (o.active === i ? ' now' : ''), 'aria-label': `${labels[i]}: ${v}`, onclick: () => { cols.querySelectorAll('.colb').forEach((b) => b.classList.remove('sel')); cols.children[i].classList.add('sel'); cap.textContent = `${labels[i]}: ${v} ${o.unit || ''}`.trim(); o.onTap && o.onTap(i); } }, [
      h('b', {}, v || ''), h('span', { class: 'cbar', style: `height:${Math.max(3, (v / max) * 92)}px;background:${o.color || 'var(--c1)'}` }), h('small', {}, o.short ? o.short[i] : labels[i]),
    ])));
    return h('div', {}, [cols, cap]);
  }

  const qualityNote = () => h('div', { class: 'note', style: 'margin-top:10px' }, [ic('info', 'inl'), ' These counts describe your own workload and exposure. They are not measures of quality of care or of outcomes.']);
  const stat = (num, label, tone, onclick) => ctx.tile(num, label, tone, onclick);

  return { api: { rangeBar, getRange, donutChart, hbars, columnChart, qualityNote, stat, color, range } };
});
