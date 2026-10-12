const fs = require("node:fs");
const path = require("node:path");
const asTable = require("as-table");
const { analyzeContacts, analyzeFiles } = require("./analyze");

function createSourceTable(contacts) {
  const sourceRows = contacts.sources.map(({ file, records }) => ({
    Источник: file,
    Записей: records,
  }));
  return sourceRows.length ? asTable(sourceRows) : "Источников контактов не найдено.";
}

function createTextReport(files, contacts) {
  const sections = [
    "ОТЧЁТ ПО ФАЙЛАМ КОМПАНИИ",
    "",
    "Файлы",
    `Файлов найдено: ${files.stats.totalFiles}`,
    `Табличных документов: ${files.stats.tabularFiles}, текстовых: ${files.stats.textFiles}, непарсимых: ${files.stats.unparsableFiles}`,
    `Документов: ${files.stats.documents}, требуют ручного разбора: ${files.stats.manualReview}, посторонних: ${files.stats.irrelevant}`,
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
    "",
    createSourceTable(contacts),
  ];
  return sections.join("\n");
}

function createReports(inputDirectory, outputDirectory) {
  const input = path.resolve(inputDirectory);
  const output = path.resolve(outputDirectory);
  const fileAnalysis = analyzeFiles(input, output);
  const contactAnalysis = analyzeContacts(fileAnalysis.files);
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
  const textReport = createTextReport(fileAnalysis, contactAnalysis);

  fs.mkdirSync(output, { recursive: true });
  const textPath = path.join(output, "report.txt");
  const jsonPath = path.join(output, "report.json");
  fs.writeFileSync(textPath, `${textReport}\n`, "utf8");
  fs.writeFileSync(jsonPath, `${JSON.stringify(reportData, null, 2)}\n`, "utf8");

  console.log(`Файлов найдено: ${fileAnalysis.stats.totalFiles}`);
  console.log(
    `Табличных документов: ${fileAnalysis.stats.tabularFiles}, текстовых: ${fileAnalysis.stats.textFiles}, непарсимых: ${fileAnalysis.stats.unparsableFiles}`,
  );
  console.log(
    `Документов: ${fileAnalysis.stats.documents}, требуют ручного разбора: ${fileAnalysis.stats.manualReview}, посторонних: ${fileAnalysis.stats.irrelevant}`,
  );
  console.log(
    `Копий найдено: ${fileAnalysis.stats.duplicateFiles} в ${fileAnalysis.stats.duplicateGroups} группах`,
  );
  console.log(
    `Место, занимаемое лишними копиями: ${fileAnalysis.stats.duplicateExtraBytes} байт`,
  );
  console.log(
    `Контакты: уникальных ${contactAnalysis.stats.uniqueContacts}, принято ${contactAnalysis.stats.acceptedRecords}, отбраковано ${contactAnalysis.stats.rejectedRecords} из ${contactAnalysis.stats.recordsRead}; источников: ${contactAnalysis.stats.sourceCount}`,
  );
  console.log(createSourceTable(contactAnalysis));
  console.log(`Отчёт: ${path.relative(process.cwd(), textPath) || textPath}`);
  console.log(`Отчёт для программ: ${path.relative(process.cwd(), jsonPath) || jsonPath}`);
}

module.exports = { createReports };
