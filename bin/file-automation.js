#!/usr/bin/env node
const { Command } = require("commander");
const path = require("node:path");
const packageJson = require("../package.json");
const { createReports } = require("../lib/report");
const { analyzeFiles } = require("../lib/analyze");
const { createRegistry } = require("../lib/registry");

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
          const input = path.resolve(directory);
          const output = path.resolve(options.out);
          if (output === input || output.startsWith(`${input}${path.sep}`)) {
            throw new Error("Папка результата должна находиться вне папки с файлами.");
          }
          const { stats, files } = analyzeFiles(input, output);
          const registryPath = createRegistry(files, output);
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

program.on("command:*", ([command]) => {
  console.warn(`Warning: unknown command '${command}'.`);
  program.outputHelp();
  process.exitCode = 1;
});

program.parse(process.argv);
