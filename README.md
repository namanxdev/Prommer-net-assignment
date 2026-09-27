# Truth Drift Gate — prommer.net

Truth Drift Gate checks whether each locale homepage's visible facts agree with the English homepage and its own JSON-LD structured data. It starts with the hero tagline's city; additional facts are configured in `facts.js`. It produces a JSON report and a self-contained, dark, mobile-readable HTML report for review or static hosting.

Structured data is what search engines and AI agents read. When it disagrees with visible copy, the site tells humans one city and machines another. This check identifies disagreements; it does not decide which city is correct.

Live report: https://truth-drift-gate.vercel.app

## Run

Requires **Node.js 18 or newer**. The only dependency is `cheerio`, pinned to `1.0.0-rc.12` for compatibility across Node 18 releases. HTTP requests use Node's built-in `fetch` with a normal browser User-Agent.

```sh
npm install
npm run check
```

The check writes `report.json` and `index.html` in the project root. Open `index.html` in a browser to see the verdict, counts, locale-and-fact table, reasons, and UTC run timestamp. Both artifacts describe the same run; rerunning the check replaces them.

Run the automated checks with:

```sh
npm test
```

Exit codes:

- **1:** at least one fact check has `DRIFT` or `CONFLICT`, suitable for failing a CI gate.
- **0:** no detected `DRIFT` or `CONFLICT`. In this case, any `UNKNOWN` fact check makes the report verdict `INCOMPLETE`; exit 0 does not mean every fact was verified.
- **2:** an operational failure, such as being unable to write the report.

CI should retain the generated reports even when the check exits 1. A static report displays the recorded run and does not fetch the site when opened.

## Deploy to Vercel

Generate and review the latest report with `npm run check`, then deploy the saved snapshot:

```sh
npm run build
vercel login
vercel deploy --prod --yes
```

`build.js` renders `public/index.html` from the saved `report.json` and copies that JSON into `public/`. It uses only Node built-ins. The [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json) skips dependency installation and publishes this output directory. Deploying does not rerun the network check, so a deliberate gate exit code 1 does not prevent publishing the findings. To update the site, rerun the check, review and commit its outputs, then deploy again.

## Pages and extraction

The checked locales are `en de es fr pt it nl fi sv pl id da cs`.

- English is fetched from `https://prommer.net/`. The `/en/` URL is a meta-refresh redirect stub and is not the source page.
- Other locales use `https://prommer.net/{locale}/`.
- `visibleCity` comes only from the hero tagline. The checker tries `p.hero-subtitle`, then `p.lead` (used by Indonesian), and matches `New York` or `Los Angeles` inside those elements' text. No match produces `null`.
- `jsonLdCities` contains the `addressLocality` values discovered across every `script[type="application/ld+json"]` block. The checker recursively walks nested objects and arrays, including `@graph`.

## Configure facts

`facts.js` exports an array of fact definitions. The initial configuration is:

```js
module.exports = [
  {
    name: 'city',
    values: ['New York', 'Los Angeles'],
    selectors: ['p.hero-subtitle', 'p.lead'],
    jsonLdKey: 'addressLocality',
  },
];
```

To check another fact, add an object with a unique `name`, the recognized `values`, selectors for the relevant visible copy in priority order, and the JSON-LD property to collect as `jsonLdKey`. The gate loops over these definitions for every locale and compares each fact against the same fact on English. Use narrowly scoped selectors: values found elsewhere on the page must not establish agreement. Choose values represented consistently in visible copy and JSON-LD; the gate does not translate or infer equivalent facts.

Empty or malformed configurations, invalid selectors, and duplicate fact names fail with exit code 2 before fetching. Visible matching is case-insensitive and uses substrings after whitespace normalization, which also recognizes inflected text such as Finnish `Los Angelesissa`. JSON-LD comparison uses the configured canonical value and trims surrounding whitespace.

Extraction excludes explicitly hidden elements and ancestors (`hidden`, `aria-hidden="true"`, inline `display:none` or `visibility:hidden/collapse`) and script, style, and template content. This is a static HTML check: it does not execute JavaScript or compute visibility from stylesheets.

Each JSON report row describes one locale/fact combination using `fact`, `visibleValue`, and `jsonLdValues`. City rows also retain `visibleCity` and `jsonLdCities` for compatibility with the original city report. The HTML table identifies the fact on each row.

`summary.total` counts fact checks, while `summary.locales` and `summary.facts` report the numbers of locales and configured facts. With 13 locales and one configured fact, there are 13 checks; adding a second fact produces 26.

## Statuses

| Status | Meaning |
| --- | --- |
| `UNKNOWN` | The fact cannot be verified: non-200 HTTP response, fetch error, redirect stub, or no recognized visible value. The report records a reason, such as `HTTP 403`. |
| `CONFLICT` | The fact's visible value is absent from that page's corresponding JSON-LD values. Missing structured data therefore cannot establish agreement. |
| `DRIFT` | The fact's visible value differs from the English page's visible value for that fact. |
| `PASS` | The fact's visible value agrees with its JSON-LD values and the available English baseline. |

A fact check can have both `CONFLICT` and `DRIFT`. Summary status counts can therefore overlap and need not sum to `summary.total`. `UNKNOWN` is never counted as `PASS`.

If the English baseline for a fact is unavailable, the checker cannot establish drift for that fact. It still reports an independently detectable `CONFLICT`; otherwise, the locale's fact check is `UNKNOWN` with an `EN source unavailable` reason. The missing English baseline leaves verification incomplete even if all reachable locales agree with one another.

## Design decisions

- **Use the real English homepage.** A redirect stub must not become an empty or misleading source of truth.
- **Inspect specific visible-copy elements.** There is no whole-page city search. Such a search could match JSON-LD itself and conceal the disagreement the gate is meant to catch.
- **Read all structured-data blocks recursively.** Location data may appear inside nested entities or `@graph`, rather than at the top level of a single block.
- **Configure each fact once.** `facts.js` supplies the allowed values, visible-copy selectors, and structured-data key. Extraction, comparisons, and reporting use the same definitions.
- **Keep unverifiable pages explicit.** HTTP failures and missing copy carry reasons and never silently pass.
- **Separate disagreement from availability.** Detected disagreements fail CI; unknown results remain visible through an `INCOMPLETE` verdict without changing the requested disagreement-only exit policy.
- **Generate inspectable artifacts.** JSON supports automation; the HTML report can be opened locally or hosted as a static file. All run timestamps use UTC.

To fix an actual disagreement, choose the authoritative location and render both visible copy and structured data from that value across locales. Consult the latest generated report for findings rather than treating this README as a snapshot of the live site.
# Prommer-net-assignment
