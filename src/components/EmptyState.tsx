import { FileSearch } from "lucide-react";

// Adapted from DART Component Library/EmptyState.tsx: theme tokens instead of
// fixed slate colours. Used for empty results and for periods not closed yet.
interface EmptyStateProps {
  title?: string;
  message?: string;
}

export default function EmptyState({
  title = "No data available",
  message = "There is currently no information to display.",
}: EmptyStateProps) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface p-6 text-center">
      <FileSearch aria-hidden className="mb-3 size-10 text-muted" />
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted">{message}</p>
    </div>
  );
}
