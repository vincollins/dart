// Adapted from DART Component Library/Loading.tsx: theme tokens instead of
// fixed slate/pink colours. Available for per-panel fallbacks.
interface LoadingProps {
  message?: string;
}

export default function Loading({ message = "Loading data..." }: LoadingProps) {
  return (
    <div
      className="flex min-h-48 flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <div
        aria-hidden
        className="size-10 animate-spin rounded-full border-4 border-line border-t-primary"
      />
      <p className="text-sm font-medium text-muted">{message}</p>
    </div>
  );
}
