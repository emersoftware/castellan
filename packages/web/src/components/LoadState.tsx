export function LoadState({ loading, error, empty, onRetry }: {
  loading?: boolean; error?: boolean; empty?: boolean; onRetry?: () => void;
}) {
  if (!loading && !error && !empty) return null;
  return <div className="load-state" role={error ? "alert" : "status"}>
    <p>{error ? "Couldn’t load this battle. Check your connection and try again." : loading ? "Loading battles…" : "No battles on the current engine yet."}</p>
    {error && onRetry && <button onClick={onRetry}>Try again</button>}
  </div>;
}
