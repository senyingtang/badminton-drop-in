/** 推薦碼：8 碼大寫，排除 0/O/1/I 等易混淆字元（與 DB check 一致） */
const REFERRAL_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const REFERRAL_REGEX = new RegExp(`^[${REFERRAL_CHARSET}]{8}$`)

export function normalizeReferralCodeInput(raw: string): string {
  return raw.trim().toUpperCase()
}

export function isValidReferralCodeFormat(code: string): boolean {
  return REFERRAL_REGEX.test(normalizeReferralCodeInput(code))
}
