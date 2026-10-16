#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { runContacts, runFiles } from "../lib/report.js";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const program = new Command();

program
  .name("file-automation")
  .description("Automate file processing")
  .version(packageJson.version)
  .showHelpAfterError();

program
  .command("files <папка>")
  .description("Analyze company files and create reports")
  .option("--out <папка>", "Directory for generated reports", "./out")
  .action((directory, options) => {
    try {
      runFiles(directory, options.out);
    } catch (error) {
      console.error(`Не удалось выполнить команду: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("contacts <папка>")
  .description("Analyze contacts and create reports")
  .option("--out <папка>", "Directory for generated reports", "./out")
  .action((directory, options) => {
    try {
      runContacts(directory, options.out);
    } catch (error) {
      console.error(`Не удалось выполнить команду: ${error.message}`);
      process.exitCode = 1;
    }
  });

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
