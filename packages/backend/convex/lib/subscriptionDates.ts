export function computeNextDate(
  frequency: "biweekly" | "monthly",
  fromDate?: string,
  anchorDay?: number,
): string {
  const from = fromDate ? new Date(`${fromDate}T12:00:00Z`) : new Date();
  if (frequency === "monthly") {
    const currentDay = from.getUTCDate();
    const currentMonthEnd = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0),
    ).getUTCDate();
    // Restore a clipped month-end anchor, but retain an explicitly moved visit.
    const day =
      currentDay === currentMonthEnd
        ? Math.max(currentDay, anchorDay ?? currentDay)
        : currentDay;
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() + 1);
    const lastDay = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0),
    ).getUTCDate();
    from.setUTCDate(Math.min(day, lastDay));
  } else {
    from.setUTCDate(from.getUTCDate() + 14);
  }
  return from.toISOString().split("T")[0];
}
