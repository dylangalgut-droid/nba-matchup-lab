# NBA Matchup Lab — free GitHub edition

Public GitHub Pages website with NBA box scores and model calculations refreshed by standard GitHub Actions runners. No Railway, PostgreSQL, paid API, admin token or paid runner is required. Use a **public repository** on GitHub Free; this workflow refuses to run on a private repository.

## Publish

1. Put this project's contents in the root of a public repository, with `main` as the default branch.
2. In Settings → Pages, select **GitHub Actions** as the source.
3. In Actions, run **Update NBA data and publish**. The successful deployment shows the real public URL.

## Updates

The workflow runs at 00:23 and 12:23 UTC, every 12 hours, and can also be started manually from GitHub Actions. The first import may take several minutes. It saves verified NBA cache data to the repository and publishes only the generated `dist` directory. Refreshing the website reloads the latest published data; it does not trigger a new ESPN import. Backtesting runs during the scheduled import.

Failed imports do not replace the live deployment. The site flags data older than 18 hours. Scheduled GitHub runs can be delayed or skipped; public repository schedules can be disabled after 60 days without activity. Check Actions if updates stop. ESPN's public endpoints are unofficial and can be unavailable or change format.

## Local verification

Node.js 22 recommended. No npm install is necessary for the static build.

```
npm test
npm run build
```

To rebuild from the saved verified cache without network requests:

```
npm run build:cached
```

Serve `dist` with a local static HTTP server. Do not open it directly as a `file://` URL because browsers block JSON fetches.

The original server remains available for local development. The free public version exposes only static data: no admin token is embedded or needed. GitHub account permissions protect update runs.

The model estimates matchup effects from observed box scores; projections are not validated betting odds. The dashboard shows source coverage and sample limitations.
