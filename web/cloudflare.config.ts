import { bindings, defineConfig, defineWorker } from "cf/config";

/**
 * 唯一允許的部署帳號（senyingtang2025@gmail.com）。Account ID 不是密鑰。
 * 注意：環境變數 CLOUDFLARE_ACCOUNT_ID 的優先序高於此值，
 * 所以部署一律走 scripts/cloudflare/*.ps1（會驗證實際有效的身分與帳號）。
 * 同一個 ID 也寫在 scripts/cloudflare/cf-account-guard.ps1，兩邊必須一致。
 */
const ALLOWED_ACCOUNT_ID = "feb96af4be0e308c286c3fd8d50e1941";

export default defineConfig({
  accountId: ALLOWED_ACCOUNT_ID,
  worker: defineWorker({
    name: "badminton-drop-in-preview",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-07",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
    },
  }),
});
