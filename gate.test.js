'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { mkdtempSync, copyFileSync, readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractPage, evaluateRows, fetchPage, fetchFacts, validateFacts } = require('./gate');
const { renderReport } = require('./report');
const defaultFacts = require('./facts');

const jsonLd = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const page = (city, locality = city) => `<p class="hero-subtitle">Based in ${city}</p>${jsonLd({ address: { addressLocality: locality } })}`;
const rawRow = (locale, visibleCity, jsonLdCities, overrides = {}) => ({
  locale,
  url: locale === 'en' ? 'https://prommer.net/' : `https://prommer.net/${locale}/`,
  httpStatus: 200,
  visibleCity,
  jsonLdCities,
  statuses: [],
  reason: null,
  ...overrides,
});
const response = (html, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  url: 'https://prommer.net/',
  text: async () => html,
});

test('extracts the hero city with selector priority and Indonesian lead fallback', () => {
  assert.equal(extractPage('<p class="lead">Los Angeles</p><p class="hero-subtitle">New York-based</p>').visibleCity, 'New York');
  assert.equal(extractPage('<p class="lead">Berbasis di Los Angeles</p>').visibleCity, 'Los Angeles');
  assert.equal(extractPage('<p class="hero-subtitle">Welcome</p><p class="lead">New York-based</p>').visibleCity, 'New York');
  assert.equal(extractPage('<p class="hero-subtitle">Based in <strong>Los Angeles</strong></p>').visibleCity, 'Los Angeles');
  assert.equal(extractPage('<p class="hero-subtitle">Asun Los Angelesissa</p>').visibleCity, 'Los Angeles', 'substring matching supports inflected locale copy');
});

test('ignores explicitly hidden descendants and hidden selector ancestors', () => {
  for (const attributes of ['hidden', 'aria-hidden="true"', 'style="display: none"', 'style="visibility: hidden"']) {
    assert.equal(extractPage(`<p class="hero-subtitle"><span ${attributes}>New York</span>Los Angeles</p>`).visibleCity, 'Los Angeles', attributes);
    assert.equal(extractPage(`<div ${attributes}><p class="hero-subtitle">New York</p></div><p class="lead">Los Angeles</p>`).visibleCity, 'Los Angeles', `ancestor ${attributes}`);
    assert.equal(extractPage(`<p class="hero-subtitle" ${attributes}>New York</p>`).visibleCity, null, `selector ${attributes}`);
  }
  for (const tag of ['script', 'style', 'template']) {
    assert.equal(extractPage(`<p class="hero-subtitle"><${tag}>New York</${tag}>Los Angeles</p>`).visibleCity, 'Los Angeles', tag);
  }
});

test('validates facts configuration before extraction or fetching', async () => {
  const valid = { name: 'role', values: ['Consultant'], selectors: ['p.role'], jsonLdKey: 'jobTitle' };
  assert.doesNotThrow(() => validateFacts([valid]));
  const invalidConfigurations = [
    null, {}, [], [valid, { ...valid }],
    [{ ...valid, name: '' }], [{ ...valid, name: ' ' }], [{ ...valid, name: undefined }],
    [{ ...valid, jsonLdKey: '' }], [{ ...valid, jsonLdKey: undefined }],
    [{ ...valid, values: [] }], [{ ...valid, values: [''] }], [{ ...valid, values: [7] }], [{ ...valid, values: 'Consultant' }],
    [{ ...valid, selectors: [] }], [{ ...valid, selectors: [''] }], [{ ...valid, selectors: [7] }], [{ ...valid, selectors: 'p.role' }],
    [{ ...valid, selectors: ['p['] }],
  ];
  for (const config of invalidConfigurations) assert.throws(() => validateFacts(config), undefined, JSON.stringify(config));
  assert.throws(() => extractPage('<p class="role">Consultant</p>', []));
  let calls = 0;
  await assert.rejects(fetchFacts('en', async () => { calls++; return response(''); }, []));
  assert.equal(calls, 0, 'invalid configuration must fail before the network request');
});

test('never infers visible location from JSON-LD, footer, or an unrelated element', () => {
  const html = '<p class="hero-subtitle">Welcome to our website</p><footer>New York</footer><div class="hero-subtitle">Los Angeles</div>' + jsonLd({ addressLocality: 'Los Angeles' });
  const extracted = extractPage(html);
  assert.equal(extracted.visibleCity, null);
  assert.deepEqual(extracted.jsonLdCities, ['Los Angeles']);
  assert.equal(extractPage('<p class="lead">Paris</p>').visibleCity, null);
});

test('collects addressLocality recursively from every JSON-LD block and graph', () => {
  const html = jsonLd({ '@graph': [{ address: { addressLocality: 'New York' } }, { nested: [{ place: { addressLocality: 'Los Angeles' } }] }] })
    + jsonLd([{ addressLocality: 'Helsinki' }, { address: { addressLocality: 'Berlin' } }]);
  assert.deepEqual(extractPage(html).jsonLdCities.slice().sort(), ['Berlin', 'Helsinki', 'Los Angeles', 'New York']);
});

test('reports malformed JSON-LD and still reads remaining blocks', () => {
  const result = extractPage('<script type="application/ld+json">{bad json</script>' + jsonLd({ addressLocality: 'New York' }));
  assert.deepEqual(result.jsonLdCities, ['New York']);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings.every((warning) => typeof warning === 'string'));
});

test('recognizes a meta-refresh redirect stub', () => {
  assert.equal(extractPage('<meta http-equiv="Refresh" content="0; URL=https://prommer.net/">').isRedirectStub, true);
  assert.equal(extractPage(page('New York')).isRedirectStub, false);
});

test('fetches EN from the site root with a browser User-Agent', async () => {
  const row = await fetchPage('en', async (url, options) => {
    assert.equal(String(url), 'https://prommer.net/');
    const headers = new Headers(options.headers);
    assert.match(headers.get('user-agent'), /Mozilla\/5\.0/);
    return response(page('New York'));
  });
  assert.equal(row.httpStatus, 200);
  assert.equal(row.visibleCity, 'New York');
  assert.deepEqual(row.jsonLdCities, ['New York']);
});

test('fetches a locale path and treats every non-200 response as UNKNOWN', async () => {
  for (const status of [201, 403, 404, 500]) {
    const row = await fetchPage('cs', async (url) => {
      assert.equal(String(url), 'https://prommer.net/cs/');
      return response(page('New York'), status);
    });
    assert.deepEqual(row.statuses, ['UNKNOWN']);
    assert.match(row.reason, new RegExp(`HTTP ${status}`));
    assert.equal(row.httpStatus, status);
  }
});

test('fetch errors, redirect stubs, and missing visible city remain UNKNOWN', async () => {
  const failed = await fetchPage('de', async () => { throw new Error('connection unavailable'); });
  assert.deepEqual(failed.statuses, ['UNKNOWN']);
  assert.match(failed.reason, /connection unavailable/);
  for (const html of ['<meta http-equiv="refresh" content="0;url=/">', jsonLd({ addressLocality: 'New York' })]) {
    const row = await fetchPage('de', async () => response(html));
    assert.deepEqual(row.statuses, ['UNKNOWN']);
    assert.ok(row.reason);
  }
});

test('allows simultaneous CONFLICT and DRIFT while preserving unknown rows', () => {
  const rows = [
    rawRow('en', 'New York', ['New York']),
    rawRow('de', 'Los Angeles', ['New York']),
    rawRow('fr', 'New York', ['New York', 'Los Angeles']),
    rawRow('cs', null, [], { httpStatus: 403, statuses: ['UNKNOWN'], reason: 'HTTP 403' }),
  ];
  const original = JSON.parse(JSON.stringify(rows));
  const report = evaluateRows(rows);
  assert.deepEqual(report.rows.find((row) => row.locale === 'en').statuses, ['PASS']);
  assert.deepEqual(report.rows.find((row) => row.locale === 'de').statuses.slice().sort(), ['CONFLICT', 'DRIFT']);
  assert.deepEqual(report.rows.find((row) => row.locale === 'fr').statuses, ['PASS']);
  assert.deepEqual(report.rows.find((row) => row.locale === 'cs').statuses, ['UNKNOWN']);
  assert.deepEqual(report.summary, { total: 4, locales: 4, facts: 1, pass: 2, drift: 1, conflict: 1, unknown: 1 });
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(rows, original, 'evaluation must not mutate its input rows');
  assert.match(report.timestamp, /Z$/);
  assert.ok(Number.isFinite(Date.parse(report.timestamp)));
});

test('missing or disagreeing structured location is CONFLICT, including on EN', () => {
  const report = evaluateRows([
    rawRow('en', 'New York', ['Los Angeles']),
    rawRow('de', 'New York', []),
    rawRow('es', 'Los Angeles', ['Los Angeles']),
  ]);
  assert.deepEqual(report.rows[0].statuses, ['CONFLICT']);
  assert.deepEqual(report.rows[1].statuses, ['CONFLICT']);
  assert.deepEqual(report.rows[2].statuses, ['DRIFT']);
});

test('unavailable EN cannot turn an unverified comparison into PASS', () => {
  const report = evaluateRows([
    rawRow('en', null, [], { httpStatus: 403, statuses: ['UNKNOWN'], reason: 'HTTP 403' }),
    rawRow('de', 'Los Angeles', ['Los Angeles']),
    rawRow('fr', 'Los Angeles', ['New York']),
  ]);
  assert.deepEqual(report.rows[0].statuses, ['UNKNOWN']);
  assert.deepEqual(report.rows[1].statuses, ['UNKNOWN']);
  assert.match(report.rows[1].reason, /EN|English|baseline/i);
  assert.ok(report.rows[2].statuses.includes('CONFLICT'));
  assert.ok(!report.rows[2].statuses.includes('PASS'));
  assert.ok(!report.rows[2].statuses.includes('DRIFT'));
});

test('distinguishes a fully passing report from an incomplete report', () => {
  const passing = evaluateRows([
    rawRow('en', 'New York', ['New York']),
    rawRow('de', 'New York', ['New York']),
  ]);
  assert.equal(passing.verdict, 'PASS');
  assert.deepEqual(passing.summary, { total: 2, locales: 2, facts: 1, pass: 2, drift: 0, conflict: 0, unknown: 0 });
  const incomplete = evaluateRows([
    rawRow('en', 'New York', ['New York']),
    rawRow('cs', null, [], { httpStatus: 403, statuses: ['UNKNOWN'], reason: 'HTTP 403' }),
  ]);
  assert.equal(incomplete.verdict, 'INCOMPLETE');
  assert.deepEqual(incomplete.summary, { total: 2, locales: 2, facts: 1, pass: 1, drift: 0, conflict: 0, unknown: 1 });
  const empty = evaluateRows([]);
  assert.equal(empty.verdict, 'INCOMPLETE');
  assert.equal(empty.summary.pass, 0);
});

test('a missing EN fact baseline cannot resolve to an inherited object property', () => {
  const report = evaluateRows([{
    locale: 'de', fact: 'constructor', visibleValue: 'Engineer', jsonLdValues: ['Engineer'],
    httpStatus: 200, statuses: [], reason: null, url: 'https://prommer.net/de/',
  }]);
  assert.deepEqual(report.rows[0].statuses, ['UNKNOWN']);
  assert.match(report.rows[0].reason, /EN source unavailable/);
  assert.equal(report.verdict, 'INCOMPLETE');
});

test('evaluates each fact against its corresponding EN baseline independently', () => {
  const factRow = (locale, fact, visibleValue, jsonLdValues) => ({
    locale, fact, visibleValue, jsonLdValues, httpStatus: 200, statuses: [], reason: null,
    url: locale === 'en' ? 'https://prommer.net/' : `https://prommer.net/${locale}/`,
  });
  const rows = [
    factRow('en', 'city', 'New York', ['New York']),
    factRow('en', 'role', 'Consultant', ['Consultant']),
    factRow('de', 'city', 'New York', ['New York']),
    factRow('de', 'role', 'Engineer', ['Consultant']),
    factRow('fr', 'city', 'Los Angeles', ['Los Angeles']),
    factRow('fr', 'role', 'Consultant', ['Consultant']),
  ];
  const before = JSON.parse(JSON.stringify(rows));
  const report = evaluateRows(rows);
  const find = (locale, fact) => report.rows.find(row => row.locale === locale && row.fact === fact);
  assert.deepEqual(find('de', 'city').statuses, ['PASS']);
  assert.deepEqual(find('de', 'role').statuses.slice().sort(), ['CONFLICT', 'DRIFT']);
  assert.deepEqual(find('fr', 'city').statuses, ['DRIFT']);
  assert.deepEqual(find('fr', 'role').statuses, ['PASS']);
  assert.deepEqual(report.summary, { total: 6, locales: 3, facts: 2, pass: 4, drift: 2, conflict: 1, unknown: 0 });
  assert.deepEqual(rows, before);
  const $ = cheerio.load(renderReport(report));
  assert.equal($('tbody tr').length, 6);
  assert.equal($('[data-label="Fact"]').filter((_, element) => $(element).text() === 'role').length, 3);
  assert.equal($('[data-label="Visible value"]').filter((_, element) => $(element).text() === 'Engineer').length, 1);
});

test('extracts a second fact solely through configuration and fetches each page once', async () => {
  const facts = [...defaultFacts, { name: 'role', values: ['Consultant', 'Engineer'], selectors: ['p.role'], jsonLdKey: 'jobTitle' }];
  const html = '<p class="hero-subtitle">New York-based</p><p class="role">Independent Engineer</p><footer>Consultant</footer>'
    + jsonLd({ '@graph': [{ address: { addressLocality: 'New York' }, jobTitle: 'Consultant' }, { jobTitle: 'Engineer' }] });
  const extracted = extractPage(html, facts);
  assert.deepEqual(extracted.facts, [
    { fact: 'city', visibleValue: 'New York', jsonLdValues: ['New York'] },
    { fact: 'role', visibleValue: 'Engineer', jsonLdValues: ['Consultant', 'Engineer'] },
  ]);
  const missing = extractPage('<footer>Engineer</footer>' + jsonLd({ jobTitle: 'Engineer' }), facts);
  assert.equal(missing.facts.find(fact => fact.fact === 'role').visibleValue, null);
  let calls = 0;
  const rows = await fetchFacts('de', async () => { calls++; return response(html); }, facts);
  assert.equal(calls, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].fact, 'role');
  assert.equal(rows[1].visibleValue, 'Engineer');
  assert.deepEqual(rows[1].jsonLdValues, ['Consultant', 'Engineer']);
  const unavailable = await fetchFacts('de', async () => response('', 403), facts);
  assert.equal(unavailable.length, 2);
  assert.ok(unavailable.every(row => row.statuses.length === 1 && row.statuses[0] === 'UNKNOWN'));
});

test('report escapes hostile extracted text and rejects executable link schemes', () => {
  const malicious = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const report = evaluateRows([
    { locale: 'en', fact: 'role', visibleValue: 'Consultant', jsonLdValues: [malicious], httpStatus: 200, statuses: [], url: 'javascript:alert(3)', reason: malicious },
  ]);
  const html = renderReport(report);
  const $ = cheerio.load(html);
  assert.equal($('script, img, [onerror]').length, 0);
  assert.equal($('a.locale').attr('href'), '#');
  assert.equal($('[data-label="JSON-LD values"]').text(), malicious);
  assert.ok($('[data-label="Reason"]').text().includes(malicious));
  assert.equal($('time').attr('datetime'), report.timestamp);
  assert.equal($('link[rel="stylesheet"], script[src]').length, 0, 'report must be self-contained');
});

test('CLI writes both reports and uses exit 1 only for detected disagreement', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'truth-drift-gate-test-'));
  try {
    for (const filename of ['gate.js', 'report.js', 'facts.js']) copyFileSync(path.join(__dirname, filename), path.join(directory, filename));
    for (const scenario of ['PASS', 'FAIL', 'INCOMPLETE']) {
      const script = `
        global.fetch = async (url) => {
          const city = ${JSON.stringify(scenario)} === 'FAIL' && url !== 'https://prommer.net/' ? 'Los Angeles' : 'New York';
          return { status: ${scenario === 'INCOMPLETE' ? 403 : 200}, text: async () => '<p class="hero-subtitle">' + city + '</p><script type="application/ld+json">' + JSON.stringify({ addressLocality: city }) + '</script>' };
        };
        require('./gate').main().catch(error => { console.error(error); process.exitCode = 2; });
      `;
      const result = spawnSync(process.execPath, ['-e', script], {
        cwd: directory,
        env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') },
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      });
      assert.ifError(result.error);
      assert.equal(result.status, scenario === 'FAIL' ? 1 : 0, result.stderr);
      const report = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8'));
      assert.equal(report.verdict, scenario);
      assert.equal(report.rows.length, 13);
      assert.equal(report.rows[0].url, 'https://prommer.net/');
      const $ = cheerio.load(readFileSync(path.join(directory, 'index.html'), 'utf8'));
      assert.equal($('tbody tr').length, 13);
      assert.equal($('time').attr('datetime'), report.timestamp);
    }
    for (const filename of ['report.json', 'index.html']) unlinkSync(path.join(directory, filename));
    writeFileSync(path.join(directory, 'facts.js'), "'use strict';\nmodule.exports = [];\n");
    const invalid = spawnSync(process.execPath, ['gate.js'], {
      cwd: directory,
      env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') },
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.ifError(invalid.error);
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.match(invalid.stderr, /fact|config/i);
    assert.equal(existsSync(path.join(directory, 'report.json')), false);
    assert.equal(existsSync(path.join(directory, 'index.html')), false);
  } finally {
    // Only this test's newly created directory contains these temporary files.
    for (const filename of readdirSync(directory)) unlinkSync(path.join(directory, filename));
    rmdirSync(directory);
  }
});
