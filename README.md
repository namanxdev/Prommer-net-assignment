# Truth Drift Gate — prommer.net

Truth Drift Gate checks whether each locale homepage's visible location copy agrees with the English homepage and its own JSON-LD structured data. It produces a JSON report and a self-contained, dark, mobile-readable HTML report for review or static hosting.

Structured data is what search engines and AI agents read. When it disagrees with visible copy, the site tells humans one city and machines another. This check identifies disagreements; it does not decide which city is correct.

## Run

Requires **Node.js 18 or newer**. The only dependency is `cheerio`, pinned to `1.0.0-rc.12` for compatibility across Node 18 releases. HTTP requests use Node's built-in `fetch` with a normal browser User-Agent.

```sh
npm install
npm run check
```

The check writes `report.json` and `index.html` in the project root. Open `index.html` in a browser to see the verdict, counts, locale table, reasons, and UTC run timestamp. Both artifacts describe the same run; rerunning the check replaces them.

Run the automated checks with:

```sh
npm test
```

Exit codes:

- **1:** at least one page has `DRIFT` or `CONFLICT`, suitable for failing a CI gate.
- **0:** no detected `DRIFT` or `CONFLICT`. In this case, any `UNKNOWN` page makes the report verdict `INCOMPLETE`; exit 0 does not mean every page was verified.
- **2:** an operational failure, such as being unable to write the report.

CI should retain the generated reports even when the check exits 1. A static report displays the recorded run and does not fetch the site when opened.

## Pages and extraction

The checked locales are `en de es fr pt it nl fi sv pl id da cs`.

- English is fetched from `https://prommer.net/`. The `/en/` URL is a meta-refresh redirect stub and is not the source page.
- Other locales use `https://prommer.net/{locale}/`.
- `visibleCity` comes only from the hero tagline. The checker tries `p.hero-subtitle`, then `p.lead` (used by Indonesian), and matches `New York` or `Los Angeles` inside those elements' text. No match produces `null`.
- `jsonLdCities` contains the `addressLocality` values discovered across every `script[type="application/ld+json"]` block. The checker recursively walks nested objects and arrays, including `@graph`.

## Statuses

| Status | Meaning |
| --- | --- |
| `UNKNOWN` | The page cannot be verified: non-200 HTTP response, fetch error, redirect stub, or no recognized visible city. The report records a reason, such as `HTTP 403`. |
| `CONFLICT` | The page's visible city is absent from its own JSON-LD cities. Missing city data therefore cannot establish agreement. |
| `DRIFT` | The page's visible city differs from the English page's visible city. |
| `PASS` | The page's visible city agrees with its JSON-LD and the available English baseline. |

A page can have both `CONFLICT` and `DRIFT`. Summary status counts can therefore overlap and need not sum to the number of pages. `UNKNOWN` is never counted as `PASS`.

If English is unavailable, the checker cannot establish drift against it. It still reports a page's independently detectable `CONFLICT`; otherwise, the locale is `UNKNOWN` with an `EN source unavailable` reason. The missing English baseline keeps the run incomplete even if all reachable locales agree with one another.

## Design decisions

- **Use the real English homepage.** A redirect stub must not become an empty or misleading source of truth.
- **Inspect specific visible-copy elements.** There is no whole-page city search. Such a search could match JSON-LD itself and conceal the disagreement the gate is meant to catch.
- **Read all structured-data blocks recursively.** Location data may appear inside nested entities or `@graph`, rather than at the top level of a single block.
- **Keep unverifiable pages explicit.** HTTP failures and missing copy carry reasons and never silently pass.
- **Separate disagreement from availability.** Detected disagreements fail CI; unknown results remain visible through an `INCOMPLETE` verdict without changing the requested disagreement-only exit policy.
- **Generate inspectable artifacts.** JSON supports automation; the HTML report can be opened locally or hosted as a static file. All run timestamps use UTC.

To fix an actual disagreement, choose the authoritative location and render both visible copy and structured data from that value across locales. Consult the latest generated report for findings rather than treating this README as a snapshot of the live site.
# Prommer-net-assignment
