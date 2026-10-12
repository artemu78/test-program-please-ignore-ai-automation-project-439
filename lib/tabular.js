function parseCsv(content) {
  const text = content.toString("utf8").replace(/^\uFEFF/u, "");
  const firstLine = text.split(/\r?\n/u, 1)[0];
  const delimiter =
    (firstLine.match(/;/gu) || []).length > (firstLine.match(/,/gu) || []).length
      ? ";"
      : ",";
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }
  return rows;
}

function readTabularFile(file) {
  if (file.extension === ".csv") {
    const rows = parseCsv(file.content);
    const columns = rows[0] || [];
    const records = rows.slice(1).map((values) =>
      Object.fromEntries(columns.map((column, index) => [column, values[index] || ""])),
    );
    return { columns, records };
  }

  if (file.extension === ".json") {
    const records = JSON.parse(file.content.toString("utf8").replace(/^\uFEFF/u, ""));
    if (!Array.isArray(records)) {
      return { columns: [], records: [] };
    }

    const columns = [];
    for (const record of records) {
      if (record && typeof record === "object" && !Array.isArray(record)) {
        for (const column of Object.keys(record)) {
          if (!columns.includes(column)) {
            columns.push(column);
          }
        }
      }
    }
    return { columns, records };
  }

  return { columns: [], records: [] };
}

function escapeCsvValue(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

module.exports = { escapeCsvValue, parseCsv, readTabularFile };
