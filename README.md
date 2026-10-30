# @varlock/vite-integration: the first dev server restart keeps stale env values when Vite's root is not the working directory (regression in 1.5.0)

When Vite's root is not the working directory, as with `vite app`, the varlock Vite plugin does not reload the env on the first dev server restart. A change to `.env.local` restarts the server, but `ENV.*` keeps the old value. The second change and every later change load correctly.

This is a regression in `@varlock/vite-integration@1.5.0`, from [dmno-dev/varlock#985](https://github.com/dmno-dev/varlock/pull/985). See [Regression in 1.5.0](#regression-in-150).

[![repro](https://github.com/why-reproductions-are-required/varlock-vite-first-restart-stale-env/actions/workflows/repro.yml/badge.svg)](https://github.com/why-reproductions-are-required/varlock-vite-first-restart-stale-env/actions/workflows/repro.yml)

The CI workflow runs the two failing cases and the control case below. The two failing jobs are expected to fail until the bug is fixed.

## Reproduce

Use Node 22 or later:

```sh
git clone https://github.com/why-reproductions-are-required/varlock-vite-first-restart-stale-env.git
cd varlock-vite-first-restart-stale-env
npm ci
npm run repro
```

This installs `@varlock/vite-integration@1.5.5`, `varlock@1.24.0`, and `vite@8.3.5` (the latest releases). The project is in [`app/`](app): a `.env.schema` with `GREETING=from-schema`, a `vite.config.js` with `varlockVitePlugin()`, and a `main.js` that uses `ENV.GREETING`.

[`repro.mjs`](repro.mjs) runs `vite app` from the repository root, as a user does from a parent directory. It then:

1. Writes `GREETING=first` to `app/.env.local` and starts the server.
2. Changes `GREETING` to `second`. Vite prints `app/.env.local changed, restarting server...`.
3. Changes `GREETING` to `third`. Vite restarts again.

After each step, the script fetches `/main.js` and reads the value that the plugin inlined for `ENV.GREETING`.

**Actual:** exit code 1. The first restart keeps `first`.

```
┌─────────┬─────────────┬──────────┬─────────┬─────────┐
│ (index) │ step        │ expected │ actual  │ result  │
├─────────┼─────────────┼──────────┼─────────┼─────────┤
│ 0       │ 'start'     │ 'first'  │ 'first' │ 'ok'    │
│ 1       │ 'restart 1' │ 'second' │ 'first' │ 'STALE' │
│ 2       │ 'restart 2' │ 'third'  │ 'third' │ 'ok'    │
└─────────┴─────────────┴──────────┴─────────┴─────────┘
FAIL: the dev server kept a stale env value after a restart.
```

**Expected:** every restart loads the new value.

To see it in a browser, run `npx vite app`, open the page, and change `GREETING` in `app/.env.local`. The page reloads with the old value. Change it again, and the page shows the newest value.

The `No .env files found` warning in the output is expected for this layout. The module-level load runs in the working directory, where there is no schema, before the `config` hook loads `app/`.

## Control

`npm run control` starts the same project with `cd app && vite`. Every restart loads the new value, and the script exits with code 0.

## Regression in 1.5.0

`npm run compare` runs the same reproduction with `@varlock/vite-integration@1.4.0` and `1.5.0`. Both use `varlock@1.17.1` and `vite@8.3.5`:

| `@varlock/vite-integration` | `restart 1` value | Result |
| --- | --- | --- |
| 1.4.0 | `second` | pass |
| 1.5.0 | `first` | stale |

`1.5.0` is the first release that contains [#985](https://github.com/dmno-dev/varlock/pull/985). Before #985, the hook compared the root with `process.cwd()` ([source](https://github.com/dmno-dev/varlock/blob/1277ae4d139c5e44aa56be4c196d49dc1cfeda99/packages/integrations/vite/src/index.ts#L454-L471)). With `vite app`, the root is never the working directory, so the first branch reloaded on every call, restarts included. #985 changed the check to compare with `loadedConfigDir`, the directory of the last load. #985 also added the `rootDir` option, so the second trigger below did not exist before it.

## Second trigger: `rootDir` with `_VARLOCK_ENV_KEY` set

`npm run repro:root-dir` uses [`app/vite.config.root-dir.js`](app/vite.config.root-dir.js), which passes `rootDir: import.meta.dirname`, and sets `_VARLOCK_ENV_KEY` to a random value. The first restart is stale again.

Without `_VARLOCK_ENV_KEY`, `rootDir` hides the bug. The `varlock-dev-key-lifecycle` plugin calls `ensureDevEncryptionKey(rootDir)`, which loads `rootDir` through `getVarlockLoadedEnv()` before the main `config` hook runs. When `_VARLOCK_ENV_KEY` is already set, `ensureDevEncryptionKey()` returns early and does not load `rootDir`.

## Cause

In the `config` hook of `inject-varlock-config` ([`packages/integrations/vite/src/index.ts#L703-L718`](https://github.com/dmno-dev/varlock/blob/0ccee65c9169fb2779953b8a909fda7fd0e74429/packages/integrations/vite/src/index.ts#L703-L718)):

```ts
if (rootDiffersFromLoaded) {
  reloadConfig(projectRoot);
} else if (!configHookCalled) {
  // First config hook call — the config was already loaded from the
  // correct directory, no need to reload.
  configHookCalled = true;
} else if (isDevCommand) {
  // Dev mode restart (triggered by configFileDependencies change).
  reloadConfig(projectRoot ?? loadedConfigDir);
}
```

1. The module-level `reloadConfig()` loads from `process.cwd()`, the repository root.
2. On the first `config` call, `projectRoot` (`app/`) differs from `loadedConfigDir`, so the first branch reloads from `app/`. It does not set `configHookCalled`.
3. On the first restart, the integration module stays cached and `projectRoot` now equals `loadedConfigDir`. The second branch runs: it sets `configHookCalled = true` and does not reload.
4. On the second restart, the third branch reloads.

## Suggested fix

Set `configHookCalled` in the first branch too:

```diff
 if (rootDiffersFromLoaded) {
   reloadConfig(projectRoot);
+  configHookCalled = true;
 } else if (!configHookCalled) {
```

With this change applied to `node_modules/@varlock/vite-integration/dist/index.mjs`, `npm run repro` and `npm run repro:root-dir` pass, and `npm run control` still passes.
