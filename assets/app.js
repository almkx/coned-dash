// Con Edison Electric Usage
// Reads a billing-history CSV downloaded from a Con Edison account, keeps only the
// billing rows, works out every figure from them and draws each element marked
// data-draw="name". The file is read in the browser and is never uploaded anywhere.

// ---- Runtime: derived figures and drawings ----
const dash = (() => {
  const values = {};
  const calcs = [];
  const draws = new Map();
  return {
    colors: ['var(--series-1)', 'var(--series-2)'],
    calc(id, { inputs, fn }) { calcs.push({ id, inputs, fn }); },
    draw(name, fn) { draws.set(name, fn); },
    data(id) {
      if (!values.bills) return { status: 'loading', data: [] };
      return id in values ? { status: 'ok', data: values[id] } : { status: 'missing', data: [] };
    },
    load(bills) {
      values.bills = bills;
      calcs.forEach((c) => { values[c.id] = c.fn(...c.inputs.map((i) => values[i])); });
      this.redraw();
    },
    redraw() {
      draws.forEach((fn, name) => document.querySelectorAll(`[data-draw="${name}"]`).forEach((el) => fn(el)));
    }
  };
})();

// ---- Reading the Con Edison export ----
// The export starts with name, address and account lines, then a header row
// (TYPE, START DATE, END DATE, USAGE (kWh), COST, NOTES) and one row per bill.
// Only the four billing fields below are kept; everything above the header is ignored.
function parseConEd(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const headerAt = lines.findIndex((l) => {
    const cols = d3.csvParseRows(l)[0] || [];
    const keys = cols.map(key);
    return keys.includes('startdate') && keys.includes('enddate');
  });
  if (headerAt < 0) return [];
  const rows = d3.csvParseRows(lines.slice(headerAt).join('\n'));
  const head = rows[0].map(key);
  const find = (test) => head.findIndex(test);
  const iStart = find((h) => h === 'startdate');
  const iEnd = find((h) => h === 'enddate');
  const iKwh = find((h) => h.startsWith('usage'));
  const iCost = find((h) => h.startsWith('cost'));
  if (iKwh < 0 || iCost < 0) return [];
  const num = (s) => {
    const v = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''));
    return Number.isFinite(v) ? v : null;
  };
  const isoDate = (s) => {
    const t = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
  };
  const byStart = new Map();
  rows.slice(1).forEach((r) => {
    const start = isoDate(r[iStart]);
    const end = isoDate(r[iEnd]);
    const kwh = num(r[iKwh]);
    const cost = num(r[iCost]);
    if (!start || !end || end < start || kwh == null || kwh <= 0 || cost == null) return;
    byStart.set(start, { start_date: start, end_date: end, usage_kwh: kwh, cost_usd: cost });
  });
  return [...byStart.values()].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
}

// ---- Helpers ----
window.ce = (() => {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = {
    usd: d3.format('$,.2f'),
    n2: d3.format(',.2f'),
    int: d3.format(','),
    price: (v) => '$' + d3.format('.3f')(v),
    pct: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format('.1f')(Math.abs(v)) + '%',
    more: (v) => d3.format('.1f')(Math.abs(v)) + '% ' + (v >= 0 ? 'more' : 'less'),
    times: (v) => d3.format('.2f')(v) + '×',
    text: (v) => String(v)
  };
  const day = (s) => new Date(s + 'T00:00:00Z');
  const endExcl = (d) => d3.utcDay.offset(day(d.end_date), 1);
  const long = d3.utcFormat('%b %-d, %Y');
  const short = d3.utcFormat('%b %-d');
  const mid = (d) => new Date((day(d.start_date).getTime() + endExcl(d).getTime()) / 2);
  const periodLabel = (d) => short(day(d.start_date)) + ' – ' + long(day(d.end_date));

  // Each year keeps its color as years are added, and any six consecutive years all differ.
  const YEAR_COLORS = 6;
  const yearColor = (year) => `var(--series-${(year % YEAR_COLORS) + 1})`;

  function frame(el, H, legend, label) {
    el.replaceChildren();
    if (legend) {
      const lg = d3.select(el).append('div').attr('class', 'ce-legend');
      legend.forEach((l) => {
        const it = lg.append('span').attr('class', 'ce-leg');
        it.append('span').attr('class', 'ce-sw').style('background', l.color);
        it.append('span').text(l.label);
      });
    }
    const w = Math.max(260, el.clientWidth);
    const svg = d3.select(el).append('svg').attr('width', w).attr('height', H).attr('viewBox', `0 0 ${w} ${H}`).attr('role', 'img').attr('aria-label', label);
    const tip = d3.select(el).append('div').attr('class', 'ce-tip');
    return { svg, tip, w };
  }
  function textWidth(svg, strings) {
    const g = svg.append('g').attr('class', 'ce-axis');
    let m = 0;
    strings.forEach((s) => { m = Math.max(m, g.append('text').text(s).node().getComputedTextLength()); });
    g.remove();
    return m;
  }
  function placeTip(el, tip, x, y) {
    tip.style('display', 'grid');
    const n = tip.node(), tw = n.offsetWidth, th = n.offsetHeight, W = el.clientWidth;
    const top0 = el.querySelector('svg') ? el.querySelector('svg').offsetTop : 0;
    let left = x + 14;
    if (left + tw > W) left = x - tw - 14;
    if (left < 0) left = Math.max(0, W - tw);
    tip.style('left', left + 'px').style('top', Math.max(0, top0 + y - th / 2) + 'px');
  }
  function tipRows(tip, head, rows, foot) {
    tip.selectAll('*').remove();
    tip.append('div').attr('class', 'ce-tip-h').text(head);
    rows.forEach((r) => {
      const row = tip.append('div').attr('class', 'ce-tip-row');
      if (r.color) row.append('span').attr('class', 'ce-sw').style('background', r.color);
      row.append('span').text(r.k);
      row.append('b').text(r.v);
    });
    if (foot) tip.append('div').attr('class', 'ce-tip-foot').text(foot);
  }
  function ready(el, r) {
    if (r.status === 'ok' && Array.isArray(r.data) && r.data.length) return true;
    el.replaceChildren();
    const p = document.createElement('p');
    p.className = 'ce-empty';
    p.textContent = r.status === 'loading' ? 'Waiting for a CSV' : 'No data';
    el.append(p);
    return false;
  }
  function yAxis(svg, y, ticks, ml, x2, f) {
    svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'ce-grid')
      .attr('x1', ml).attr('x2', x2).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    svg.append('g').attr('class', 'ce-axis').selectAll('text').data(ticks).join('text')
      .attr('x', ml - 8).attr('y', (d) => y(d)).attr('dy', '0.32em').attr('text-anchor', 'end').text(f);
  }
  // Month labels along a time axis. Labels thin out to every 2nd, 3rd or 6th month as space
  // runs short, and to one label per year when even that doesn't fit.
  function timeAxis(svg, x, w, ml, mr, yBase) {
    const [d0, d1] = x.domain();
    const months = d3.utcMonth.range(d3.utcMonth.floor(d0), d1);
    const per = (w - ml - mr) / Math.max(1, months.length);
    const every = per >= 30 ? 1 : per >= 15 ? 2 : per >= 10 ? 3 : per >= 5 ? 6 : 12;
    const clampDate = (t) => new Date(Math.min(Math.max(t, d0), d1));
    const covered = (a, b) => (x(clampDate(b)) - x(clampDate(a))) / (x(b) - x(a));
    const bounds = months.slice(1).filter((m) => x(m) > ml && x(m) < w - mr);
    svg.append('g').selectAll('line').data(bounds).join('line').attr('class', 'ce-base')
      .attr('x1', (m) => x(m)).attr('x2', (m) => x(m)).attr('y1', yBase)
      .attr('y2', (m) => yBase + (m.getUTCMonth() === 0 ? (every >= 12 ? 20 : 34) : every >= 12 ? 0 : 4));
    const g = svg.append('g').attr('class', 'ce-axis');
    if (every >= 12) {
      const years = d3.utcYear.range(d3.utcYear.floor(d0), d1)
        .filter((y) => covered(y, d3.utcYear.offset(y, 1)) >= 0.4);
      g.selectAll('text').data(years).join('text')
        .attr('x', (y) => (x(clampDate(y)) + x(clampDate(d3.utcYear.offset(y, 1)))) / 2)
        .attr('y', yBase + 16).attr('text-anchor', 'middle').text(d3.utcFormat('%Y'));
      return;
    }
    const center = (m) => (x(clampDate(m)) + x(clampDate(d3.utcMonth.offset(m, 1)))) / 2;
    const shown = months.filter((m) => (m.getUTCFullYear() * 12 + m.getUTCMonth()) % every === 0 && covered(m, d3.utcMonth.offset(m, 1)) >= 0.6);
    g.selectAll('text.ce-m').data(shown).join('text').attr('class', 'ce-m')
      .attr('x', center).attr('y', yBase + 16).attr('text-anchor', 'middle')
      .text((m) => (per * every < 22 ? d3.utcFormat('%b')(m)[0] : d3.utcFormat('%b')(m)));
    const yearMarks = shown.filter((m, i) => i === 0 || m.getUTCFullYear() !== shown[i - 1].getUTCFullYear());
    g.selectAll('text.ce-y').data(yearMarks).join('text').attr('class', 'ce-y')
      .attr('x', center).attr('y', yBase + 31).attr('text-anchor', 'middle').text(d3.utcFormat('%Y'));
  }
  return { M, fmt, day, endExcl, mid, periodLabel, yearColor, YEAR_COLORS, frame, textWidth, placeTip, tipRows, ready, yAxis, timeAxis };
})();

// ---- Derived figures ----
dash.calc('bill_stats', {
  inputs: ['bills'],
  fn: (bills) => bills.map((b) => {
    const start = new Date(b.start_date + 'T00:00:00Z');
    const end = new Date(b.end_date + 'T00:00:00Z');
    const days = Math.round((end - start) / 86400000) + 1;
    const kwh = Number(b.usage_kwh);
    const cost = Number(b.cost_usd);
    const middle = new Date(start.getTime() + (end - start) / 2);
    return {
      start_date: b.start_date,
      end_date: b.end_date,
      days,
      kwh,
      cost,
      kwh_per_day: Math.round((kwh / days) * 100) / 100,
      price_per_kwh: Math.round((cost / kwh) * 1000) / 1000,
      usage_year: middle.getUTCFullYear(),
      usage_month: middle.getUTCMonth() + 1
    };
  })
});

// The latest year against the year before, over the months that have a bill in both.
dash.calc('compare', {
  inputs: ['bill_stats'],
  fn: (bill_stats) => {
    if (!bill_stats.length) return [];
    const current = Math.max(...bill_stats.map((b) => b.usage_year));
    const monthsOf = (y) => new Set(bill_stats.filter((b) => b.usage_year === y).map((b) => b.usage_month));
    const before = monthsOf(current - 1);
    const months = [...monthsOf(current)].filter((m) => before.has(m)).sort((a, b) => a - b);
    if (!months.length) return [];
    const contiguous = months.every((m, i) => i === 0 || m === months[i - 1] + 1);
    const span = months.length === 1 ? ce.M[months[0] - 1]
      : contiguous ? ce.M[months[0] - 1] + '–' + ce.M[months[months.length - 1] - 1]
      : months.length + ' matching months of';
    return [current - 1, current].map((year) => {
      const bs = bill_stats.filter((b) => b.usage_year === year && months.includes(b.usage_month));
      const kwh = bs.reduce((s, b) => s + b.kwh, 0);
      const days = bs.reduce((s, b) => s + b.days, 0);
      const cost = Math.round(bs.reduce((s, b) => s + b.cost, 0) * 100) / 100;
      return {
        year,
        label: span + ' ' + year,
        bills: bs.length,
        kwh,
        days,
        cost,
        kwh_per_day: days ? Math.round((kwh / days) * 100) / 100 : null,
        price_per_kwh: kwh ? Math.round((cost / kwh) * 1000) / 1000 : null
      };
    });
  }
});

dash.calc('change', {
  inputs: ['compare'],
  fn: (compare) => {
    if (compare.length < 2 || !compare[0].kwh) return [];
    const [before, now] = compare;
    const pct = (a, b) => Math.round((b / a - 1) * 1000) / 10;
    return [{
      kwh_pct: pct(before.kwh, now.kwh),
      cost_pct: pct(before.cost, now.cost),
      price_pct: pct(before.cost / before.kwh, now.cost / now.kwh)
    }];
  }
});

// Average kWh per day in the latest summer (Jun–Aug, all three billed) against the winter
// just before it (Dec–Feb), and the same ratio for the year before.
dash.calc('season', {
  inputs: ['bill_stats'],
  fn: (bill_stats) => {
    const pick = (year, months) => {
      const bs = months.map(([dy, m]) => bill_stats.filter((b) => b.usage_year === year + dy && b.usage_month === m));
      if (bs.some((g) => !g.length)) return null;
      const all = bs.flat();
      return all.reduce((s, b) => s + b.kwh, 0) / all.reduce((s, b) => s + b.days, 0);
    };
    const summer = (y) => pick(y, [[0, 6], [0, 7], [0, 8]]);
    const winter = (y) => pick(y, [[-1, 12], [0, 1], [0, 2]]);
    const years = [...new Set(bill_stats.map((b) => b.usage_year))].sort((a, b) => b - a);
    const y = years.find((yr) => summer(yr) != null && winter(yr) != null);
    if (y == null) return [];
    const r2 = (v) => Math.round(v * 100) / 100;
    const ratio = summer(y) / winter(y);
    const prev = summer(y - 1) != null && winter(y - 1) != null ? summer(y - 1) / winter(y - 1) : null;
    return [{
      year: y,
      ratio: r2(ratio),
      prev_ratio: prev == null ? null : r2(prev),
      ratio_pct: prev == null ? null : Math.round((ratio / prev - 1) * 1000) / 10
    }];
  }
});

dash.calc('extremes', {
  inputs: ['bill_stats'],
  fn: (bill_stats) => {
    if (!bill_stats.length) return [];
    const current = Math.max(...bill_stats.map((b) => b.usage_year));
    const changes = bill_stats.filter((b) => b.usage_year === current).map((b) => {
      const before = bill_stats.find((p) => p.usage_year === current - 1 && p.usage_month === b.usage_month);
      return before ? { month: ce.M[b.usage_month - 1], pct: Math.round((b.kwh / before.kwh - 1) * 1000) / 10 } : null;
    }).filter(Boolean);
    if (!changes.length) return [];
    const lo = changes.reduce((a, b) => (b.pct < a.pct ? b : a));
    const hi = changes.reduce((a, b) => (b.pct > a.pct ? b : a));
    return [{ min_month: lo.month, min_pct: lo.pct, max_month: hi.month, max_pct: hi.pct }];
  }
});

// A straight line of bill cost against kWh: the slope is the cost of each extra kWh,
// the intercept the part of a bill that doesn't depend on use.
dash.calc('fit', {
  inputs: ['bill_stats'],
  fn: (bill_stats) => {
    const n = bill_stats.length;
    if (n < 3) return [];
    const mx = bill_stats.reduce((s, b) => s + b.kwh, 0) / n;
    const my = bill_stats.reduce((s, b) => s + b.cost, 0) / n;
    let sxy = 0, sxx = 0;
    bill_stats.forEach((b) => { sxy += (b.kwh - mx) * (b.cost - my); sxx += (b.kwh - mx) ** 2; });
    if (!sxx) return [];
    const slope = sxy / sxx;
    return [{ per_kwh: Math.round(slope * 1000) / 1000, fixed: Math.round((my - slope * mx) * 100) / 100 }];
  }
});

// ---- Drawings ----
dash.draw('num', (el) => {
  const r = dash.data(el.dataset.source);
  el.classList.remove('ce-good', 'ce-bad');
  const row = r.status === 'ok' && Array.isArray(r.data) ? r.data[Number(el.dataset.row || 0)] : null;
  const v = row ? row[el.dataset.field] : null;
  if (v == null || v === '') { el.textContent = '—'; return; }
  el.textContent = (ce.fmt[el.dataset.fmt] || String)(v);
  if (el.dataset.good && typeof v === 'number' && v !== 0) {
    el.classList.add((v < 0) === (el.dataset.good === 'down') ? 'ce-good' : 'ce-bad');
  }
});

dash.draw('fit-why', (el) => {
  const r = dash.data('fit');
  const f = r.status === 'ok' && r.data.length ? r.data[0] : null;
  el.hidden = !f || !(f.fixed > 0);
});

dash.draw('verdict', (el) => {
  const r = dash.data('change');
  const c = r.status === 'ok' && r.data.length ? r.data[0] : null;
  const priceLed = c ? Math.abs(c.price_pct) >= Math.abs(c.kwh_pct) / 2 : false;
  const p = el.parentElement;
  if (!p) return;
  p.querySelectorAll('.ce-v-use').forEach((n) => { n.hidden = !c || priceLed; });
  p.querySelectorAll('.ce-v-price').forEach((n) => { n.hidden = !c || !priceLed; });
});

// One line per year, Jan to Dec. Every year with at least two bills gets a line,
// up to the most recent six (one color each).
dash.draw('yoy', (el) => {
  const r = dash.data('bill_stats');
  const skipNote = el.parentElement && el.parentElement.querySelector('.ce-yoy-skip');
  if (skipNote) skipNote.hidden = true;
  if (!ce.ready(el, r)) return;
  const rows = r.data;
  const allYears = [...new Set(rows.map((d) => d.usage_year))].sort((a, b) => a - b);
  const count = (y) => rows.filter((d) => d.usage_year === y).length;
  const years = allYears.filter((y) => count(y) >= 2).slice(-ce.YEAR_COLORS);
  const left = allYears.filter((y) => !years.includes(y));
  if (skipNote && left.length) {
    const few = left.filter((y) => count(y) < 2);
    const old = left.filter((y) => count(y) >= 2);
    const parts = [];
    if (few.length) parts.push(few.join(', ') + (few.length === 1 ? ' has' : ' have') + ' only one bill');
    if (old.length) parts.push(old.join(', ') + (old.length === 1 ? ' is' : ' are') + ' older than the six most recent years');
    skipNote.textContent = 'Not drawn: ' + parts.join('; ') + '.';
    skipNote.hidden = false;
  }
  if (!years.length) { el.replaceChildren(); return; }
  const newest = years[years.length - 1];
  const series = years.map((year) => ({
    year, color: ce.yearColor(year), newest: year === newest,
    pts: rows.filter((d) => d.usage_year === year).sort((a, b) => a.usage_month - b.usage_month)
  }));
  const H = 300;
  const { svg, tip, w } = ce.frame(el, H, series.map((s) => ({ label: String(s.year), color: s.color })).reverse(),
    'Line chart of kWh used by month for ' + years.join(', '));
  const narrow = w < 520;
  const yf = d3.format(',');
  const y = d3.scaleLinear().domain([0, d3.max(series.flatMap((s) => s.pts), (d) => d.kwh) * 1.08]).nice();
  const ticks = y.ticks(5);
  const ml = ce.textWidth(svg, ticks.map(yf)) + 12;
  const mr = ce.textWidth(svg, years.map(String)) + 16;
  const mt = 10, mb = 28;
  const months = d3.range(1, 13);
  const x = d3.scalePoint().domain(months).range([ml, w - mr]).padding(0.4);
  y.range([H - mb, mt]);
  ce.yAxis(svg, y, ticks, ml, w - mr, yf);
  svg.append('g').attr('class', 'ce-axis').selectAll('text').data(months).join('text')
    .attr('x', (m) => x(m)).attr('y', H - 8).attr('text-anchor', 'middle').text((m) => (narrow ? ce.M[m - 1][0] : ce.M[m - 1]));
  const cross = svg.append('line').attr('class', 'ce-cross').attr('y1', mt).attr('y2', H - mb).style('opacity', 0);
  const line = d3.line().x((d) => x(d.usage_month)).y((d) => y(d.kwh));
  series.forEach((s) => {
    svg.append('path').datum(s.pts).attr('d', line).attr('fill', 'none').style('stroke', s.color)
      .attr('stroke-width', s.newest ? 2.5 : 1.75).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    svg.append('g').selectAll('circle').data(s.pts).join('circle')
      .attr('cx', (d) => x(d.usage_month)).attr('cy', (d) => y(d.kwh)).attr('r', s.newest ? 4 : 3.25)
      .style('fill', s.color).style('stroke', 'var(--color-bg)').attr('stroke-width', 2);
  });
  // Year labels at each line's end, pushed apart where they would overlap.
  const ends = series.map((s) => {
    const l = s.pts[s.pts.length - 1];
    return { s, x: x(l.usage_month) + 9, y: y(l.kwh) };
  }).sort((a, b) => a.y - b.y);
  ends.forEach((e, i) => {
    ends.slice(0, i).forEach((p) => {
      if (Math.abs(p.x - e.x) < 40 && e.y - p.y < 13) e.y = p.y + 13;
    });
  });
  svg.append('g').attr('class', 'ce-endlabel').selectAll('text').data(ends).join('text')
    .attr('x', (d) => d.x).attr('y', (d) => d.y).attr('dy', '0.32em').text((d) => d.s.year);
  const show = (ev) => {
    const [px] = d3.pointer(ev, svg.node());
    const m = d3.least(months, (mm) => Math.abs(x(mm) - px));
    const vals = series.map((s) => ({ s, d: s.pts.find((p) => p.usage_month === m) }));
    const have = vals.filter((v) => v.d);
    if (!have.length) { tip.style('display', 'none'); cross.style('opacity', 0); return; }
    cross.attr('x1', x(m)).attr('x2', x(m)).style('opacity', 1);
    const a = vals[vals.length - 2], b = vals[vals.length - 1];
    const foot = a && a.d && b.d ? ce.fmt.pct((b.d.kwh / a.d.kwh - 1) * 100) + ' vs ' + a.s.year : null;
    ce.tipRows(tip, ce.M[m - 1] + ' · kWh used',
      vals.slice().reverse().map((v) => ({ color: v.s.color, k: String(v.s.year), v: v.d ? yf(v.d.kwh) + ' kWh' : 'no bill' })), foot);
    ce.placeTip(el, tip, x(m), d3.mean(have, (v) => y(v.d.kwh)));
  };
  svg.append('rect').attr('x', ml - 10).attr('y', 0).attr('width', w - mr - ml + 20).attr('height', H)
    .attr('fill', 'transparent').style('cursor', 'crosshair')
    .on('pointermove', show).on('pointerdown', show)
    .on('pointerleave', () => { tip.style('display', 'none'); cross.style('opacity', 0); });
});

dash.draw('overlay', (el) => {
  const r = dash.data('bill_stats');
  if (!ce.ready(el, r)) return;
  const rows = [...r.data].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const cK = dash.colors[0], cC = dash.colors[1];
  const H = 312;
  const { svg, tip, w } = ce.frame(el, H, [
    { label: 'kWh used (left axis)', color: cK },
    { label: 'Bill total (right axis)', color: cC }
  ], 'Line chart of kWh used and bill total for each bill, on separate scales');
  const yK = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.kwh) * 1.08]).nice(5);
  const kt = yK.ticks(5);
  const n = kt.length - 1;
  yK.domain([0, kt[n]]);
  const raw = (d3.max(rows, (d) => d.cost) * 1.08) / n;
  const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p10).find((s) => s >= raw);
  const yC = d3.scaleLinear().domain([0, step * n]);
  const ct = kt.map((_, i) => i * step);
  const kf = d3.format(','), cf = (v) => '$' + d3.format(',')(v);
  const ml = ce.textWidth(svg, kt.map(kf).concat(['kWh'])) + 12;
  const mr = ce.textWidth(svg, ct.map(cf).concat(['Bill'])) + 12;
  const mt = 24, mb = 40;
  const x = d3.scaleUtc().domain([ce.day(rows[0].start_date), ce.endExcl(rows[rows.length - 1])]).range([ml, w - mr]);
  yK.range([H - mb, mt]);
  yC.range([H - mb, mt]);
  ce.yAxis(svg, yK, kt, ml, w - mr, kf);
  svg.append('g').attr('class', 'ce-axis').selectAll('text').data(ct).join('text')
    .attr('x', w - mr + 8).attr('y', (d) => yC(d)).attr('dy', '0.32em').attr('text-anchor', 'start').text(cf);
  const units = svg.append('g').attr('class', 'ce-axis');
  units.append('text').attr('x', ml - 8).attr('y', mt - 12).attr('text-anchor', 'end').text('kWh');
  units.append('text').attr('x', w - mr + 8).attr('y', mt - 12).attr('text-anchor', 'start').text('Bill');
  ce.timeAxis(svg, x, w, ml, mr, H - mb);
  const cross = svg.append('line').attr('class', 'ce-cross').attr('y1', mt).attr('y2', H - mb).style('opacity', 0);
  svg.append('path').datum(rows).attr('fill', 'none').style('stroke', cK).attr('stroke-width', 2)
    .attr('stroke-linejoin', 'round').attr('d', d3.line().x((d) => x(ce.mid(d))).y((d) => yK(d.kwh)));
  svg.append('path').datum(rows).attr('fill', 'none').style('stroke', cC).attr('stroke-width', 2)
    .attr('stroke-linejoin', 'round').attr('d', d3.line().x((d) => x(ce.mid(d))).y((d) => yC(d.cost)));
  svg.append('g').selectAll('circle').data(rows).join('circle')
    .attr('cx', (d) => x(ce.mid(d))).attr('cy', (d) => yK(d.kwh)).attr('r', 4)
    .style('fill', cK).style('stroke', 'var(--color-bg)').attr('stroke-width', 2);
  svg.append('g').selectAll('rect').data(rows).join('rect')
    .attr('x', (d) => x(ce.mid(d)) - 4).attr('y', (d) => yC(d.cost) - 4).attr('width', 8).attr('height', 8).attr('rx', 1.5)
    .style('fill', cC).style('stroke', 'var(--color-bg)').attr('stroke-width', 2);
  const show = (ev) => {
    const [px] = d3.pointer(ev, svg.node());
    const d = d3.least(rows, (b) => Math.abs(x(ce.mid(b)) - px));
    cross.attr('x1', x(ce.mid(d))).attr('x2', x(ce.mid(d))).style('opacity', 1);
    ce.tipRows(tip, ce.periodLabel(d), [
      { color: cK, k: 'Used', v: kf(d.kwh) + ' kWh' },
      { color: cC, k: 'Bill', v: ce.fmt.usd(d.cost) }
    ], ce.fmt.price(d.price_per_kwh) + ' per kWh · ' + d.days + ' days');
    ce.placeTip(el, tip, x(ce.mid(d)), (yK(d.kwh) + yC(d.cost)) / 2);
  };
  svg.append('rect').attr('x', ml - 10).attr('y', 0).attr('width', w - mr - ml + 20).attr('height', H)
    .attr('fill', 'transparent').style('cursor', 'crosshair')
    .on('pointermove', show).on('pointerdown', show)
    .on('pointerleave', () => { tip.style('display', 'none'); cross.style('opacity', 0); });
});

dash.draw('price', (el) => {
  const r = dash.data('bill_stats');
  if (!ce.ready(el, r)) return;
  const rows = [...r.data].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const mid = (d) => new Date((ce.day(d.start_date).getTime() + ce.endExcl(d).getTime()) / 2);
  const H = 252;
  const { svg, tip, w } = ce.frame(el, H, null, 'Line chart of the average price per kWh of each bill over time');
  const ext = d3.extent(rows, (d) => d.price_per_kwh);
  const y = d3.scaleLinear().domain([ext[0] - 0.03, ext[1] + 0.02]).nice();
  const ticks = y.ticks(4);
  const yf = d3.format('$.2f');
  const ml = ce.textWidth(svg, ticks.map(yf)) + 12, mr = 10, mt = 10, mb = 40;
  const x = d3.scaleUtc().domain([ce.day(rows[0].start_date), ce.endExcl(rows[rows.length - 1])]).range([ml, w - mr]);
  y.range([H - mb, mt]);
  ce.yAxis(svg, y, ticks, ml, w - mr, yf);
  ce.timeAxis(svg, x, w, ml, mr, H - mb);
  const cross = svg.append('line').attr('class', 'ce-cross').attr('y1', mt).attr('y2', H - mb).style('opacity', 0);
  svg.append('path').datum(rows).attr('fill', 'none').style('stroke', dash.colors[0]).attr('stroke-width', 2)
    .attr('stroke-linejoin', 'round').attr('d', d3.line().x((d) => x(mid(d))).y((d) => y(d.price_per_kwh)));
  svg.append('g').selectAll('circle').data(rows).join('circle')
    .attr('cx', (d) => x(mid(d))).attr('cy', (d) => y(d.price_per_kwh)).attr('r', 4)
    .style('fill', dash.colors[0]).style('stroke', 'var(--color-bg)').attr('stroke-width', 2);
  const show = (ev) => {
    const [px] = d3.pointer(ev, svg.node());
    const d = d3.least(rows, (b) => Math.abs(x(mid(b)) - px));
    cross.attr('x1', x(mid(d))).attr('x2', x(mid(d))).style('opacity', 1);
    ce.tipRows(tip, ce.periodLabel(d), [
      { k: 'Price', v: ce.fmt.price(d.price_per_kwh) + '/kWh' },
      { k: 'Cost', v: ce.fmt.usd(d.cost) },
      { k: 'Used', v: ce.fmt.int(d.kwh) + ' kWh' }
    ]);
    ce.placeTip(el, tip, x(mid(d)), y(d.price_per_kwh));
  };
  svg.append('rect').attr('x', ml - 10).attr('y', 0).attr('width', w - mr - ml + 20).attr('height', H)
    .attr('fill', 'transparent').style('cursor', 'crosshair')
    .on('pointermove', show).on('pointerdown', show)
    .on('pointerleave', () => { tip.style('display', 'none'); cross.style('opacity', 0); });
});

dash.draw('rows', (tb) => {
  const r = dash.data('bill_stats');
  if (r.status !== 'ok' || !Array.isArray(r.data)) { tb.replaceChildren(); return; }
  const f = d3.utcFormat('%b %-d, %Y');
  const rows = [...r.data].sort((a, b) => (a.end_date < b.end_date ? 1 : -1));
  tb.replaceChildren(...rows.map((d) => {
    const tr = document.createElement('tr');
    [f(ce.day(d.start_date)), f(ce.day(d.end_date)), d.days, ce.fmt.int(d.kwh), ce.fmt.n2(d.kwh_per_day), ce.fmt.usd(d.cost), ce.fmt.price(d.price_per_kwh)]
      .forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i > 1) td.className = 'ce-num';
        tr.append(td);
      });
    return tr;
  }));
});

// ---- Loading the CSV ----
// The reader picks their CSV (or drops it on the page). Chrome and Edge remember that choice,
// so later visits only ask to allow access. The file is only read locally.
const loaderUI = {
  box: document.getElementById('loader'),
  msg: document.getElementById('loader-msg'),
  allow: document.getElementById('loader-allow'),
  pick: document.getElementById('loader-pick'),
  input: document.getElementById('loader-input'),
  source: document.getElementById('source-line'),
  sourceName: document.getElementById('source-name'),
  sourceSummary: document.getElementById('source-summary'),
  change: document.getElementById('source-change')
};
const DEFAULT_MSG = loaderUI.msg.textContent;
let savedHandle = null;
let loaded = false;

const store = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('coned-dashboard', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('files');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  };
});
const getHandle = () => store('readonly', (s) => s.get('csv')).catch(() => null);
const setHandle = (h) => store('readwrite', (s) => s.put(h, 'csv')).catch(() => {});
const forgetHandle = () => store('readwrite', (s) => s.delete('csv')).catch(() => {});

function showLoader(message, handle) {
  savedHandle = handle || null;
  loaderUI.msg.textContent = message || DEFAULT_MSG;
  loaderUI.allow.hidden = !handle;
  if (handle) loaderUI.allow.textContent = 'Load ' + handle.name;
  loaderUI.pick.textContent = handle ? 'Choose a different file' : 'Choose CSV';
  loaderUI.box.hidden = false;
}

function useText(text, name) {
  const bills = parseConEd(text);
  if (!bills.length) {
    showLoader(`No billing rows were found in ${name}. Choose the CSV downloaded from your Con Edison account.`, null);
    return false;
  }
  loaded = true;
  loaderUI.box.hidden = true;
  const long = d3.utcFormat('%b %-d, %Y');
  loaderUI.sourceName.textContent = name;
  loaderUI.sourceSummary.textContent = `${bills.length} bills, ${long(ce.day(bills[0].start_date))} – ${long(ce.day(bills[bills.length - 1].end_date))}`;
  loaderUI.source.hidden = false;
  dash.load(bills);
  return true;
}
const useFile = async (file) => useText(await file.text(), file.name);
async function useHandle(handle) {
  try {
    return await useFile(await handle.getFile());
  } catch {
    await forgetHandle();
    showLoader(`${handle.name} couldn't be opened. It may have been moved or renamed; choose it again.`, null);
    return false;
  }
}

async function chooseFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        id: 'coned-csv',
        types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }]
      });
      await setHandle(handle);
      await useHandle(handle);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  loaderUI.input.value = '';
  loaderUI.input.click();
}

loaderUI.pick.addEventListener('click', chooseFile);
loaderUI.change.addEventListener('click', chooseFile);
loaderUI.input.addEventListener('change', () => { if (loaderUI.input.files[0]) useFile(loaderUI.input.files[0]); });
loaderUI.allow.addEventListener('click', async () => {
  const handle = savedHandle;
  if (!handle) return;
  try {
    if ((await handle.requestPermission({ mode: 'read' })) === 'granted') { await useHandle(handle); return; }
  } catch { /* fall through */ }
  showLoader('Access was not allowed. Allow it, or choose the file instead.', handle);
});

// Dropping the CSV anywhere on the page loads it (and, in Chrome and Edge, remembers it).
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const item = [...(e.dataTransfer.items || [])].find((i) => i.kind === 'file');
  if (!item) return;
  const handle = item.getAsFileSystemHandle ? await item.getAsFileSystemHandle().catch(() => null) : null;
  if (handle && handle.kind === 'file') {
    await setHandle(handle);
    await useHandle(handle);
  } else {
    await useFile(item.getAsFile());
  }
});

async function start() {
  dash.redraw();
  // A file picked or dropped while this check runs wins; don't bring the prompt back over it.
  const handle = await getHandle();
  if (loaded) return;
  if (handle) {
    let state = 'prompt';
    try { state = await handle.queryPermission({ mode: 'read' }); } catch { /* ask below */ }
    if (loaded) return;
    if (state === 'granted') { await useHandle(handle); return; }
    showLoader(`Allow access to ${handle.name} to build the dashboard.`, handle);
    return;
  }
  showLoader();
}

start();
let lastWidth = document.documentElement.clientWidth;
window.addEventListener('resize', () => {
  const w = document.documentElement.clientWidth;
  if (w === lastWidth) return;
  lastWidth = w;
  requestAnimationFrame(() => dash.redraw());
});
