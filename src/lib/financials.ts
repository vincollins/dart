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

async function get<T>(
  path: string,
  params: Params,
  // Most endpoints live under /financials; a few (e.g. /companies) sit at the API root.
  prefix = "/financials",
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  // Retry network errors and 5xx responses a couple of times, so a single
  // hiccup doesn't make a year or company disappear. "No data" (404) is a real
  // answer and is not retried.
  const url = `${API_BASE}${prefix}${path}?${qs}`;
  const init = {
    cache: "no-store" as const,
    headers: {
      Accept: "application/json",
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    },
  };
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, init);
      if (res.status < 500) break;
    } catch (err) {
      if (attempt === 2) throw err;
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  if (!res) throw new ApiError(0, "NETWORK_ERROR", "The data service did not respond.");
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

// A single selected company id, or undefined for the whole CPF Group (all companies).
export type CompanyId = string | undefined;

export type Company = { id: string; name: string; shortName: string };
export const getCompanies = () =>
  get<{ data: Company[] }>("/companies", {}, "").then((r) => r.data);

export const getSummary = (p: PeriodQuery, companyId?: CompanyId) =>
  get<SummaryResponse>("/summary", { ...p, companyIds: companyId });

export const getTrend = (
  year: number,
  granularity: "month" | "quarter" = "month",
  includePriorYear = false,
  companyId?: CompanyId,
) =>
  get<TrendResponse>("/trend", {
    year,
    granularity,
    includePriorYear: includePriorYear || undefined,
    companyIds: companyId,
  });

export const getBreakdown = (
  type: BreakdownType,
  p: PeriodQuery,
  top = 8,
  companyId?: CompanyId,
) => get<BreakdownResponse>("/breakdown", { type, top, ...p, companyIds: companyId });
