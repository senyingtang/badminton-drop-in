import { bindings, defineConfig, defineWorker } from "cf/config";

/**
 * 唯一允許的部署帳號（senyingtang2025@gmail.com）。Account ID 不是密鑰。
 * 注意：環境變數 CLOUDFLARE_ACCOUNT_ID 的優先序高於此值，
 * 所以部署一律走 scripts/cloudflare/*.ps1（會驗證實際有效的身分與帳號）。
 * 同一個 ID 也寫在 scripts/cloudflare/cf-account-guard.ps1，兩邊必須一致。
 */
const ALLOWED_ACCOUNT_ID = "feb96af4be0e308c286c3fd8d50e1941";

/**
 * 允許的 Worker（都只在 *.workers.dev，沒有綁定任何網域）：
 *   demo    = 測試預覽，Demo 假資料模式，不連任何 Supabase
 *   staging = 整合測試，接 Staging Supabase（不得接正式 Supabase）
 * 由 scripts/cloudflare/cf-deploy-preview.ps1 -Target 設定 BADMINTON_CF_TARGET，預設 demo。
 */
const WORKER_NAMES = {
  demo: "badminton-drop-in-preview",
  staging: "badminton-drop-in-staging",
} as const;
const target = process.env.BADMINTON_CF_TARGET === "staging" ? "staging" : "demo";

export default defineConfig({
  accountId: ALLOWED_ACCOUNT_ID,
  worker: defineWorker({
    name: WORKER_NAMES[target],
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
