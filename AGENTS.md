# Daily Hanzi website

- Do not run live UI tests. Use isolated mocked checks, production builds and authorized backend/API checks. Do not use a mobile simulator.
- The main checkout can contain unpublished work. Preserve it; create an isolated worktree from verified `origin/main` for unrelated releases. Do not force-push or broadly stage files.

## Supabase account and project mapping

- This website uses the same Daily Hanzi backend as the mobile repository: project `derycifbrndfanjjfpve`.
- Saved management workdir: `/Users/alexliu/CodingProjects/chineseCharacterApp`.
- Reuse its working named profile: `supabase/cli-profile.toml` under that workdir, name `daily-hanzi-chinese-character-app`. Use that workdir and explicitly pass `--profile supabase/cli-profile.toml` (plus `--dns-resolver https` when native DNS fails).
- Check whether `SUPABASE_ACCESS_TOKEN` overrides the profile without printing it, and verify read-only access to this exact project before deploying. Do not replace the default login or silently switch accounts. Credentials remain in the OS credential store; no access token belongs here or in Git.
- No new login was needed for the North Star dashboard; the saved backend profile was reused. If this website later needs an independent login, create and record a unique named profile before requesting login.

## North Star dashboard

- `/admin/north-star` is an admin-only navigation tab. Middleware and client navigation classify it with the revenue dashboard; the database RPC independently requires `user_roles.role='admin'`. Moderators and ordinary accounts are denied, including for cached results.
- `admin_north_star_report(date,date,boolean)` returns content-free aggregates, never individual user records. It uses the canonical v1 definitions in the mobile repo's `NORTH_STAR_METRICS.md` and generated migration `20261027020000_nsm_admin_dashboard.sql`. Do not replace paid-at-week-start denominators with current Pro flags or count individual ratings/opens as meaningful practice.
- New tracking and historical estimates are separate views. Weekly/monthly charts retain unknown rates as gaps, label partial periods, show numerator/denominator tables and export CSV. Monthly paid habit pools learner-weeks rather than averaging percentages. Only trial activation has a store filter; paid habit includes all attributable paid stores.
- The report excludes the latest 48 hours for arrival lag; trials additionally need a mature 48-hour window. The cache is private, generated on demand, expires after six hours and supports an explicit refresh. No recurring job was added. Activity capture began October 27, 2026; improved widget checks require mobile build162 adoption.
- Verification: `npm run test:north-star` (Node with native TypeScript stripping), `npx tsc --noEmit`, scoped ESLint, and `npm run build`. No live UI test is authorized.
- Production deploys via the existing GitHub-to-Vercel integration for `xinweis-projects/daily-hanzi-website`. Verify the production deployment's exact commit after pushing. The connected Vercel plugin account may expose a different team; do not deploy into an unrelated project.
