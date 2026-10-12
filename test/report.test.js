const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { collectFiles } = require("../lib/analyze");

const cliPath = path.resolve(__dirname, "../bin/file-automation.js");
let temporaryDirectory;

afterEach(() => {
  if (temporaryDirectory) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

function createInputFiles() {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "file-automation-"));
  const inputDirectory = path.join(temporaryDirectory, "company");
  const outputDirectory = path.join(temporaryDirectory, "out");
  fs.mkdirSync(path.join(inputDirectory, "Архив"), { recursive: true });

  const write = (relativePath, content) => {
    const filePath = path.join(inputDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  write(
    "kontakty.csv",
    "Имя,Телефон,Почта\nАлиса,+7 (999) 123-45-67,alice@example.com\nОшибка,нет данных,-\n",
  );
  write(
    "Архив/contacts.csv",
    "Name,Phone,Email\nAlice,89991234567,alice@example.com\nBob,+79998887766,bob@example.com\n",
  );
  write("dogovor.txt", "Договор");
  write("Архив/dogovor.txt", "Договор");
  write("scan.pdf", "%PDF sample");
  write("logo.png", "image bytes");
  write("empty.csv", "");
  write(".DS_Store", "metadata");
  return { inputDirectory, outputDirectory };
}

function runCommand(command, inputDirectory, outputDirectory) {
  return execFileSync(
    process.execPath,
    [cliPath, command, inputDirectory, "--out", outputDirectory],
    { encoding: "utf8" },
  );
}

test("files prints a count of top-level files only", () => {
  const { inputDirectory, outputDirectory } = createInputFiles();

  const filesOutput = runCommand("files", inputDirectory, outputDirectory);
  assert.equal(filesOutput, "Файлов найдено: 6\n");
  assert.equal(fs.existsSync(outputDirectory), false);
});

test("file collection includes metadata and skips directories", () => {
  const { inputDirectory } = createInputFiles();

  const files = collectFiles(inputDirectory);
  assert.equal(files.length, 6);
  assert.deepEqual(
    files.find(({ name }) => name === "dogovor.txt"),
    {
      path: "dogovor.txt",
      name: "dogovor.txt",
      fullPath: path.join(inputDirectory, "dogovor.txt"),
      size: Buffer.byteLength("Договор"),
      content: Buffer.from("Договор"),
      extension: ".txt",
    },
  );
  assert.equal(files.find(({ name }) => name === ".DS_Store").extension, "");
  assert.equal(files.some(({ path: filePath }) => filePath.startsWith("Архив/")), false);
});

test("contacts command creates reports from top-level files", () => {
  const { inputDirectory, outputDirectory } = createInputFiles();

  const contactsOutput = runCommand("contacts", inputDirectory, outputDirectory);
  const textPath = path.join(outputDirectory, "report.txt");
  const jsonPath = path.join(outputDirectory, "report.json");
  const textReport = fs.readFileSync(textPath, "utf8");
  const jsonText = fs.readFileSync(jsonPath, "utf8");
  const report = JSON.parse(jsonText);

  assert.equal(report.files.stats.totalFiles, 6);
  assert.deepEqual(report.files.manualReview, ["scan.pdf"]);
  assert.deepEqual(report.files.irrelevant, [".DS_Store", "empty.csv", "logo.png"]);
  assert.equal(report.files.stats.duplicateFiles, 0);
  assert.equal(report.files.stats.duplicateGroups, 0);
  assert.equal(report.contacts.stats.sourceCount, 1);
  assert.equal(report.contacts.stats.acceptedRecords, 1);
  assert.equal(report.contacts.stats.uniqueContacts, 1);
  assert.equal(report.contacts.stats.rejectedRecords, 1);
  assert.doesNotMatch(textReport, /Архив\//u);
  assert.match(textReport, /Копии: 0 в 0 группах/u);
  assert.match(textReport, /kontakty\.csv/u);
  assert.match(contactsOutput, /Отчёт для программ:/u);
  assert.equal(fs.readFileSync(jsonPath, "utf8"), jsonText);
});
