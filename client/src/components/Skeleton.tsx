interface Props { className?: string; }

export function Skeleton({ className = '' }: Props) {
  return <div className={`shimmer rounded ${className}`} />;
}

/**
 * Screen-reader announcement for a loading region.
 *
 * The shimmer bones themselves are decorative and marked aria-hidden, so without
 * this a non-sighted user gets silence while data loads.
 */
function LoadingAnnouncement({ label }: { label: string }) {
  // An empty label opts out — used when a page stacks several skeletons and only
  // one of them should speak, so the user hears "Loading…" once, not four times.
  if (!label) return null;
  return <span role="status" aria-live="polite" className="sr-only">{label}</span>;
}

/**
 * Placeholder rows for an admin list table.
 *
 * Renders <tr> elements ONLY — the caller keeps its own <table> and <thead>, so
 * real column headers and widths stay on screen while rows load. This is why it
 * takes a column count rather than rendering its own table.
 *
 * Rows are aria-hidden: they convey nothing, and a screen reader walking five
 * rows of empty cells is worse than silence. Callers that replace the whole
 * table should use TableSkeleton instead, which announces itself.
 */
export function TableRowsSkeleton({
  rows = 5,
  columns,
  cellClassName = 'px-4 py-3',
  columnClassNames,
}: {
  rows?: number;
  columns: number;
  cellClassName?: string;
  /**
   * Per-column extra classes, indexed by column. Needed when the real table
   * hides columns responsively (`hidden md:table-cell`) — without the same
   * classes the skeleton shows more columns than the loaded table on small
   * screens, and the layout jumps as soon as data arrives.
   */
  columnClassNames?: (string | undefined)[];
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b dark:border-gray-800" aria-hidden="true">
          {Array.from({ length: columns }).map((__, j) => (
            <td key={j} className={`${cellClassName} ${columnClassNames?.[j] ?? ''}`}>
              <Skeleton className="h-4" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A table column for TableSkeleton: a bare label, or a label plus shared cell classes. */
export type SkeletonColumn = string | { label: string; className?: string };

/**
 * A complete table placeholder, header included.
 *
 * For pages that render nothing but a spinner while loading — keeping the header
 * labels visible tells the user what is arriving, and reserving the row height
 * stops the page jumping when data lands.
 */
export function TableSkeleton({
  headers,
  rows = 5,
  label = 'Loading…',
  headerClassName = 'px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider',
  cellClassName = 'px-4 py-3',
  theadClassName = 'bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700',
}: {
  headers: SkeletonColumn[];
  rows?: number;
  label?: string;
  headerClassName?: string;
  cellClassName?: string;
  theadClassName?: string;
}) {
  const cols = headers.map(h => (typeof h === 'string' ? { label: h, className: undefined } : h));

  return (
    <div className="overflow-x-auto">
      <LoadingAnnouncement label={label} />
      <table className="w-full text-sm">
        <thead className={theadClassName}>
          <tr>
            {cols.map(c => (
              <th key={c.label} scope="col" className={`${headerClassName} ${c.className ?? ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <TableRowsSkeleton
            rows={rows}
            columns={cols.length}
            cellClassName={cellClassName}
            columnClassNames={cols.map(c => c.className)}
          />
        </tbody>
      </table>
    </div>
  );
}

/**
 * A single card placeholder: a title bone, an optional headline bone (a price or
 * metric), `lines` body bones, and an optional footer bone for a CTA button.
 */
export function CardSkeleton({
  lines = 3,
  className = '',
  padding = 'p-5',
  headline = false,
  footer = false,
}: {
  lines?: number;
  className?: string;
  padding?: string;
  headline?: boolean;
  footer?: boolean;
}) {
  return (
    <div className={`card ${padding} space-y-3 ${className}`} aria-hidden="true">
      <Skeleton className="h-5 w-1/2" />
      {headline && <Skeleton className="h-8 w-2/3" />}
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" />
      ))}
      {footer && <Skeleton className="h-10 rounded-xl" />}
    </div>
  );
}

/**
 * A grid of card placeholders.
 *
 * `className` carries the grid definition so each caller keeps the exact column
 * layout of the content being replaced — otherwise the skeleton reflows the page
 * the moment real data arrives, which is the problem skeletons exist to solve.
 */
export function CardGridSkeleton({
  count = 4,
  lines = 3,
  className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5',
  label = 'Loading…',
  padding,
  headline,
  footer,
}: {
  count?: number;
  lines?: number;
  className?: string;
  label?: string;
  padding?: string;
  headline?: boolean;
  footer?: boolean;
}) {
  return (
    <div className={className}>
      <LoadingAnnouncement label={label} />
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} lines={lines} padding={padding} headline={headline} footer={footer} />
      ))}
    </div>
  );
}

/** KPI/stat tiles: a big number bone over two short label bones. */
export function StatCardsSkeleton({
  count = 4,
  className = 'grid grid-cols-2 lg:grid-cols-4 gap-4',
  label = 'Loading…',
}: {
  count?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div className={className}>
      <LoadingAnnouncement label={label} />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5 space-y-2" aria-hidden="true">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <Skeleton className="aspect-square rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex justify-between items-center pt-1">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function ProductDetailSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-3">
          <Skeleton className="aspect-square rounded-xl" />
          <div className="flex gap-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="w-16 h-16 rounded-lg" />)}
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-10 w-1/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
