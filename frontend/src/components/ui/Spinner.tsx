
export const Spinner = ({ className = '' }: { className?: string }) => (
  <div className={`h-6 w-6 animate-spin rounded-full border-2 border-green-500 border-t-transparent ${className}`} />
);
