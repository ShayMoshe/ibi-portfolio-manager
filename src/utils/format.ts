// Shared number/currency/percent formatting. Matches the formatNumber logic
// previously duplicated across components: whole numbers print without
// decimals, others with exactly two.
export const formatNumber = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === Math.floor(rounded)) {
    return rounded.toLocaleString("en-US");
  }
  return rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const formatUsd = (value: number): string => `$${formatNumber(value)}`;

export const formatSignedUsd = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${formatNumber(Math.abs(value))}`;

export const formatPercent = (value: number, signed = true): string =>
  `${signed && value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
