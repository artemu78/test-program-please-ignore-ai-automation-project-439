#!/usr/bin/env node
const { Command } = require("commander");
const path = require("node:path");
const packageJson = require("../package.json");
const { createReports, writeReportFiles } = require("../lib/report");
const { analyzeContacts, analyzeFiles } = require("../lib/analyze");
const { createRegistry } = require("../lib/registry");

const program = new Command();

program
  .name("file-automation")
  .description("Automate file processing")
  .version(packageJson.version)
  .showHelpAfterError();

for (const commandName of ["files", "contacts"]) {
  program
    .command(`${commandName} <папка>`)
    .description(
      commandName === "files"
        ? "Analyze company files and create reports"
        : "Analyze contacts and create reports",
    )
    .option("--out <папка>", "Directory for generated reports", "./out")
    .action((directory, options) => {
      try {
        if (commandName === "files") {
          const input = path.resolve(directory);
          const output = path.resolve(options.out);
          if (output === input || output.startsWith(`${input}${path.sep}`)) {
            throw new Error("Папка результата должна находиться вне папки с файлами.");
          }
          const fileAnalysis = analyzeFiles(input, output);
          const registryPath = createRegistry(fileAnalysis.files, output);
          const contactAnalysis = analyzeContacts(fileAnalysis.files);
          writeReportFiles(fileAnalysis, contactAnalysis, output);
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
            `Реестр: ${path.relative(process.cwd(), registryPath) || registryPath}`,
          );
          return;
        }
        createReports(directory, options.out);
      } catch (error) {
        console.error(`Не удалось выполнить команду: ${error.message}`);
        process.exitCode = 1;
      }
    });
}

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
