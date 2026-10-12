#!/usr/bin/env node
const { Command } = require("commander");
const packageJson = require("../package.json");
const { createReports } = require("../lib/report");
const { collectFiles } = require("../lib/analyze");

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
          console.log(`Файлов найдено: ${collectFiles(directory).length}`);
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
