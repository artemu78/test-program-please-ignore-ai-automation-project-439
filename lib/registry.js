const fs = require("node:fs");
const path = require("node:path");
const { parseCsv } = require("./analyze");

const HEADERS = [
  "путь",
  "имя",
  "тип",
  "размер",
  "хеш",
  "статус",
  "основная копия",
  "строк",
  "колонки",
];

const FILE_TYPES = {
  tabular: "табличный документ",
  text: "текстовый документ",
  unparsable: "непарсимый",
};

const FILE_STATUSES = {
  document: "документ",
  manualReview: "требует ручного разбора",
  irrelevant: "постороннее",
};

function getTableDetails(file) {
  if (file.type !== "tabular" || file.status !== "document") {
    return { rows: "", columns: "" };
  }

  if (file.extension === ".csv") {
    const rows = parseCsv(file.content);
    return {
      rows: Math.max(0, rows.length - 1),
      columns: rows[0]?.join(", ") || "",
    };
  }

  const records = JSON.parse(file.content.toString("utf8").replace(/^\uFEFF/u, ""));
  if (!Array.isArray(records)) {
    return { rows: 0, columns: "" };
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

  return { rows: records.length, columns: columns.join(", ") };
}

function escapeCsvValue(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function createRegistry(files, outputDirectory) {
  const rows = files.map((file) => {
    const tableDetails = getTableDetails(file);
    return [
      file.path,
      file.name,
      FILE_TYPES[file.type],
      file.size,
      file.hash,
      FILE_STATUSES[file.status],
      file.duplicateOf || "",
      tableDetails.rows,
      tableDetails.columns,
    ];
  });
  const content = [HEADERS, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
  const registryPath = path.join(outputDirectory, "registry.csv");

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(registryPath, `${content}\n`, "utf8");

  return registryPath;
}

module.exports = { createRegistry };
