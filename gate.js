'use strict';

const cheerio = require('cheerio');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const LOCALES = ['en', 'de', 'es', 'fr', 'pt', 'it', 'nl', 'fi', 'sv', 'pl', 'id', 'da', 'cs'];
const FACTS = require('./facts');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20000;

function pageUrl(locale) {
  return locale === 'en' ? 'https://prommer.net/' : `https://prommer.net/${locale}/`;
}

function validateFacts(factsConfig) {
  if (!Array.isArray(factsConfig) || !factsConfig.length) throw new Error('Configure at least one fact in facts.js');
  const names = new Set();
  const $ = cheerio.load('');
  const nonemptyString = value => typeof value === 'string' && value.trim().length > 0;
  for (const fact of factsConfig) {
    if (!fact || !nonemptyString(fact.name) || !nonemptyString(fact.jsonLdKey)) throw new Error('Every fact needs a name and jsonLdKey');
    if (names.has(fact.name)) throw new Error(`Duplicate fact name: ${fact.name}`);
    names.add(fact.name);
    for (const key of ['values', 'selectors']) {
      if (!Array.isArray(fact[key]) || !fact[key].length || !fact[key].every(nonemptyString)) {
        throw new Error(`Fact ${fact.name} needs nonempty string ${key}`);
      }
    }
    for (const selector of fact.selectors) $(selector);
  }
}

function extractPage(html, factsConfig = FACTS) {
  validateFacts(factsConfig);
  const $ = cheerio.load(html);
  const isHidden = element => {
    const node = $(element);
    return ['script', 'style', 'template'].includes(element.name) || node.attr('hidden') !== undefined ||
      (node.attr('aria-hidden') || '').toLowerCase() === 'true' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(node.attr('style') || '');
  };
  const facts = factsConfig.map(config => {
    let visibleValue = null;
    for (const selector of config.selectors) {
      for (const element of $(selector).toArray()) {
        if ($(element).parents().addBack().toArray().some(isHidden)) continue;
        const visibleElement = $(element).clone();
        visibleElement.find('*').filter((_, child) => isHidden(child)).remove();
        const text = visibleElement.text().replace(/\s+/g, ' ').trim().toLowerCase();
        visibleValue = config.values.find(value => text.includes(value.toLowerCase())) || null;
        if (visibleValue !== null) break;
      }
      if (visibleValue !== null) break;
    }
    return { fact: config.name, visibleValue, jsonLdValues: [] };
  });

  const warnings = [];
  $('script').each((index, element) => {
    if (($(element).attr('type') || '').trim().toLowerCase() !== 'application/ld+json') return;
    let data;
    try {
      data = JSON.parse($(element).html() || '');
    } catch {
      warnings.push(`Invalid JSON-LD in script ${index + 1}`);
      return;
    }
    // An iterative walk also handles deeply nested documents without stack overflow.
    const pending = [data];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        pending.push(...value.slice().reverse());
        continue;
      }
      for (let index = 0; index < factsConfig.length; index++) {
        const key = factsConfig[index].jsonLdKey;
        if (!Object.hasOwn(value, key)) continue;
        const values = Array.isArray(value[key]) ? value[key] : [value[key]];
        for (const item of values) {
          if (typeof item === 'string') facts[index].jsonLdValues.push(item.trim());
        }
      }
      pending.push(...Object.values(value).reverse());
    }
  });
  const isRedirectStub = $('meta').toArray().some(element =>
    (($(element).attr('http-equiv') || '').trim().toLowerCase() === 'refresh') &&
    /\burl\s*=/i.test($(element).attr('content') || '')
  );
  const city = facts.find(fact => fact.fact === 'city');
  return { facts, visibleCity: city?.visibleValue ?? null, jsonLdCities: city?.jsonLdValues ?? [], isRedirectStub, warnings };
}

async function fetchFacts(locale, fetchImpl = fetch, factsConfig = FACTS) {
  validateFacts(factsConfig);
  const rows = factsConfig.map(config => ({ locale, fact: config.name, url: pageUrl(locale), httpStatus: null, visibleValue: null, jsonLdValues: [], statuses: [], reason: null }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(pageUrl(locale), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    for (const row of rows) row.httpStatus = response.status;
    if (response.status !== 200) {
      for (const row of rows) {
        row.statuses = ['UNKNOWN'];
        row.reason = `HTTP ${response.status}`;
      }
      // Release the body without parsing an error page as site content.
      if (response.body && typeof response.body.cancel === 'function') await response.body.cancel();
    } else {
      const extracted = extractPage(await response.text(), factsConfig);
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        Object.assign(row, extracted.facts[index]);
        const reasons = [...extracted.warnings];
        if (extracted.isRedirectStub) {
          row.statuses = ['UNKNOWN'];
          reasons.unshift('Meta-refresh redirect stub');
        } else if (row.visibleValue === null) {
          row.statuses = ['UNKNOWN'];
          reasons.unshift(`No recognized ${row.fact} in ${factsConfig[index].selectors.join(' or ')}`);
        }
        row.reason = reasons.join('; ') || null;
      }
    }
  } catch (error) {
    for (const row of rows) {
      row.statuses = ['UNKNOWN'];
      row.reason = controller.signal.aborted ? `Fetch timed out after ${TIMEOUT_MS / 1000}s` : `Fetch error: ${error.message || String(error)}`;
    }
  } finally {
    clearTimeout(timer);
  }
  return rows.map(withCityAliases);
}

function withCityAliases(row) {
  return row.fact === 'city' ? { ...row, visibleCity: row.visibleValue, jsonLdCities: [...row.jsonLdValues] } : row;
}

async function fetchPage(locale, fetchImpl = fetch) {
  return (await fetchFacts(locale, fetchImpl))[0];
}

function evaluateRows(inputRows) {
  const rows = inputRows.map(row => withCityAliases({ ...row, fact: row.fact ?? 'city', visibleValue: row.visibleValue !== undefined ? row.visibleValue : row.visibleCity, jsonLdValues: [...(row.jsonLdValues ?? row.jsonLdCities)], statuses: [...row.statuses] }));
  const sourceFacts = Object.fromEntries(rows.filter(row => row.locale === 'en').map(row => [row.fact,
    row.httpStatus === 200 && row.visibleValue !== null && !row.statuses.includes('UNKNOWN') ? row.visibleValue : null,
  ]));
  for (const row of rows) {
    if (row.statuses.includes('UNKNOWN') || row.httpStatus !== 200 || row.visibleValue === null) {
      row.statuses = ['UNKNOWN'];
      row.reason ||= row.httpStatus !== 200 ? (row.httpStatus === null ? 'Fetch failed' : `HTTP ${row.httpStatus}`) : `No recognized visible ${row.fact}`;
      continue;
    }
    row.statuses = [];
    const reasons = row.reason ? [row.reason] : [];
    if (!row.jsonLdValues.includes(row.visibleValue)) {
      row.statuses.push('CONFLICT');
      reasons.push(row.jsonLdValues.length ? `Visible ${row.fact} is absent from this page’s JSON-LD values` : `No JSON-LD values found for ${row.fact}`);
    }
    if (Object.hasOwn(sourceFacts, row.fact) && sourceFacts[row.fact] != null) {
      if (row.visibleValue !== sourceFacts[row.fact]) {
        row.statuses.push('DRIFT');
        reasons.push(`Visible ${row.fact} differs from EN (${sourceFacts[row.fact]})`);
      }
    } else {
      reasons.push(`EN source unavailable for ${row.fact}; drift comparison could not be verified`);
      if (!row.statuses.length) row.statuses.push('UNKNOWN');
    }
    if (!row.statuses.length) row.statuses.push('PASS');
    row.reason = reasons.join('; ') || null;
  }
  const summary = { total: rows.length, locales: new Set(rows.map(row => row.locale)).size, facts: new Set(rows.map(row => row.fact)).size, pass: 0, drift: 0, conflict: 0, unknown: 0 };
  for (const row of rows) for (const status of row.statuses) summary[status.toLowerCase()]++;
  return {
    timestamp: new Date().toISOString(),
    source: { locale: 'en', url: pageUrl('en'), facts: sourceFacts, visibleCity: sourceFacts.city ?? null },
    rows,
    summary,
    verdict: summary.drift || summary.conflict ? 'FAIL' : summary.unknown || !summary.total ? 'INCOMPLETE' : 'PASS',
  };
}

async function main() {
  validateFacts(FACTS);
  const { renderReport } = require('./report');
  const rows = new Array(LOCALES.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < LOCALES.length) {
      const index = next++;
      rows[index] = await fetchFacts(LOCALES[index]);
      for (const row of rows[index]) console.log(`${row.locale.toUpperCase()} / ${row.fact}: HTTP ${row.httpStatus ?? '—'} · ${row.visibleValue ?? 'unknown'}`);
    }
  }));
  const report = evaluateRows(rows.flat());
  await writeFile(path.join(__dirname, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(__dirname, 'index.html'), renderReport(report), 'utf8');
  console.log(`${report.verdict}: ${report.summary.pass} PASS, ${report.summary.drift} DRIFT, ${report.summary.conflict} CONFLICT, ${report.summary.unknown} UNKNOWN`);
  process.exitCode = report.summary.drift || report.summary.conflict ? 1 : 0;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Unable to generate report: ${error.message}`);
    process.exitCode = 2;
  });
}

module.exports = { LOCALES, USER_AGENT, pageUrl, validateFacts, extractPage, fetchPage, fetchFacts, evaluateRows, main };
