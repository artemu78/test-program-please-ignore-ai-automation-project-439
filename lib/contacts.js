const { columnMap } = require("./contact-columns");
const { readTabularFile } = require("./tabular");

function normalizeColumnName(column) {
  return column.toLocaleLowerCase("ru").trim().replace(/\s+/gu, " ");
}

function findSchemaField(column) {
  const normalizedColumn = normalizeColumnName(column);
  return Object.keys(columnMap).find((field) =>
    columnMap[field].some((alias) => normalizeColumnName(alias) === normalizedColumn),
  );
}

function readContactExports(files) {
  const sources = [];
  const records = [];
  const unmappedColumns = [];

  for (const file of files) {
    if (file.type !== "tabular") {
      continue;
    }

    const table = readTabularFile(file);
    const mappedColumns = table.columns.map((column) => ({
      column,
      field: findSchemaField(column),
    }));
    if (!mappedColumns.some(({ field }) => field === "телефон" || field === "почта")) {
      continue;
    }

    sources.push({ file: file.path, records: table.records.length });
    for (const { column, field } of mappedColumns) {
      if (!field) {
        unmappedColumns.push({
          column: column.trim().replace(/\s+/gu, " "),
          source: file.path,
        });
      }
    }

    for (const record of table.records) {
      const contact = { имя: "", телефон: "", почта: "", источник: file.path };
      for (const { column, field } of mappedColumns) {
        if (field) {
          contact[field] =
            record && typeof record === "object" && !Array.isArray(record)
              ? (record[column] ?? "")
              : "";
        }
      }
      records.push(contact);
    }
  }

  return { sources, records, unmappedColumns };
}

module.exports = { readContactExports };
