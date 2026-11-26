"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

export type FilterOption = {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
};

type Selection = { company: string; year: string; quarter: string };

const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";

// Changing a dropdown navigates inside the app (no full page load). The current
// dashboard stays on screen while the new figures load in the background, and
// the selected value shows straight away.
export function PeriodFilter({
  bd,
  company,
  year,
  quarter,
  companies,
  years,
  quarters,
}: {
  bd: string;
  company: string;
  year: string;
  quarter: string;
  companies: FilterOption[];
  years: FilterOption[];
  quarters: FilterOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<Selection, Selection>(
    { company, year, quarter },
    (_current, next) => next,
  );

  const change = (patch: Partial<Selection>) => {
    const next = { ...shown, ...patch };
    const params = new URLSearchParams({ bd });
    if (next.company) params.set("company", next.company);
    params.set("year", next.year);
    params.set("quarter", next.quarter);
    startTransition(() => {
      setShown(next);
      router.push(`?${params}`, { scroll: false });
    });
  };

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <form
        aria-label="Period filters"
        aria-busy={isPending}
        onSubmit={(e) => e.preventDefault()}
        className="grid w-full grid-cols-2 items-end gap-3 sm:flex sm:w-auto"
      >
        <FilterSelect
          label="Company"
          value={shown.company}
          options={companies}
          onChange={(v) => change({ company: v })}
        />
        <FilterSelect
          label="Year"
          value={shown.year}
          options={years}
          onChange={(v) => change({ year: v })}
        />
        <FilterSelect
          label="Quarter"
          value={shown.quarter}
          options={quarters}
          onChange={(v) => change({ quarter: v })}
        />
      </form>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex h-4 items-end whitespace-nowrap pl-2 text-[11px] font-medium uppercase leading-none tracking-wide text-muted">
        {label}
      </span>
      <span className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          className={`card-raised h-10 w-full appearance-none sm:w-auto rounded-lg border border-line bg-surface py-2 pl-3 pr-9 text-sm font-medium text-ink ${focus}`}
        >
          {options.map((o) => (
            <option
              key={o.value}
              value={o.value}
              disabled={o.disabled}
              title={o.title}
            >
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
      </span>
    </label>
  );
}
