/** 營運報表金額計算（cents）。 */

export type OperationReportInputCents = {
  actualPaidPlayers: number
  actualFeeCents: number
  shuttlecockUsed: number | null
  shuttlecockUnitCostCents: number | null
  otherIncomeCents: number
  otherExpenseCents: number
}

export type OperationReportComputedCents = {
  actualRevenueCents: number
  grossRevenueCents: number
  shuttlecockCostCents: number
  totalExpenseCents: number
  netRevenueCents: number
}

export function computeSessionOperationReportAmounts(input: OperationReportInputCents): OperationReportComputedCents {
  const players = Math.max(0, Math.floor(Number(input.actualPaidPlayers) || 0))
  const fee = Math.max(0, Math.floor(Number(input.actualFeeCents) || 0))
  const actualRevenueCents = players * fee
  const otherIn = Math.max(0, Math.floor(Number(input.otherIncomeCents) || 0))
  const otherEx = Math.max(0, Math.floor(Number(input.otherExpenseCents) || 0))
  const grossRevenueCents = actualRevenueCents + otherIn
  const used = input.shuttlecockUsed != null && Number.isFinite(Number(input.shuttlecockUsed)) ? Number(input.shuttlecockUsed) : 0
  const unit = input.shuttlecockUnitCostCents != null ? Math.max(0, Math.floor(Number(input.shuttlecockUnitCostCents))) : 0
  const shuttlecockCostCents = Math.round(used * unit)
  const totalExpenseCents = shuttlecockCostCents + otherEx
  const netRevenueCents = grossRevenueCents - totalExpenseCents
  return {
    actualRevenueCents,
    grossRevenueCents,
    shuttlecockCostCents,
    totalExpenseCents,
    netRevenueCents,
  }
}
