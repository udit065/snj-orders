import { Button } from "./ui.jsx";

// "Showing 51–100 of 2,276" with previous / page numbers / next.
export default function Pagination({ page, pages, total, perPage, onPage, disabled }) {
  if (!total) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const items = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) items.push(<span key={`gap${n}`} className="page-gap">…</span>);
    items.push(
      <button key={n} className={`page-num ${n === page ? "on" : ""}`} disabled={disabled || n === page}
              onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}>{n}</button>,
    );
  });
  return (
    <nav className="pagination" aria-label="Pages">
      <span className="muted">Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</span>
      {pages > 1 && (
        <div className="page-buttons">
          <Button variant="secondary" size="sm" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</Button>
          <span className="page-nums">{items}</span>
          <Button variant="secondary" size="sm" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Next ›</Button>
        </div>
      )}
    </nav>
  );
}
