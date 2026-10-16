import fs from "node:fs";
import path from "node:path";
import asTable from "as-table";
import { analyzeContacts, analyzeFiles } from "./analyze.js";
import { createContactsCsv } from "./contacts.js";
import { createRegistry } from "./registry.js";

function formatFileSummary(stats) {
  return [
    `Файлов найдено: ${stats.totalFiles}`,
    `Табличных документов: ${stats.tabularFiles}, текстовых: ${stats.textFiles}, непарсимых: ${stats.unparsableFiles}`,
    `Документов: ${stats.documents}, требуют ручного разбора: ${stats.manualReview}, посторонних: ${stats.irrelevant}`,
    `Копий найдено: ${stats.duplicateFiles} в ${stats.duplicateGroups} группах`,
  ];
}

function createSourceTable(contacts) {
  const sourceRows = contacts.sources.map(({ file, records }) => ({
    Источник: file,
    Записей: records,
  }));
  return sourceRows.length ? asTable(sourceRows) : "Источников контактов не найдено.";
}

function createTextReport(files, contacts, contactsPath) {
  const summaryLines = formatFileSummary(files.stats);
  const sections = [
    "ОТЧЁТ ПО ФАЙЛАМ КОМПАНИИ",
    "",
    "Файлы",
    summaryLines[0],
    summaryLines[1],
    summaryLines[2],
    "",
    `Требуют ручного разбора (${files.stats.manualReview})`,
    "",
    "Программа эти файлы не прочитала, содержимое придётся посмотреть человеку.",
    ...(files.manualReview.length
      ? files.manualReview.map((file) => `  ${file}`)
      : ["  Нет файлов."]),
    "",
    `Посторонние файлы — можно удалить (${files.stats.irrelevant})`,
    ...(files.irrelevant.length
      ? files.irrelevant.map((file) => `  ${file}`)
      : ["  Нет файлов."]),
    "",
    `Копии: ${files.stats.duplicateFiles} в ${files.stats.duplicateGroups} группах`,
    `Место, занимаемое лишними копиями: ${files.stats.duplicateExtraBytes} байт`,
    ...(files.duplicateGroups.length
      ? files.duplicateGroups.flatMap((group, index) => [
          `  Группа ${index + 1} (лишнее место: ${group.extraBytes} байт)`,
          ...group.files.map((file) => `    ${file}`),
        ])
      : ["  Копий не найдено."]),
    "",
    "Контакты",
    `Источников: ${contacts.stats.sourceCount}`,
    `Прочитано записей: ${contacts.stats.recordsRead}`,
    `Принято записей: ${contacts.stats.acceptedRecords}`,
    `Уникальных контактов: ${contacts.stats.uniqueContacts}`,
    `Отбраковано записей: ${contacts.stats.rejectedRecords}`,
    `Отбраковано значений: ${contacts.stats.rejectedValues}, записей без телефона и почты: ${contacts.stats.recordsWithoutPhoneAndEmail}`,
    "",
    createSourceTable(contacts),
    "",
    "Выгрузки контактов",
    ...contacts.imports.map(
      ({ file, records }) => `${file}: записей ${records}`,
    ),
    `Выгрузок прочитано: ${contacts.imports.length}, записей: ${contacts.stats.recordsRead}`,
    `Уникальных контактов: ${contacts.stats.uniqueContacts}`,
    `Отбраковано значений: ${contacts.stats.rejectedValues}, записей без телефона и почты: ${contacts.stats.recordsWithoutPhoneAndEmail}`,
    ...(contactsPath
      ? [`Таблица: ${path.relative(process.cwd(), contactsPath) || contactsPath}`]
      : []),
    contacts.unmappedColumns.length
      ? `Колонки без соответствия: ${contacts.unmappedColumns
          .map(({ column, source }) => `${column} (${source})`)
          .join(", ")}`
      : "Колонки без соответствия: нет",
  ];
  return sections.join("\n");
}

function writeReportFiles(fileAnalysis, contactAnalysis, outputDirectory, contactsPath) {
  const output = path.resolve(outputDirectory);
  const reportData = {
    files: {
      stats: fileAnalysis.stats,
      manualReview: fileAnalysis.manualReview,
      irrelevant: fileAnalysis.irrelevant,
      duplicateGroups: fileAnalysis.duplicateGroups,
      registry: fileAnalysis.files.map(({ path: filePath, duplicateOf }) => ({
        path: filePath,
        duplicateOf,
      })),
    },
    contacts: contactAnalysis,
  };
  const textReport = createTextReport(fileAnalysis, contactAnalysis, contactsPath);

  fs.mkdirSync(output, { recursive: true });
  const textPath = path.join(output, "report.txt");
  const jsonPath = path.join(output, "report.json");
  fs.writeFileSync(textPath, `${textReport}\n`, "utf8");
  fs.writeFileSync(jsonPath, `${JSON.stringify(reportData, null, 2)}\n`, "utf8");

  return { textPath, jsonPath };
}

function validateDirectories(inputDirectory, outputDirectory) {
  const input = path.resolve(inputDirectory);
  const output = path.resolve(outputDirectory);
  if (output === input || output.startsWith(`${input}${path.sep}`)) {
    throw new Error("Папка результата должна находиться вне папки с файлами.");
  }
  return { input, output };
}

function runFiles(inputDirectory, outputDirectory = "./out") {
  const { input, output } = validateDirectories(inputDirectory, outputDirectory);
  const fileAnalysis = analyzeFiles(input, output);
  const registryPath = createRegistry(fileAnalysis.files, output);
  const contactAnalysis = analyzeContacts(fileAnalysis.files);
  const contactsPath = path.join(output, "contacts.csv");
  const { textPath, jsonPath } = writeReportFiles(
    fileAnalysis,
    contactAnalysis,
    output,
    contactsPath,
  );

  for (const line of formatFileSummary(fileAnalysis.stats)) {
    console.log(line);
  }
  console.log(
    `Реестр: ${path.relative(process.cwd(), registryPath) || registryPath}`,
  );
  console.log(`Отчёт: ${path.relative(process.cwd(), textPath) || textPath}`);
  console.log(`Отчёт для программ: ${path.relative(process.cwd(), jsonPath) || jsonPath}`);
}

function runContacts(inputDirectory, outputDirectory = "./out") {
  const { input, output } = validateDirectories(inputDirectory, outputDirectory);
  const fileAnalysis = analyzeFiles(input, output);
  const contactAnalysis = analyzeContacts(fileAnalysis.files);
  const contactsPath = createContactsCsv(contactAnalysis.mergedContacts, output);
  const { textPath, jsonPath } = writeReportFiles(
    fileAnalysis,
    contactAnalysis,
    output,
    contactsPath,
  );

  for (const { file, records } of contactAnalysis.imports) {
    console.log(`${file}: записей ${records}`);
  }
  console.log(
    `Выгрузок прочитано: ${contactAnalysis.imports.length}, записей: ${contactAnalysis.stats.recordsRead}`,
  );
  console.log(
    `Уникальных контактов: ${contactAnalysis.stats.uniqueContacts}`,
  );
  console.log(
    `Отбраковано значений: ${contactAnalysis.stats.rejectedValues}, записей без телефона и почты: ${contactAnalysis.stats.recordsWithoutPhoneAndEmail}`,
  );
  console.log(
    `Таблица: ${path.relative(process.cwd(), contactsPath) || contactsPath}`,
  );
  if (contactAnalysis.unmappedColumns.length) {
    console.log(
      `Колонки без соответствия: ${contactAnalysis.unmappedColumns
        .map(({ column, source }) => `${column} (${source})`)
        .join(", ")}`,
    );
  }
  console.log(`Отчёт: ${path.relative(process.cwd(), textPath) || textPath}`);
  console.log(`Отчёт для программ: ${path.relative(process.cwd(), jsonPath) || jsonPath}`);
}

const createReports = runContacts;

export {
  createReports,
  createSourceTable,
  createTextReport,
  formatFileSummary,
  runContacts,
  runFiles,
  validateDirectories,
  writeReportFiles,
};
