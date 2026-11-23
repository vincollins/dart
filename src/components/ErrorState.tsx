import { AlertCircle } from "lucide-react";

// Adapted from DART Component Library/ErrorState.tsx: theme tokens instead of
// fixed Tailwind colours, and no retry button (the page is server-rendered).
interface ErrorStateProps {
  statusCode?: number;
  title?: string;
  message?: string;
}

export default function ErrorState({
  statusCode = 500,
  title,
  message,
}: ErrorStateProps) {
  const defaultTitle =
    statusCode === 404 ? "Page not found" : "Something went wrong";
  const defaultMessage =
    statusCode === 404
      ? "The requested resource could not be found."
      : "We could not load the requested information. Please try again.";

  return (
    <div
      role="alert"
      className="card-raised flex min-h-48 flex-col items-center justify-center rounded-xl border border-negative/40 bg-surface p-6 text-center"
    >
      <AlertCircle aria-hidden className="mb-3 size-10 text-negative" />
      <p className="text-sm font-bold text-negative">Error {statusCode}</p>
      <h3 className="mt-2 text-base font-semibold text-ink">
        {title ?? defaultTitle}
      </h3>
      <p className="mt-2 max-w-md text-sm text-muted">
        {message ?? defaultMessage}
      </p>
    </div>
  );
}
