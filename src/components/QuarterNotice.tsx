import { Info } from "lucide-react";

// Shown when the selected quarter is still in progress: the figures only cover
// the months that have closed so far, so we flag that the numbers are partial
// and will keep updating as later months arrive.
interface QuarterNoticeProps {
  quarter: number;
  year: number;
}

export default function QuarterNotice({ quarter, year }: QuarterNoticeProps) {
  // Live "as of" date: reflects the exact day the page is viewed, updating daily.
  const asOfText = new Date().toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-dashed border-amber-400/60 bg-amber-400/10 p-4 text-sm text-ink"
    >
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-500" />
      <p className="min-w-0">
        <span className="font-semibold">Q{quarter} {year} in progress.</span>{" "}
        These figures cover only the months reported so far, as of {asOfText},
        and will update as the quarter closes.
      </p>
    </div>
  );
}
