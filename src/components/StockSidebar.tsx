export interface SidebarItem {
  ticker: string;
  sub?: string;
  subKind?: "positive" | "negative" | "neutral";
}

interface StockSidebarProps {
  title: string;
  items: SidebarItem[];
  selected: string;
  onSelect: (ticker: string) => void;
}

const StockSidebar = ({ title, items, selected, onSelect }: StockSidebarProps) => {
  if (items.length === 0) return null;

  return (
    <aside className="stock-sidebar">
      <div className="stock-sidebar-title">
        {title} ({items.length})
      </div>
      <div className="stock-sidebar-list">
        {items.map((item) => (
          <button
            key={item.ticker}
            type="button"
            className={`stock-sidebar-item ${item.ticker === selected ? "active" : ""}`}
            onClick={() => onSelect(item.ticker)}
          >
            <span className="stock-sidebar-ticker">{item.ticker}</span>
            {item.sub ? (
              <span
                className={`stock-sidebar-sub mono ${
                  item.subKind === "positive"
                    ? "val-positive"
                    : item.subKind === "negative"
                    ? "val-negative"
                    : "val-muted"
                }`}
              >
                {item.sub}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </aside>
  );
};

export default StockSidebar;
