'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? escapeHtml(url.href) : '#';
  } catch {
    return '#';
  }
}

function renderReport(report) {
  const verdicts = {
    FAIL: { className: 'fail', title: 'The facts are out of sync.', label: 'Gate failed', description: 'Visible facts disagree with the English source or the page’s own structured data.' },
    INCOMPLETE: { className: 'incomplete', title: 'The full picture is still missing.', label: 'Verification incomplete', description: 'No disagreement was confirmed, but one or more pages could not be fully verified.' },
    PASS: { className: 'pass', title: 'Shared facts. Every locale.', label: 'Gate passed', description: 'Every checked fact agrees with the English source and its own structured data.' },
  };
  const verdict = verdicts[report.verdict] || verdicts.INCOMPLETE;
  const knownStatuses = new Set(['PASS', 'DRIFT', 'CONFLICT', 'UNKNOWN']);
  const badges = (statuses) => statuses.map((status) => {
    const className = knownStatuses.has(status) ? status.toLowerCase() : 'unknown';
    return `<span class="badge ${className}">${escapeHtml(status)}</span>`;
  }).join('');
  const rows = report.rows.map((row) => `<tr>
    <th scope="row" data-label="Locale"><a class="locale" href="${safeUrl(row.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.locale)}<span aria-hidden="true">↗</span></a></th>
    <td data-label="Fact">${escapeHtml(row.fact)}</td>
    <td data-label="HTTP"><span class="http">${escapeHtml(row.httpStatus ?? '—')}</span></td>
    <td data-label="Visible value" class="value">${escapeHtml(row.visibleValue ?? 'Not detected')}</td>
    <td data-label="JSON-LD values">${row.jsonLdValues.length ? row.jsonLdValues.map(escapeHtml).join('<br>') : '<span class="muted">None found</span>'}</td>
    <td data-label="Status"><div class="badges">${badges(row.statuses)}</div></td>
    <td data-label="Reason" class="reason">${escapeHtml(row.reason || '—')}</td>
  </tr>`).join('\n');
  const metrics = [
    ['total', 'Fact checks'], ['pass', 'Pass'], ['drift', 'Drift'], ['conflict', 'Conflict'], ['unknown', 'Unknown'],
  ].map(([key, label]) => `<div class="metric ${key}"><dt>${label}</dt><dd>${escapeHtml(report.summary[key])}</dd></div>`).join('');
  const baselines = Object.entries(report.source.facts).map(([fact, value]) =>
    `<span>${escapeHtml(fact)}: <strong>${escapeHtml(value ?? 'Unavailable')}</strong></span>`
  ).join('<span class="baseline-divider" aria-hidden="true"> · </span>');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%23111414' d='M0 0h32v32H0z'/%3E%3Cpath fill='%23b9df9b' d='M7 7h18v18H7z'/%3E%3Cpath fill='%23111414' d='M11 11h10v10H11z'/%3E%3C/svg%3E">
  <meta name="description" content="Truth Drift Gate checks prommer.net homepage facts against the English source and each page’s JSON-LD.">
  <title>Truth Drift Gate · prommer.net</title>
  <style>
    :root { color-scheme: dark; --bg:#111414; --surface:#181c1c; --line:#333a39; --text:#edf0e9; --muted:#a4afaa; --green:#b9df9b; --red:#ffb09e; --amber:#efd095; --blue:#bdd1e5; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:'Segoe UI',Helvetica,sans-serif; font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased; }
    a { color:inherit; text-underline-offset:4px; }
    a:focus-visible { outline:2px solid var(--green); outline-offset:5px; }
    .shell { width:min(1240px, calc(100% - 96px)); margin:0 auto; }
    .masthead { min-height:100px; display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:1px solid var(--line); }
    .brand { font-size:15px; font-weight:650; letter-spacing:-.3px; display:flex; align-items:center; gap:12px; }
    .brand-mark { width:20px; height:20px; border:1px solid var(--green); position:relative; }
    .brand-mark::after { content:''; position:absolute; inset:5px; background:var(--green); }
    .mono, .eyebrow, .badge, .metric dt, .locale, .http, thead, .section-label { font-family:'Cascadia Code','SFMono-Regular',Consolas,'Liberation Mono',monospace; }
    .site { color:var(--muted); font-size:12px; }
    .hero { padding:65px 0 43px; }
    .eyebrow { display:flex; align-items:center; gap:10px; font-size:11px; text-transform:uppercase; letter-spacing:1.6px; color:var(--muted); }
    .signal { width:7px; height:7px; border-radius:50%; background:currentColor; }
    .hero.fail .eyebrow { color:var(--red); }
    .hero.pass .eyebrow { color:var(--green); }
    .hero.incomplete .eyebrow { color:var(--blue); }
    h1 { max-width:830px; margin:23px 0 18px; font-size:clamp(38px,5.7vw,72px); line-height:1.06; font-weight:500; letter-spacing:-2.9px; }
    .description { max-width:650px; margin:0; color:var(--muted); font-size:16px; }
    .metrics { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); margin:0; border:1px solid var(--line); }
    .metric { padding:23px 25px 20px; border-right:1px solid var(--line); display:flex; flex-direction:column-reverse; gap:9px; }
    .metric:last-child { border-right:0; }
    .metric dt { font-size:10px; text-transform:uppercase; letter-spacing:1.2px; color:var(--muted); }
    .metric dd { margin:0; font-size:39px; line-height:1; font-variant-numeric:tabular-nums; letter-spacing:-1.5px; }
    .metric.pass dd { color:var(--green); } .metric.drift dd { color:var(--amber); } .metric.conflict dd { color:var(--red); } .metric.unknown dd { color:var(--blue); }
    .count-note { margin:10px 0 0; color:var(--muted); font-size:12px; }
    .results { padding-top:52px; }
    .section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; padding-bottom:17px; }
    h2 { margin:0; font-size:21px; font-weight:500; letter-spacing:-.5px; }
    .reference { margin:0; color:var(--muted); font-size:12px; max-width:70%; overflow-wrap:anywhere; }
    .reference strong { color:var(--text); font-weight:500; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    caption { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    thead { font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); background:var(--surface); }
    th, td { padding:18px 15px; border-bottom:1px solid var(--line); text-align:left; overflow-wrap:anywhere; }
    thead th { padding-top:13px; padding-bottom:13px; font-weight:400; }
    th:first-child, td:first-child { padding-left:17px; }
    th:nth-child(1) { width:7%; } th:nth-child(2) { width:9%; } th:nth-child(3) { width:7%; } th:nth-child(4) { width:15%; } th:nth-child(5) { width:17%; } th:nth-child(6) { width:21%; } th:nth-child(7) { width:24%; }
    tbody tr:hover { background:#181d1c; }
    .locale { font-size:12px; text-transform:uppercase; text-decoration:none; display:inline-flex; gap:9px; align-items:center; }
    .locale span { color:var(--muted); font-size:12px; }
    .http { color:var(--muted); font-size:12px; }
    .value { font-weight:500; }
    .badges { display:flex; flex-wrap:wrap; gap:6px; }
    .badge { font-size:10px; letter-spacing:.4px; padding:3px 7px; border:1px solid; line-height:1.5; border-radius:3px; white-space:nowrap; }
    .badge.pass { color:var(--green); border-color:#405437; background:#202b1d; }
    .badge.drift { color:var(--amber); border-color:#5c4e33; background:#2e281c; }
    .badge.conflict { color:var(--red); border-color:#634138; background:#30231e; }
    .badge.unknown { color:var(--blue); border-color:#41515f; background:#212a30; }
    .reason { font-size:12px; color:var(--muted); }
    .muted { color:var(--muted); }
    .context { display:grid; grid-template-columns:1fr 2fr; gap:48px; margin-top:50px; padding:30px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
    .section-label { font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--muted); }
    .context p { margin:0; max-width:690px; color:var(--muted); }
    .context strong { color:var(--text); font-weight:500; }
    footer { display:flex; justify-content:space-between; gap:18px; padding:22px 0 38px; color:var(--muted); font-size:11px; }
    footer time { overflow-wrap:anywhere; }
    @media (max-width:1000px) { .shell { width:calc(100% - 48px); } .metric { padding:20px 17px; } th,td { padding-left:10px; padding-right:10px; } }
    @media (max-width:760px) {
      .shell { width:calc(100% - 32px); } .masthead { min-height:76px; } .site { font-size:11px; }
      .hero { padding:42px 0 30px; } h1 { letter-spacing:-1.7px; } .description { font-size:14px; }
      .metrics { grid-template-columns:repeat(4,minmax(0,1fr)); } .metric { padding:18px 11px; } .metric.total { grid-column:1 / -1; flex-direction:row; align-items:center; justify-content:space-between; border-right:0; border-bottom:1px solid var(--line); } .metric dd { font-size:29px; } .metric dt { font-size:9px; letter-spacing:.6px; }
      .section-head { display:block; } .reference { margin-top:7px; max-width:none; } .results { padding-top:34px; }
      table,tbody { display:block; } thead { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; } tbody tr { display:grid; grid-template-columns:1fr 1fr; padding:16px; border:1px solid var(--line); margin-bottom:12px; background:var(--surface); gap:14px 18px; }
      th,td,th:first-child,td:first-child { display:block; border:0; padding:0; width:auto !important; font-size:13px; }
      td::before,tbody th::before { content:attr(data-label); display:block; font-family:'Cascadia Code',Consolas,monospace; font-size:9px; text-transform:uppercase; letter-spacing:.7px; color:var(--muted); margin-bottom:5px; font-weight:400; }
      td:nth-child(5),td:nth-child(6),td:nth-child(7) { grid-column:1 / -1; } td.reason { font-size:12px; }
      .context { grid-template-columns:1fr; gap:14px; margin-top:32px; padding:24px 0; font-size:14px; } footer { flex-direction:column; gap:7px; }
    }
    @media print { :root { --bg:#fff; --surface:#eee; --line:#bbb; --text:#111; --muted:#444; } body { print-color-adjust:exact; } .shell { width:100%; } .hero { padding:25px 0; } h1 { font-size:38px; } .metric dd { color:#111 !important; } tr { break-inside:avoid; } }
  </style>
</head>
<body>
  <div class="shell">
    <header class="masthead"><div class="brand"><span class="brand-mark" aria-hidden="true"></span>Truth Drift Gate</div><a class="site mono" href="https://prommer.net/">prommer.net ↗</a></header>
    <main>
      <section class="hero ${verdict.className}" aria-labelledby="verdict-title">
        <div class="eyebrow"><span class="signal" aria-hidden="true"></span>${verdict.label}</div>
        <h1 id="verdict-title">${verdict.title}</h1>
        <p class="description">${verdict.description}</p>
      </section>
      <dl class="metrics" aria-label="Run summary">${metrics}</dl>
      <p class="count-note">${escapeHtml(report.summary.locales)} locales · ${escapeHtml(report.summary.facts)} configured ${report.summary.facts === 1 ? 'fact' : 'facts'}. A fact check can have both DRIFT and CONFLICT. UNKNOWN is never counted as PASS.</p>
      <section class="results" aria-labelledby="results-title">
        <div class="section-head"><h2 id="results-title">Locale inspection</h2><p class="reference"><a href="${safeUrl(report.source.url)}">English source</a> · ${baselines}</p></div>
        <table><caption>Visible facts and structured data comparison for every locale homepage</caption><thead><tr><th scope="col">Locale</th><th scope="col">Fact</th><th scope="col">HTTP</th><th scope="col">Visible value</th><th scope="col">JSON-LD values</th><th scope="col">Status</th><th scope="col">Reason</th></tr></thead><tbody>${rows}</tbody></table>
      </section>
      <aside class="context" aria-labelledby="why-title"><h2 class="section-label" id="why-title">Why this matters</h2><p><strong>Humans read the page. Machines read its structured data.</strong> Search engines and AI agents read JSON-LD to understand the site. When it disagrees with visible copy, the site tells humans one city and machines another. Locale drift adds a different answer depending on the language a visitor chooses.</p></aside>
    </main>
    <footer><span>Run timestamp · <time datetime="${escapeHtml(report.timestamp)}">${escapeHtml(report.timestamp)} (UTC)</time></span><span class="mono">Visible copy / JSON-LD / EN source</span></footer>
  </div>
</body>
</html>\n`;
}

module.exports = { renderReport };
