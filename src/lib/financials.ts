// Server-side client for the FastAPI /financials endpoints.
// Runs only on the server (called from a Server Component), so the API URL
// and token never reach the browser and you avoid CORS entirely.

import "server-only";

const API_BASE = (
  process.env.DART_API_URL ?? "http://127.0.0.1:8000/api/v1"
).replace(/\/$/, "");
const API_TOKEN = process.env.FINANCIALS_API_TOKEN;

// Pydantic v2 serialises Decimal as a string, so accept both.
export type Num = number | string | null;

export const toNum = (v: Num | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/* ---------- Response types (mirroring app/schemas/financials.py) ---------- */

type Envelope<F, D> = {
  appliedFilters: F;
  currency: string;
  dataAsOf: string | null;
  data: D;
};

type PeriodFilters = {
  companyIds: string[];
  year: number;
  quarter: number | null;
  month: number | null;
};

export type SummaryData = {
  periodLabel: string;
  revenue: Num;
  expense: Num;
  net: Num;
  netMarginPct: Num;
  comparison: {
    label: string;
    revenue: Num;
    expense: Num;
    net: Num;
    revenueChangePct: Num;
    expenseChangePct: Num;
    netChangePct: Num;
  };
};
export type SummaryResponse = Envelope<PeriodFilters, SummaryData>;

export type Totals = { revenue: Num; expense: Num; net: Num };
export type TrendPoint = Totals & {
  period: string;
  label: string;
  isClosed: boolean;
  priorYear?: Totals;
};
export type TrendResponse = Envelope<
  {
    companyIds: string[];
    year: number;
    granularity: "month" | "quarter";
    includePriorYear: boolean;
  },
  TrendPoint[]
>;

export type BreakdownType = "revenue" | "expense";
export type BreakdownItem = {
  categoryId: string;
  categoryName: string;
  amount: Num;
  sharePct: Num;
  priorYearAmount: Num;
  changePct: Num;
};
export type BreakdownResponse = Envelope<
  PeriodFilters & { type: BreakdownType; top: number },
  BreakdownItem[]
> & {
  total: Num;
};

/* ---------- Fetch helpers ---------- */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

async function get<T>(path: string, params: Params): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${API_BASE}/financials${path}?${qs}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    let code = "HTTP_ERROR";
    try {
      const body = await res.json();
      message =
        body?.error?.message ??
        (typeof body?.detail === "string" ? body.detail : message);
      code = body?.error?.code ?? code;
    } catch {}
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

export type PeriodQuery = { year: number; quarter?: number; month?: number };

export const getSummary = (p: PeriodQuery) =>
  get<SummaryResponse>("/summary", p);

export const getTrend = (
  year: number,
  granularity: "month" | "quarter" = "month",
  includePriorYear = false,
) =>
  get<TrendResponse>("/trend", {
    year,
    granularity,
    includePriorYear: includePriorYear || undefined,
  });

export const getBreakdown = (type: BreakdownType, p: PeriodQuery, top = 8) =>
  get<BreakdownResponse>("/breakdown", { type, top, ...p });
