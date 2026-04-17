interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel: string;
}

export default function Pagination({ currentPage, totalItems, pageSize, onPageChange, itemLabel }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (totalItems <= pageSize) {
    return null;
  }

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);
  const pageWindow = 2;
  const startPage = Math.max(1, currentPage - pageWindow);
  const endPage = Math.min(totalPages, currentPage + pageWindow);

  const pages: number[] = [];
  for (let page = startPage; page <= endPage; page += 1) {
    pages.push(page);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="text-sm text-zinc-600">
        Showing <span className="font-bold text-zinc-900">{startItem}</span> to <span className="font-bold text-zinc-900">{endItem}</span> of <span className="font-bold text-zinc-900">{totalItems}</span> {itemLabel}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        {startPage > 1 ? (
          <>
            <button
              type="button"
              onClick={() => onPageChange(1)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              1
            </button>
            {startPage > 2 ? <span className="px-1 text-sm text-zinc-400">...</span> : null}
          </>
        ) : null}
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${page === currentPage ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
          >
            {page}
          </button>
        ))}
        {endPage < totalPages ? (
          <>
            {endPage < totalPages - 1 ? <span className="px-1 text-sm text-zinc-400">...</span> : null}
            <button
              type="button"
              onClick={() => onPageChange(totalPages)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              {totalPages}
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}