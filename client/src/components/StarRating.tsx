interface Props {
  rating: number;
  max?: number;
  size?: 'sm' | 'md';
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

export default function StarRating({ rating, max = 5, size = 'md', interactive = false, onChange }: Props) {
  const sz = size === 'sm' ? 'text-sm' : 'text-xl';
  return (
    <div className={`flex gap-0.5 ${sz}`}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < Math.round(rating);
        return (
          <span
            key={i}
            className={`${filled ? 'text-yellow-400' : 'text-gray-300'} ${interactive ? 'cursor-pointer hover:text-yellow-400' : ''}`}
            onClick={() => interactive && onChange?.(i + 1)}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}
