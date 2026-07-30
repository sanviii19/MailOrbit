
interface BadgeProps {
  status: string;
  className?: string;
}

export const Badge = ({ status, className = '' }: BadgeProps) => {
  const getStyles = () => {
    switch (status) {
      case 'scheduled': return 'bg-blue-50 text-blue-600 border-blue-200';
      case 'rate_limited': return 'bg-yellow-50 text-yellow-600 border-yellow-200';
      case 'sent': return 'bg-green-50 text-green-600 border-green-200';
      case 'failed': return 'bg-red-50 text-red-600 border-red-200';
      default: return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border ${getStyles()} ${className}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
};
