export function readEmployeeCsv(csv: string) {
  const parse = (line: string) => {
    const values: string[] = [];
    const field = /("(?:[^"]|"")*"|[^",]*)(,|$)/gy;
    while (true) {
      const value = field.exec(line);
      if (!value) throw new Error("Check the quotes and commas in the CSV.");
      const text = value[1] ?? "";
      values.push((text.startsWith('"') ? text.slice(1, -1).replaceAll('""', '"') : text).trim());
      if (!value[2]) return values;
    }
  };
  const [header, ...rows] = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  const columns = parse(header ?? "").map(value => value.toLowerCase());
  const nameColumn = columns.indexOf("name"), emailColumn = columns.indexOf("email"), headlineColumn = columns.indexOf("headline");
  if (nameColumn < 0 || emailColumn < 0) throw new Error("CSV must include name and email headers. Headline is optional.");
  if (!rows.length || rows.length > 200) throw new Error("Include between 1 and 200 employees per import.");
  return rows.map(line => {
    const values = parse(line);
    if (values.length !== columns.length) throw new Error("Each CSV row must have the same columns as the header.");
    return { name: values[nameColumn], email: values[emailColumn], headline: values[headlineColumn] };
  });
}
