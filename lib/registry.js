const fs = require("node:fs");
const path = require("node:path");
const { escapeCsvValue, readTabularFile } = require("./tabular");

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
    const { columns, records } = readTabularFile(file);
    return {
      rows: records.length,
      columns: columns.join(", "),
    };
  }

  const { columns, records } = readTabularFile(file);
  return { rows: records.length, columns: columns.join(", ") };
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
