"use client";

import { ChevronDown } from "lucide-react";

export type FilterOption = {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
};

const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";

// Changing a dropdown submits the GET form, which updates the URL and the
// server-rendered dashboard. No Apply button is needed.
export function PeriodFilter({
  bd,
  year,
  quarter,
  years,
  quarters,
}: {
  bd: string;
  year: string;
  quarter: string;
  years: FilterOption[];
  quarters: FilterOption[];
}) {
  return (
    <form
      method="get"
      aria-label="Period filters"
      className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto"
    >
      <input type="hidden" name="bd" value={bd} />
      <FilterSelect
        label="Year"
        name="year"
        value={year}
        options={years}
      />
      <FilterSelect
        label="Quarter"
        name="quarter"
        value={quarter}
        options={quarters}
      />
    </form>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: FilterOption[];
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 sm:w-40">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="relative">
        <select
          name={name}
          defaultValue={value}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={`h-10 w-full appearance-none rounded-lg border border-line bg-surface py-2 pl-3 pr-9 text-sm font-medium text-ink ${focus}`}
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
