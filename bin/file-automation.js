#!/usr/bin/env node
const { Command } = require("commander");
const packageJson = require("../package.json");
const { createReports } = require("../lib/report");
const { analyzeFiles } = require("../lib/analyze");

const program = new Command();

program
  .name(packageJson.name)
  .description("Automate file processing")
  .version(packageJson.version);

for (const commandName of ["files", "contacts"]) {
  program
    .command(`${commandName} <directory>`)
    .description(
      commandName === "files"
        ? "Analyze company files and create reports"
        : "Analyze contacts and create reports",
    )
    .option("--out <directory>", "Directory for generated reports", "./out")
    .action((directory, options) => {
      try {
        if (commandName === "files") {
          const { stats } = analyzeFiles(directory);
          console.log(`Файлов найдено: ${stats.totalFiles}`);
          console.log(
            `Табличных документов: ${stats.tabularFiles}, текстовых: ${stats.textFiles}, непарсимых: ${stats.unparsableFiles}`,
          );
          console.log(
            `Документов: ${stats.documents}, требуют ручного разбора: ${stats.manualReview}, посторонних: ${stats.irrelevant}`,
          );
          console.log(
            `Копий найдено: ${stats.duplicateFiles} в ${stats.duplicateGroups} группах`,
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

program.on("command:*", ([command]) => {
  console.warn(`Warning: unknown command '${command}'.`);
  program.outputHelp();
  process.exitCode = 1;
});

program.parse(process.argv);
