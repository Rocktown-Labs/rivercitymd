export function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length === 0) return;
  const headers = Array.from(
    rows.reduce((keys, row) => {
      for (const key of Object.keys(row)) keys.add(key);
      return keys;
    }, new Set<string>()),
  );

  const escape = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
