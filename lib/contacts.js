const { columnMap } = require("./contact-columns");
const { readTabularFile } = require("./tabular");

const emptyValues = ["-", "null", "нет данных"];

function normalizeColumnName(column) {
  return column.toLocaleLowerCase("ru").trim().replace(/\s+/gu, " ");
}

function normalizeEmptyValue(value) {
  const normalized = value == null ? "" : String(value).trim();
  return emptyValues.includes(normalized.toLocaleLowerCase("ru")) ? "" : normalized;
}

function normalizePhone(value) {
  const digits = [...value].filter((symbol) => "0123456789".includes(symbol)).join("");
  if (digits.length === 10) {
    return `7${digits}`;
  }
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
    return `7${digits.slice(1)}`;
  }
  return "";
}

function normalizeEmail(value) {
  const email = normalizeEmptyValue(value).toLowerCase();
  const parts = email.split("@");
  return parts.length === 2 && parts.every(Boolean) ? email : "";
}

function normalizeName(value) {
  return normalizeEmptyValue(value)
    .split(/\s+/u)
    .filter(Boolean)
    .map(
      (word) =>
        `${word[0].toLocaleUpperCase("ru")}${word.slice(1).toLocaleLowerCase("ru")}`,
    )
    .join(" ");
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
  let rejectedValues = 0;
  let recordsWithoutPhoneAndEmail = 0;

  for (const file of files) {
    if (file.type !== "tabular") {
      continue;
    }

    const table = readTabularFile(file);
    const mappedColumns = table.columns.map((column) => ({
      column,
      field: findSchemaField(column),
    }));
    if (
      !mappedColumns.some(
        ({ field }) => field === "телефон" || field === "почта",
      )
    ) {
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
          const value =
            record && typeof record === "object" && !Array.isArray(record)
              ? normalizeEmptyValue(record[column])
              : "";
          if (field === "имя") {
            contact[field] = normalizeName(value);
          } else if (field === "телефон") {
            contact[field] = normalizePhone(value);
            if (value && !contact[field]) {
              rejectedValues += 1;
            }
          } else {
            contact[field] = normalizeEmail(value);
            if (value && !contact[field]) {
              rejectedValues += 1;
            }
          }
        }
      }
      if (!contact.телефон && !contact.почта) {
        recordsWithoutPhoneAndEmail += 1;
      }
      records.push(contact);
    }
  }

  return {
    sources,
    records,
    unmappedColumns,
    rejectedValues,
    recordsWithoutPhoneAndEmail,
  };
}

module.exports = { readContactExports };
