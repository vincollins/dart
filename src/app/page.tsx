import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Landmark,
  Percent,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { PeriodFilter } from "./period-filter";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";
import Loading from "../components/Loading";
import { connection } from "next/server";
import {
  ApiError,
  getBreakdown,
  getSummary,
  getTrend,
  toNum,
  type BreakdownResponse,
  type BreakdownType,
  type Num,
  type SummaryResponse,
  type TrendResponse,
} from "../lib/financials";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const YEARS_BACK = 5;

/* ---------- shared class strings ---------- */

const panel =
  "card-raised min-w-0 rounded-xl border border-line bg-surface p-5 sm:p-6";
const muted = "text-muted";
const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#28ADDB]";

/* ---------- formatting ---------- */

function money(v: Num, currency: string, compact = false) {
  const n = toNum(v);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(n);
}

// Assumes the API returns percentages as e.g. 12.5 (not 0.125).
function pct(v: Num, signed = false) {
  const n = toNum(v);
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function change(cur: number | null, prev: number | null) {
  if (cur === null || prev === null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// Change indicator: arrow + signed percent, coloured by whether the move is good.
function Delta({
  v,
  goodWhenUp,
  pill = false,
}: {
  v: Num;
  goodWhenUp: boolean;
  pill?: boolean;
}) {
  const n = toNum(v);
  if (n === null || n === 0) return <span className={muted}>{pct(v, true)}</span>;
  const good = n > 0 === goodWhenUp;
  const Icon = n > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap font-semibold ${
        good ? "text-positive" : "text-negative"
      } ${
        pill
          ? `rounded-full px-2 py-0.5 ${good ? "bg-positive/10" : "bg-negative/10"}`
          : ""
      }`}
    >
      <Icon aria-hidden className="size-3.5" />
      {pct(v, true)}
    </span>
  );
}

/* ---------- yearly rows built from quarterly /trend calls ---------- */

type Q = {
  q: number;
  closed: boolean;
  revenue: number | null;
  expense: number | null;
  net: number | null;
};
type YearRow = {
  year: number;
  quarters: Q[];
  complete: boolean; // every quarter closed
  closedThrough: number; // last closed quarter, 0 if none
  revenue: number | null; // full year if complete, else closed quarters only (YTD)
  expense: number | null;
  net: number | null;
  hasData: boolean;
};

function sumOf(qs: Q[], key: "revenue" | "expense" | "net") {
  let total = 0;
  let any = false;
  for (const q of qs) {
    if (q[key] !== null) {
      total += q[key]!;
      any = true;
    }
  }
  return any ? total : null;
}

function toYearRow(year: number, res: TrendResponse): YearRow {
  const quarters: Q[] = res.data.map((p, i) => ({
    q: i + 1,
    closed: p.isClosed,
    revenue: toNum(p.revenue),
    expense: toNum(p.expense),
    net: toNum(p.net),
  }));
  const complete = quarters.length > 0 && quarters.every((q) => q.closed);
  const closed = quarters.filter((q) => q.closed);
  const used = complete ? quarters : closed;
  return {
    year,
    quarters,
    complete,
    closedThrough: closed.length ? Math.max(...closed.map((q) => q.q)) : 0,
    revenue: sumOf(used, "revenue"),
    expense: sumOf(used, "expense"),
    net: sumOf(used, "net"),
    hasData: quarters.some((q) => q.revenue !== null || q.expense !== null),
  };
}

// Prior year over the same quarters, so a YTD row compares like with like.
function priorComparable(row: YearRow, prev: YearRow | undefined) {
  if (!prev) return null;
  const qs = row.complete
    ? prev.quarters
    : prev.quarters.filter((q) => q.q <= row.closedThrough);
  return {
    revenue: sumOf(qs, "revenue"),
    expense: sumOf(qs, "expense"),
    net: sumOf(qs, "net"),
  };
}

/* ---------- page ---------- */

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

function DashboardSkeleton() {
  const block =
    "animate-pulse rounded-xl bg-hover motion-reduce:animate-none";
  return (
    <div className="min-h-screen bg-page">
      <main
        className="mx-auto max-w-[calc(80rem+2cm)] p-4 sm:p-6 lg:p-10"
        aria-busy="true"
        aria-label="Loading dashboard"
      >
        <div className={`mb-8 h-10 w-72 ${block}`} />
        <div className={`mb-6 h-36 ${block}`} />
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className={`h-96 ${block}`} />
          <div className={`h-96 ${block}`} />
        </div>
        <div className={`h-80 ${block}`} />
      </main>
    </div>
  );
}

async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  await connection(); // render per request; makes new Date() safe
  const sp = await searchParams;
  const thisYear = new Date().getFullYear();
  const bd: BreakdownType = one(sp.bd) === "revenue" ? "revenue" : "expense";

  // Step 1: quarterly trend for recent years. Feeds the year-over-year panel
  // and tells us which periods are closed, so the default never asks for an open one.
  const yearList = Array.from(
    { length: YEARS_BACK },
    (_, i) => thisYear - YEARS_BACK + 1 + i,
  );
  const yearly = await Promise.allSettled(
    yearList.map((y) => getTrend(y, "quarter")),
  );
  const rows = yearly
    .map((r, i) =>
      r.status === "fulfilled" ? toYearRow(yearList[i], r.value) : null,
    )
    .filter((r): r is YearRow => r !== null && r.hasData);
  const rowFor = (y: number) => rows.find((r) => r.year === y);

  // Latest closed quarter across all years, used when no period is in the URL.
  const latest = [...rows].reverse().find((r) => r.closedThrough > 0);
  const bestQuarterFor = (r: YearRow | undefined) =>
    r && !r.complete && r.closedThrough ? r.closedThrough : undefined;

  const yearParam = Number(one(sp.year));
  const year = yearParam || latest?.year || thisYear;
  const quarterRaw = Number(one(sp.quarter));
  const quarter = yearParam
    ? quarterRaw >= 1 && quarterRaw <= 4
      ? quarterRaw
      : undefined
    : latest
      ? latest.complete
        ? undefined
        : latest.closedThrough
      : undefined;
  const period = { year, quarter };

  // Periods with no figures yet (a quarter still open, or a year outside the
  // window) are not requested. They render as "not available" empty states.
  const selectedRow = rowFor(year);
  const quarterOpen =
    !!quarter &&
    !!selectedRow &&
    !selectedRow.quarters.find((x) => x.q === quarter)?.closed;
  const noFigures = !yearList.includes(year) || quarterOpen;
  const noFiguresMsg = !yearList.includes(year)
    ? `There is no data for ${year}.`
    : `${quarter ? `Q${quarter} ${year}` : year} isn’t closed yet.`;

  // Step 2: the period summary is awaited (it sets the title and currency).
  // The monthly trend and breakdown start now and stream into their own panels.
  const trendP = noFigures
    ? Promise.resolve(unavailable<TrendResponse>(noFiguresMsg))
    : settled(getTrend(year, "month", true));
  const breakdownP = noFigures
    ? Promise.resolve(unavailable<BreakdownResponse>(noFiguresMsg))
    : settled(getBreakdown(bd, period, 3));
  const summary: PromiseSettledResult<SummaryResponse> = noFigures
    ? unavailable<SummaryResponse>(noFiguresMsg)
    : await settled(getSummary(period));

  const firstOk = [summary, ...yearly].find(
    (r) => r.status === "fulfilled",
  ) as
    | PromiseFulfilledResult<{ currency: string; dataAsOf: string | null }>
    | undefined;
  const currency = firstOk?.value.currency ?? "USD";
  const asOf = firstOk?.value.dataAsOf ?? null;

  const href = (patch: {
    year?: number;
    quarter?: number | null;
    bd?: BreakdownType;
  }) => {
    const q = new URLSearchParams();
    const y = patch.year ?? year;
    const qq = patch.quarter === undefined ? quarter : patch.quarter;
    q.set("year", String(y));
    if (qq) q.set("quarter", String(qq));
    q.set("bd", patch.bd ?? bd);
    return `?${q}`;
  };

  // The selected year is always an option, so an out-of-window year is not
  // silently replaced by the first year in the list.
  const yearOptions = [...new Set([...rows.map((r) => r.year), year])].sort(
    (a, b) => a - b,
  );
  const yearItems = yearOptions.map(
    (y) => ({
      key: String(y),
      label: String(y),
      current: y === year,
      href: href({ year: y, quarter: bestQuarterFor(rowFor(y)) ?? null }),
    }),
  );
  const quarterItems = [
    {
      key: "fy",
      label: "Full year",
      current: !quarter,
      href: href({ quarter: null }),
      disabledReason:
        selectedRow && !selectedRow.complete
          ? `${year} isn’t closed yet`
          : undefined,
    },
    // Every quarter can be picked; an open one shows the "not available" state.
    ...[1, 2, 3, 4].map((q) => ({
      key: `q${q}`,
      label: `Q${q}`,
      current: quarter === q,
      href: href({ quarter: q }),
      disabledReason: undefined as string | undefined,
    })),
  ];


  return (
    <div className="min-h-screen bg-page text-ink tabular-nums">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 text-ink sm:px-6 lg:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dart-logo.png"
          alt="Dart"
          className="size-8 rounded-lg object-cover shadow-sm ring-1 ring-inset ring-line"
        />
        <span className="text-base font-semibold">Dart</span>
        <span className="mx-1 h-5 w-px bg-line" />
        <span className="text-sm text-muted">Financial Reporting</span>
      </div>
      <main className="mx-auto max-w-[calc(80rem+2cm)] p-4 sm:p-6 lg:p-10">
        {/* Header + period controls */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
              {summary.status === "fulfilled"
                ? summary.value.data.periodLabel
                : quarter
                  ? `Q${quarter} ${year}`
                  : year}
            </h1>
            <p className={`mt-1.5 text-sm ${muted}`}>
              Financial overview
              {summary.status === "fulfilled" && (
                <>, compared with {summary.value.data.comparison.label}</>
              )}
              {asOf && (
                <>
                  . Data as of{" "}
                  {new Date(asOf).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                  .
                </>
              )}
            </p>
          </div>
          <PeriodFilter
            // Remount when the period changes so the dropdowns show the new value.
            key={`${year}-${quarter ?? "fy"}-${bd}`}
            bd={bd}
            year={String(year)}
            quarter={quarter ? String(quarter) : ""}
            years={yearItems.map((y) => ({ value: y.key, label: y.label }))}
            quarters={quarterItems.map((q) => ({
              value: q.key === "fy" ? "" : q.label.slice(1),
              label: q.label === "Full year" ? "All" : q.label,
              disabled: !!q.disabledReason && !q.current,
              title: q.disabledReason,
            }))}
          />
        </header>

        {/* KPI strip */}
        <section aria-label="Headline totals" className="mb-6">
          <Suspense fallback={<Loading message="Loading totals…" />}>
            <KpiPanel summary={summary} trend={trendP} />
          </Suspense>
        </section>

        {/* Monthly trend + breakdown */}
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <section className={panel} aria-labelledby="trend-h">
            <PanelHead
              id="trend-h"
              title={`Month by month, ${year}`}
              note={
                quarter
                  ? `Q${quarter} is shaded. Faded months are still open.`
                  : "Faded months are still open."
              }
            >
              <Legend withPrior />
            </PanelHead>
            <Suspense fallback={<Loading message="Loading monthly trend…" />}>
              <TrendPanel
                trend={trendP}
                year={year}
                quarter={quarter}
                currency={currency}
              />
            </Suspense>
          </section>

          <section className={panel} aria-labelledby="bd-h">
            <PanelHead
              id="bd-h"
              title={`Largest ${bd === "expense" ? "expense" : "revenue"} categories`}
            >
              <Segmented
                label="Breakdown type"
                size="sm"
                items={(["expense", "revenue"] as const).map((t) => ({
                  key: t,
                  label: t === "expense" ? "Expenses" : "Revenue",
                  current: bd === t,
                  href: href({ bd: t }),
                }))}
              />
            </PanelHead>
            <Suspense fallback={<Loading message="Loading categories…" />}>
              <BreakdownPanel data={breakdownP} type={bd} />
            </Suspense>
          </section>
        </div>

        {/* Year over year */}
        <section className={panel} aria-labelledby="yoy-h">
          <PanelHead
            id="yoy-h"
            title="Year over year"
            note="An unfinished year shows its closed quarters only and is compared with the same quarters a year earlier."
          >
            <Legend />
          </PanelHead>
          {rows.length ? (
            <YearOverYear
              rows={rows}
              selectedYear={year}
              currency={currency}
              href={(y) =>
                href({ year: y, quarter: bestQuarterFor(rowFor(y)) ?? null })
              }
            />
          ) : yearly.every((r) => r.status === "rejected") ? (
            <ErrorNote
              what="the yearly history"
              reason={(yearly[0] as PromiseRejectedResult).reason}
            />
          ) : (
            <EmptyState
              title="No history yet"
              message={`Nothing is recorded for the last ${YEARS_BACK} years.`}
            />
          )}
        </section>
      </main>
    </div>
  );
}

/* ---------- streamed panels ---------- */

// A period with no figures, shown through the same path as an API "not available".
function unavailable<T>(message: string): PromiseSettledResult<T> {
  return {
    status: "rejected",
    reason: new ApiError(404, "DATA_NOT_AVAILABLE", message),
  };
}

// Starts a request without letting a failure reject; the panel shows the error.
function settled<T>(p: Promise<T>): Promise<PromiseSettledResult<T>> {
  return p.then(
    (value) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<T>,
    (reason: unknown) => ({ status: "rejected", reason }) as PromiseRejectedResult,
  );
}

async function KpiPanel({
  summary,
  trend,
}: {
  summary: PromiseSettledResult<SummaryResponse>;
  trend: Promise<PromiseSettledResult<TrendResponse>>;
}) {
  const t = await trend;
  const monthly = t.status === "fulfilled" ? t.value.data : [];
  return summary.status === "fulfilled" ? (
    <Kpis res={summary.value} monthly={monthly} />
  ) : (
    <ErrorNote what="headline totals" reason={summary.reason} />
  );
}

async function TrendPanel({
  trend,
  year,
  quarter,
  currency,
}: {
  trend: Promise<PromiseSettledResult<TrendResponse>>;
  year: number;
  quarter: number | undefined;
  currency: string;
}) {
  const t = await trend;
  if (t.status !== "fulfilled") {
    return <ErrorNote what="the monthly trend" reason={t.reason} />;
  }
  const monthly = t.value.data;
  return (
    <ComboChart
      ariaLabel={`Revenue, expenses and net by month for ${year}, with prior-year net`}
      currency={currency}
      cats={monthly.map((p, i) => ({
        key: p.period,
        label: p.label,
        faded: !p.isClosed,
        highlight: !!quarter && i >= (quarter - 1) * 3 && i < quarter * 3,
      }))}
      revenue={monthly.map((p) => toNum(p.revenue))}
      expense={monthly.map((p) => toNum(p.expense))}
      net={monthly.map((p) => toNum(p.net))}
      netPrior={monthly.map((p) => toNum(p.priorYear?.net))}
      empty="No postings for this year yet."
    />
  );
}

async function BreakdownPanel({
  data,
  type,
}: {
  data: Promise<PromiseSettledResult<BreakdownResponse>>;
  type: BreakdownType;
}) {
  const b = await data;
  return b.status === "fulfilled" ? (
    <Breakdown res={b.value} type={type} />
  ) : (
    <ErrorNote what="the breakdown" reason={b.reason} />
  );
}

/* ---------- small building blocks ---------- */

type SegItem = {
  key: string;
  label: string;
  current: boolean;
  href: string;
  disabledReason?: string;
};

function Segmented({
  label,
  items,
  size = "md",
}: {
  label: string;
  items: SegItem[];
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <nav
      aria-label={label}
      className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {items.map((it) =>
        it.disabledReason && !it.current ? (
          <span
            key={it.key}
            aria-disabled="true"
            title={it.disabledReason}
            className={`${pad} cursor-not-allowed rounded-md text-muted/40`}
          >
            {it.label}
          </span>
        ) : (
          <Link
            key={it.key}
            href={it.href}
            scroll={false}
            aria-current={it.current ? "true" : undefined}
            className={`${pad} rounded-md font-medium transition-colors ${focus} ${
              it.current
                ? "bg-blue text-white"
                : "text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            {it.label}
          </Link>
        ),
      )}
    </nav>
  );
}

function PanelHead({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {note && (
          <p className={`mt-0.5 max-w-prose text-xs ${muted}`}>{note}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function Legend({ withPrior = false }: { withPrior?: boolean }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-xs ${muted}`}>
      <li className="flex items-center gap-1.5">
        <i className="size-2.5 rounded-sm bg-[#28ADDB]" />
        Revenue
      </li>
      <li className="flex items-center gap-1.5">
        <i className="size-2.5 rounded-sm bg-[#DF0061]" />
        Expenses
      </li>
      <li className="flex items-center gap-1.5">
        <i className="h-0.5 w-4 bg-accent" />
        Net
      </li>
      {withPrior && (
        <li className="flex items-center gap-1.5">
          <i className="w-4 border-t-2 border-dashed border-muted" />
          Net, prior year
        </li>
      )}
    </ul>
  );
}

function Sparkline({
  values,
  className,
}: {
  values: (number | null)[];
  className: string;
}) {
  const pts = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const W = 96,
    H = 32,
    pad = 3;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) =>
    pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + ((hi - v) / (hi - lo || 1)) * (H - pad * 2);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden
      className="shrink-0 overflow-visible"
    >
      <path
        d={d}
        fill="none"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={className}
      />
      <circle
        cx={x(last.i)}
        cy={y(last.v)}
        r={2.5}
        className={className.replace(/stroke-/g, "fill-")}
      />
    </svg>
  );
}

/* ---------- KPIs ---------- */

function Kpis({
  res,
  monthly,
}: {
  res: SummaryResponse;
  monthly: TrendResponse["data"];
}) {
  const d = res.data;
  const c = d.comparison;
  const cur = res.currency;
  const items = [
    {
      label: "Revenue",
      value: money(d.revenue, cur),
      change: c.revenueChangePct,
      prior: c.revenue,
      up: true,
      spark: monthly.map((p) => toNum(p.revenue)),
      stroke: "stroke-primary",
      Icon: TrendingUp,
      tile: "bg-primary/10 text-primary",
    },
    {
      label: "Expenses",
      value: money(d.expense, cur),
      change: c.expenseChangePct,
      prior: c.expense,
      up: false,
      spark: monthly.map((p) => toNum(p.expense)),
      stroke: "stroke-secondary",
      Icon: Wallet,
      tile: "bg-secondary/10 text-secondary",
    },
    {
      label: "Net result",
      value: money(d.net, cur),
      change: c.netChangePct,
      prior: c.net,
      up: true,
      spark: monthly.map((p) => toNum(p.net)),
      stroke: "stroke-accent",
      Icon: Landmark,
      tile: "bg-blue/10 text-blue",
    },
  ];
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k) => (
        <div
          key={k.label}
          className="card-raised flex min-w-0 flex-col rounded-xl border border-line bg-surface p-5 sm:p-6"
        >
          <div className="flex items-center gap-3">
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-lg shadow-sm ring-1 ring-inset ring-line ${k.tile}`}
            >
              <k.Icon aria-hidden className="size-4.5" />
            </span>
            <dt className={`text-xs font-medium uppercase tracking-wide ${muted}`}>
              {k.label}
            </dt>
            <span className="ml-auto">
              <Sparkline values={k.spark} className={k.stroke} />
            </span>
          </div>
          <dd className="mt-5 text-2xl font-semibold tracking-tight lg:text-[1.75rem]">
            {k.value}
          </dd>
          <dd
            className={`mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-4 text-xs ${muted}`}
          >
            <Delta v={k.change} goodWhenUp={k.up} pill />
            <span>
              vs {c.label}{" "}
              <span className="whitespace-nowrap">
                ({money(k.prior, cur, true)})
              </span>
            </span>
          </dd>
        </div>
      ))}
      <div className="card-raised flex flex-col rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/20 text-ink shadow-sm ring-1 ring-inset ring-line">
            <Percent aria-hidden className="size-4.5" />
          </span>
          <dt className={`text-xs font-medium uppercase tracking-wide ${muted}`}>
            Net margin
          </dt>
        </div>
        <dd className="mt-5 text-2xl font-semibold tracking-tight lg:text-[1.75rem]">
          {pct(d.netMarginPct)}
        </dd>
        <dd
          className={`mt-4 border-t border-line pt-4 text-xs ${muted}`}
        >
          Net result as a share of revenue
        </dd>
      </div>
    </dl>
  );
}

/* ---------- Combo chart: revenue/expense bars + net line (plain SVG) ---------- */

type Cat = { key: string; label: string; faded?: boolean; highlight?: boolean };

function ComboChart(props: {
  cats: Cat[];
  revenue: (number | null)[];
  expense: (number | null)[];
  net: (number | null)[];
  netPrior?: (number | null)[];
  currency: string;
  ariaLabel: string;
  empty: string;
  height?: number;
  width?: number;
  maxBar?: number;
}) {
  const {
    cats,
    revenue,
    expense,
    net,
    netPrior = [],
    currency: cur,
    height: H = 300,
    width: W = 760,
    maxBar = 16,
  } = props;
  const vals = [...revenue, ...expense, ...net, ...netPrior].filter(
    (v): v is number => v !== null,
  );
  if (!cats.length || !vals.length) {
    return <EmptyState title="No data yet" message={props.empty} />;
  }

  const padL = 84,
    padR = 12,
    padT = 12,
    padB = 30;
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const y = (v: number) => padT + ((max - v) / span) * (H - padT - padB);
  const y0 = y(0);
  const band = (W - padL - padR) / cats.length;
  const barW = Math.max(4, Math.min(maxBar, band * 0.28));
  const cx = (i: number) => padL + band * (i + 0.5);
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
  const axis = "fill-muted text-[11px]";

  const line = (series: (number | null)[]) =>
    series
      .map((v, i) => (v === null ? null : { i, v }))
      .filter((p): p is { i: number; v: number } => p !== null)
      .map((p, k) => `${k ? "L" : "M"}${cx(p.i)},${y(p.v)}`)
      .join(" ");

  const bar = (v: number | null, x: number, cls: string, title: string) =>
    v === null ? null : (
      <rect
        x={x}
        y={Math.min(y(v), y0)}
        width={barW}
        height={Math.max(1, Math.abs(y(v) - y0))}
        rx={2}
        className={cls}
      >
        <title>{title}</title>
      </rect>
    );

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={props.ariaLabel}
        className="block h-auto w-full min-w-[520px]"
      >
        {cats.map((c, i) =>
          c.highlight ? (
            <rect
              key={`hl-${c.key}`}
              x={padL + band * i}
              y={padT}
              width={band}
              height={H - padT - padB}
              className="fill-[#28ADDB]/[0.08]"
            />
          ) : null,
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(t)}
              y2={y(t)}
              className="stroke-line"
            />
            <text
              x={padL - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className={axis}
            >
              {money(t, cur, true)}
            </text>
          </g>
        ))}
        <line
          x1={padL}
          x2={W - padR}
          y1={y0}
          y2={y0}
          className="stroke-muted/40"
        />

        {cats.map((c, i) => (
          <g key={c.key} className={c.faded ? "opacity-40" : undefined}>
            {bar(
              revenue[i],
              cx(i) - barW - 1,
              "fill-[#28ADDB]",
              `${c.label} revenue: ${money(revenue[i], cur)}`,
            )}
            {bar(
              expense[i],
              cx(i) + 1,
              "fill-[#DF0061]",
              `${c.label} expenses: ${money(expense[i], cur)}`,
            )}
            <text
              x={cx(i)}
              y={H - 10}
              textAnchor="middle"
              className={`${axis} ${c.highlight ? "fill-ink font-semibold" : ""}`}
            >
              {c.label}
            </text>
          </g>
        ))}

        {netPrior.some((v) => v !== null) && (
          <path
            d={line(netPrior)}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            className="stroke-muted"
          />
        )}
        <path
          d={line(net)}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-accent"
        />
        {net.map((v, i) =>
          v === null ? null : (
            <circle
              key={i}
              cx={cx(i)}
              cy={y(v)}
              r={3.5}
              strokeWidth={2}
              className="fill-surface stroke-accent"
            >
              <title>
                {`${cats[i].label} net: ${money(v, cur)}${
                  netPrior[i] != null
                    ? ` (prior year ${money(netPrior[i]!, cur)})`
                    : ""
                }`}
              </title>
            </circle>
          ),
        )}
      </svg>
    </div>
  );
}

/* ---------- Year over year ---------- */

function YearOverYear({
  rows,
  selectedYear,
  currency: cur,
  href,
}: {
  rows: YearRow[];
  selectedYear: number;
  currency: string;
  href: (year: number) => string;
}) {
  const label = (r: YearRow) => (r.complete ? String(r.year) : `${r.year} YTD`);
  const table = rows
    .map((r, i) => {
      const prior = priorComparable(
        r,
        rows[i - 1]?.year === r.year - 1 ? rows[i - 1] : undefined,
      );
      return {
        r,
        margin: r.revenue && r.net !== null ? (r.net / r.revenue) * 100 : null,
        revChange: change(r.revenue, prior?.revenue ?? null),
        netChange: change(r.net, prior?.net ?? null),
      };
    })
    .reverse();

  return (
    <div className="grid grid-cols-1 gap-8">
      <ComboChart
        ariaLabel="Revenue, expenses and net by year"
        currency={cur}
        width={1400}
        height={240}
        maxBar={36}
        cats={rows.map((r) => ({
          key: String(r.year),
          label: label(r),
          faded: !r.complete,
          highlight: r.year === selectedYear,
        }))}
        revenue={rows.map((r) => r.revenue)}
        expense={rows.map((r) => r.expense)}
        net={rows.map((r) => r.net)}
        empty="No yearly history yet."
      />
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr
              className={`border-b border-line text-left text-xs ${muted}`}
            >
              <th scope="col" className="py-2 pr-3 font-medium">
                Year
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Revenue
              </th>
              <th
                scope="col"
                className="hidden px-3 py-2 text-right font-medium md:table-cell"
              >
                Expenses
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Net
              </th>
              <th
                scope="col"
                className="hidden px-3 py-2 text-right font-medium md:table-cell"
              >
                Margin
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Revenue change
              </th>
              <th
                scope="col"
                className="hidden py-2 pl-3 text-right font-medium sm:table-cell"
              >
                Net change
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map(({ r, margin, revChange, netChange }) => {
              const sel = r.year === selectedYear;
              return (
                <tr
                  key={r.year}
                  className={`border-b border-line last:border-0 ${sel ? "bg-blue/10" : ""}`}
                >
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    <Link
                      href={href(r.year)}
                      scroll={false}
                      className={`rounded hover:underline ${focus}`}
                      aria-current={sel ? "true" : undefined}
                    >
                      {r.year}
                    </Link>
                    {!r.complete && (
                      <span className={`ml-1.5 text-xs font-normal ${muted}`}>
                        {r.closedThrough ? `to Q${r.closedThrough}` : "open"}
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2.5 text-right">
                    {money(r.revenue, cur)}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right md:table-cell">
                    {money(r.expense, cur)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">
                    {money(r.net, cur)}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right md:table-cell">
                    {pct(margin)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex justify-end">
                      <Delta v={revChange} goodWhenUp />
                    </span>
                  </td>
                  <td className="hidden py-2.5 pl-3 text-right sm:table-cell">
                    <span className="inline-flex justify-end">
                      <Delta v={netChange} goodWhenUp />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Breakdown ---------- */

function Breakdown({
  res,
  type,
}: {
  res: BreakdownResponse;
  type: BreakdownType;
}) {
  const cur = res.currency;
  if (!res.data.length) {
    return (
      <EmptyState
        title={`No ${type} recorded`}
        message="There are no postings for this period."
      />
    );
  }
  const maxShare = Math.max(...res.data.map((r) => toNum(r.sharePct) ?? 0), 1);
  const fill = type === "expense" ? "bg-[#DF0061]" : "bg-[#28ADDB]";
  return (
    <>
      <ol className="grid gap-4">
        {res.data.map((r, i) => {
          const share = toNum(r.sharePct) ?? 0;
          return (
            <li
              key={r.categoryId}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2"
            >
              <span className={`pt-px text-xs ${muted}`}>{i + 1}</span>
              <div>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="truncate">{r.categoryName}</span>
                  <span className="font-semibold">{money(r.amount, cur)}</span>
                </div>
                <div
                  aria-hidden
                  className="my-1.5 h-1.5 overflow-hidden rounded-full bg-hover"
                >
                  <div
                    className={`h-full rounded-full ${fill}`}
                    style={{ width: `${(share / maxShare) * 100}%` }}
                  />
                </div>
                <div className={`flex justify-between gap-3 text-xs ${muted}`}>
                  <span>{pct(r.sharePct)} of total</span>
                  <span>
                    <Delta v={r.changePct} goodWhenUp={type === "revenue"} />{" "}
                    vs prior year
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p
        className={`mt-5 flex justify-between border-t border-line pt-3 text-sm ${muted}`}
      >
        <span>Total {type === "expense" ? "expenses" : "revenue"}</span>
        <strong className="text-ink">
          {money(res.total, cur)}
        </strong>
      </p>
    </>
  );
}

/* ---------- errors ---------- */

// A period that is still open (or has no data) is an empty state, not a failure.
// Anything else is an error state.
function ErrorNote({ what, reason }: { what: string; reason: unknown }) {
  if (reason instanceof ApiError && reason.code === "DATA_NOT_AVAILABLE") {
    return (
      <EmptyState
        title="Not available yet"
        message={`${reason.message} Pick an earlier period.`}
      />
    );
  }
  return reason instanceof ApiError ? (
    <ErrorState
      statusCode={reason.status}
      title={`Couldn’t load ${what}`}
      message={reason.message}
    />
  ) : (
    <ErrorState
      title={`Couldn’t load ${what}`}
      message="Check that the API is running and DART_API_URL is set."
    />
  );
}
