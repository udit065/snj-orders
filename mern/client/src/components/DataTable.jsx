import { EmptyState, Skeleton } from "./ui.jsx";

// A table that becomes stacked cards on phones. Each column:
// { key, label, align: "right", render: (row) => node, className }
// With `mobileCard`, phones show each row as that card instead of a stacked table row.
export default function DataTable({ columns, rows, rowKey, onRowClick, loading = false, empty, skeletonRows = 8, mobileCard }) {
  const firstLoad = loading && !rows;
  if (!firstLoad && rows && !rows.length) return empty || <EmptyState title="Nothing to show" />;
  return (
    <div className={`table-wrap ${loading && rows ? "is-loading" : ""} ${mobileCard && rows ? "has-cards" : ""}`}>
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.align === "right" ? "num" : ""}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {firstLoad
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} className="skeleton-row">
                  {columns.map((c) => <td key={c.key}><Skeleton width={c.align === "right" ? "60%" : "80%"} /></td>)}
                </tr>
              ))
            : rows.map((row) => (
                <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "clickable" : ""}>
                  {columns.map((c) => (
                    <td key={c.key} data-label={c.label}
                        className={`${c.align === "right" ? "num" : ""} ${c.className ? c.className(row) : ""}`}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {mobileCard && rows && (
        <ul className="mobile-cards">
          {rows.map((row) => (
            <li key={rowKey(row)} className={`mobile-card ${onRowClick ? "clickable" : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}>{mobileCard(row)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
