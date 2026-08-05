/**
 * The fundamentals checklist — Phase 4 Milestone 4. Per `docs/PROPOSAL.md`: "gates
 * raw numbers before they're allowed into a valuation model, catching bad inputs
 * early (the 'pre-flight checklist' pattern professional analysts use)." Unlike M3,
 * no new FMP endpoint or provider call — every check reads fields already fetched for
 * the DCF and relative-valuation sections (`FmpStatements`: statements, `ratios`,
 * `keyMetrics`).
 *
 * A failed check isn't "don't buy this" — it's "here's a reason to look closer before
 * trusting the DCF/valuation numbers on this page," the same triangulate-don't-trust-
 * one-number framing the rest of this workbench already uses.
 */
import type { FmpStatementPeriod, FmpStatements } from './fmp';

export type ChecklistStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
}

function latestNumber(periods: readonly FmpStatementPeriod[], field: string): number | null {
  const value = periods[0]?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unknownItem(id: string, label: string, detail: string): ChecklistItem {
  return { id, label, status: 'unknown', detail };
}

/** 18 months in days — a round, documented threshold, not derived from anything
 * ticker-specific. Annual statements land roughly once a year; 18 months gives real
 * slack for reporting lag before treating a ticker's data as stale. */
const RECENCY_PASS_DAYS = 18 * 30;
const RECENCY_WARN_DAYS = 30 * 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function checkDataRecency(statements: FmpStatements, now: Date): ChecklistItem {
  const dateStr = statements.incomeStatements[0]?.date;
  if (typeof dateStr !== 'string') {
    return unknownItem('data-recency', 'Data is recent', 'No statement date available to check.');
  }
  const ageDays = (now.getTime() - Date.parse(`${dateStr}T00:00:00Z`)) / MS_PER_DAY;
  if (!Number.isFinite(ageDays)) {
    return unknownItem('data-recency', 'Data is recent', 'The statement date couldn’t be read.');
  }
  if (ageDays <= RECENCY_PASS_DAYS) {
    return { id: 'data-recency', label: 'Data is recent', status: 'pass', detail: `Most recent statement: ${dateStr}.` };
  }
  if (ageDays <= RECENCY_WARN_DAYS) {
    return {
      id: 'data-recency',
      label: 'Data is recent',
      status: 'warn',
      detail: `Most recent statement is ${dateStr} — over 18 months old. FMP’s free tier may not be keeping this ticker current.`,
    };
  }
  return {
    id: 'data-recency',
    label: 'Data is recent',
    status: 'fail',
    detail: `Most recent statement is ${dateStr} — over 30 months old. Treat every other number on this page cautiously.`,
  };
}

function checkFreeCashFlow(statements: FmpStatements): ChecklistItem {
  const fcf = latestNumber(statements.cashFlowStatements, 'freeCashFlow');
  if (fcf === null) return unknownItem('free-cash-flow', 'Free cash flow is positive', 'No cash flow data available.');
  if (fcf > 0) {
    return { id: 'free-cash-flow', label: 'Free cash flow is positive', status: 'pass', detail: 'The DCF above is built on a genuinely positive base.' };
  }
  return {
    id: 'free-cash-flow',
    label: 'Free cash flow is positive',
    status: 'fail',
    detail: 'Free cash flow is negative or zero — the DCF above is extrapolating growth from a base that isn’t really cash-generative today.',
  };
}

function checkProfitability(statements: FmpStatements): ChecklistItem {
  const netMargin = latestNumber(statements.ratios, 'netProfitMargin');
  if (netMargin === null) return unknownItem('profitability', 'Profitable', 'No margin data available.');
  if (netMargin > 0) {
    return { id: 'profitability', label: 'Profitable', status: 'pass', detail: `Net margin: ${(netMargin * 100).toFixed(1)}%.` };
  }
  return { id: 'profitability', label: 'Profitable', status: 'fail', detail: 'Net margin is zero or negative — the company is currently losing money.' };
}

function checkDebtLevel(statements: FmpStatements): ChecklistItem {
  const debtToEquity = latestNumber(statements.ratios, 'debtToEquityRatio');
  if (debtToEquity === null) return unknownItem('debt-level', 'Debt is manageable', 'No debt/equity data available.');
  const formatted = `Debt/equity: ${debtToEquity.toFixed(2)}x.`;
  // "Lower is better" only holds for a non-negative ratio — a negative one means
  // equity itself is negative, and the comparison's own lower bound was previously
  // unchecked, so a company in that state passed this exact check (found by
  // independent review: -3.4x rendered a green "Debt is manageable"). The adjacent
  // shareholder-equity check below catches the same root cause with clearer wording;
  // this one should fail, not pass, rather than stay silent about it.
  if (debtToEquity < 0) {
    return {
      id: 'debt-level',
      label: 'Debt is manageable',
      status: 'fail',
      detail: `${formatted} Negative — shareholder equity itself is negative, so this ratio isn’t a meaningful "manageable" signal on its own. See the shareholder-equity check below.`,
    };
  }
  if (debtToEquity < 2) return { id: 'debt-level', label: 'Debt is manageable', status: 'pass', detail: formatted };
  if (debtToEquity <= 4) {
    return { id: 'debt-level', label: 'Debt is manageable', status: 'warn', detail: `${formatted} Higher than the conventional 2x rule of thumb — not unusual for some industries, worth knowing why.` };
  }
  return { id: 'debt-level', label: 'Debt is manageable', status: 'fail', detail: `${formatted} Heavily leveraged relative to the conventional 2x rule of thumb.` };
}

function checkLiquidity(statements: FmpStatements): ChecklistItem {
  const currentRatio = latestNumber(statements.ratios, 'currentRatio');
  if (currentRatio === null) return unknownItem('liquidity', 'Adequate short-term liquidity', 'No current ratio data available.');
  const formatted = `Current ratio: ${currentRatio.toFixed(2)}.`;
  if (currentRatio >= 1.5) return { id: 'liquidity', label: 'Adequate short-term liquidity', status: 'pass', detail: formatted };
  if (currentRatio >= 1) {
    return { id: 'liquidity', label: 'Adequate short-term liquidity', status: 'warn', detail: `${formatted} Some cushion, but not a lot.` };
  }
  return { id: 'liquidity', label: 'Adequate short-term liquidity', status: 'fail', detail: `${formatted} Short-term liabilities exceed short-term assets.` };
}

function checkShareholderEquity(statements: FmpStatements): ChecklistItem {
  const equity = latestNumber(statements.balanceSheets, 'totalStockholdersEquity');
  if (equity === null) return unknownItem('shareholder-equity', 'Positive shareholder equity', 'No balance sheet equity figure available.');
  if (equity > 0) return { id: 'shareholder-equity', label: 'Positive shareholder equity', status: 'pass', detail: 'Book value of equity is positive.' };
  return {
    id: 'shareholder-equity',
    label: 'Positive shareholder equity',
    status: 'fail',
    detail: 'Book value of equity is negative — liabilities exceed assets on the balance sheet, a real distress signal worth understanding before trusting any valuation here.',
  };
}

export function buildFundamentalsChecklist(statements: FmpStatements, now: Date = new Date()): ChecklistItem[] {
  return [
    checkDataRecency(statements, now),
    checkFreeCashFlow(statements),
    checkProfitability(statements),
    checkDebtLevel(statements),
    checkLiquidity(statements),
    checkShareholderEquity(statements),
  ];
}
