# MEXC Blue Heart Relay

Light up the MEXC logo one pixel at a time. The English-language map has 2,000 pixel slots. Each browser can light one pixel, leave an editable note, and share a link to that pixel.

A new database starts at **Community Power 0** and **0 / 2,000 pixels lit**. The SQL migrations create the map and analytics tables and their indexes. They do not insert any participation records or sample data.

## Run locally

Use Node.js 22.13 or newer with npm.

```sh
npm ci
npm run check
npm run db:local
npm run dev
```

Open the local URL printed by Wrangler. The database is created under the ignored `.wrangler/` directory. To try the app against another empty local database, pass a new persistence path to both commands:

```sh
npm run db:local -- --persist-to .wrangler/empty-round
npm run dev -- --persist-to .wrangler/empty-round
```

## Push to GitHub

Extract the archive and run these commands from the `mexc-blue-heart-relay` folder. Create an empty GitHub repository first and replace the example remote URL with its URL.

```sh
git init -b main
git add .
git commit -m "Initial release"
git remote add origin https://github.com/YOUR-ORG/mexc-blue-heart-relay.git
git push -u origin main
```

## Deploy the shared map

The full app uses Cloudflare Workers and D1. GitHub hosts the source code. Running the HTML on GitHub Pages alone cannot provide the shared database or referral API.

1. From this folder, sign in with `npx wrangler login`.
2. Create an empty database with `npx wrangler d1 create mexc-blue-heart-relay`. If the CLI asks to modify the configuration automatically, decline and copy the returned database ID.
3. In `wrangler.jsonc`, replace the placeholder `database_id` with the new ID. Keep the binding name `DB`. If you used a different database name, update `database_name` as well.
4. Run `npm run db:remote`, then `npm run deploy`.
5. Open the Worker URL printed by the CLI and confirm that the counter starts at `0 / 2,000`. Sharing and referral links use the current site's hostname.

Use a new database for a clean launch. Deploying code against a database that already has rows preserves those rows.

[Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/binding/) · [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) · [Add local code to GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

## Enable the staff dashboard

The public map starts collecting arrival and click data after deployment with all migrations applied. The staff dashboard is at `/admin`.

### Password sign-in

After deploying, set the administrator password as a Worker secret:

```sh
npx wrangler secret put ADMIN_PASSWORD
```

Paste the supplied password at the hidden prompt. Keep the password file outside the Git repository. Anyone signed in with this administrator password can view reports and export UIDs. The password requires at least 24 characters. Sessions expire after eight hours, and changing the Worker secret invalidates existing password sessions.

For local use, create an ignored `.dev.vars` file with `ADMIN_PASSWORD=your-password-here` and run `npm run dev`. The included production configuration accepts login over HTTPS. Local HTTP login is available on loopback.

### Optional team sign-in with Cloudflare Access

Configure Cloudflare Access when granting team members individual accounts or limiting UID export to selected accounts. An Access policy on the campaign hostname also applies before the password page if both options are enabled.

1. In Zero Trust, create one self-hosted Access application covering both `/admin` and `/api/admin/*` on the campaign hostname. Add an Allow policy for the team members who can view campaign reports. If you also use `/admin/` in team links, include that path in the same Access application.
2. Use the application's Audience (AUD) tag and your team's `https://<team>.cloudflareaccess.com` URL to set these Worker variables in your deployment environment. The CLI will prompt for each value.

   ```sh
   npx wrangler secret put ACCESS_TEAM_DOMAIN
   npx wrangler secret put ACCESS_AUDIENCE
   npx wrangler secret put UID_EXPORT_EMAILS
   ```

   Use a comma-separated list of exact staff email addresses for `UID_EXPORT_EMAILS`. An empty or omitted list disables UID exports. Everyone admitted by the Access policy can read the aggregate report and export the channel CSV.
3. Open `/admin` using an allowed account. Test the channel CSV. Verify a viewer can see the report but cannot download the UID CSV and a listed exporter can. Verify signed-out visitors are denied at the admin page and every report endpoint.

Cloudflare Access requests verify the token signature, expiration, issuer and application audience in the Worker. The dashboard and exports are served without caching. No staff credentials, real Access configuration, or data are included in this repository. [Cloudflare Access application setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) · [Cloudflare Access token verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## Read the report

- Counts use one record per browser cookie. The date and source filters cohort browsers by their first recorded arrival in UTC+8. Clicks, successful pixels and current UID submissions are attributed to that arrival even if completed later.
- Click rate is unique light-button submissions received by the server divided by browsers eligible at arrival. Light conversion uses recorded successful pixels and the same denominator. Background polling does not create arrival records. Pre-launch visits cannot be recovered.
- Add `?utm_source=x`, `?utm_source=telegram`, `?utm_source=discord`, `?utm_source=email`, `?utm_source=community`, or `?utm_source=partner` to campaign links. A valid personal pixel link takes precedence on first arrival. Unknown tags are grouped under Other. Relay conversion measures subsequent successful participation among eligible browsers in the first-arrival relay cohort.
- UID fill rate uses successful participants with a currently saved UID. The UID CSV lists each self-reported UID once within the selected cohort and omits cleared UIDs. Import the UID column as text in spreadsheets to preserve leading zeros and long identifiers.

## Source and data

- `prototype/` contains the page, browser code, and map geometry. `npm run build` generates `dist/index.html`.
- `src/index.ts` serves the relay API. `migrations/` contains schema-only SQL.
- The optional X handle appears publicly alongside a note only after the visitor consents. The optional MEXC UID is saved with the note and returned through the contributor's session only. The public board and relay links omit it. Clearing the field or removing the note also clears its stored UID.
- Open the generated `dist/index.html` directly for a single-browser offline map. This mode stores only local interactions and cannot share the counter with other visitors.

The pixel outline uses the M from the MEXC logo. The map uses Natural Earth 1:110m land data via World Atlas.
