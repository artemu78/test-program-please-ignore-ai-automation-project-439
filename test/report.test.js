const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = (function getRunner() {
  if (typeof globalThis.test === "function" && typeof globalThis.afterEach === "function") {
    return globalThis;
  }
  try {
    return require("vitest");
  } catch {
    return require("node:test");
  }
})();
const { analyzeFiles, collectFiles } = require("../lib/analyze");

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

function runCommand(
  command,
  inputDirectory,
  outputDirectory,
  workingDirectory = process.cwd(),
) {
  const args = [cliPath, command, inputDirectory];
  if (outputDirectory) {
    args.push("--out", outputDirectory);
  }
  return execFileSync(
    process.execPath,
    args,
    { cwd: workingDirectory, encoding: "utf8" },
  );
}

test("files prints file counts recursively including subdirectories", () => {
  const { inputDirectory, outputDirectory } = createInputFiles();

  const filesOutput = runCommand("files", inputDirectory, outputDirectory);
  assert.equal(
    filesOutput,
    "Файлов найдено: 8\n" +
      "Табличных документов: 3, текстовых: 2, непарсимых: 3\n" +
      "Документов: 4, требуют ручного разбора: 1, посторонних: 3\n" +
      "Копий найдено: 1 в 1 группах\n" +
      `Реестр: ${path.relative(process.cwd(), path.join(outputDirectory, "registry.csv"))}\n`,
  );
  const registry = fs.readFileSync(path.join(outputDirectory, "registry.csv"), "utf8");
  assert.match(registry, /^путь,имя,тип,размер,хеш,статус,основная копия,строк,колонки/u);
  assert.equal(registry.trim().split("\n").length, 9);
  assert.match(registry, /Архив\/contacts\.csv,contacts\.csv,табличный документ/u);
  assert.match(registry, /Архив\/dogovor\.txt,dogovor\.txt,текстовый документ/u);
});

test("files uses ./out by default", () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "file-automation-"));
  const inputDirectory = path.join(temporaryDirectory, "company");
  const outputDirectory = path.join(temporaryDirectory, "out");
  fs.mkdirSync(inputDirectory);
  fs.writeFileSync(path.join(inputDirectory, "notes.txt"), "текст");

  const output = runCommand("files", inputDirectory, undefined, temporaryDirectory);

  assert.match(output, /Реестр: out\/registry\.csv/u);
  assert.equal(fs.existsSync(path.join(outputDirectory, "registry.csv")), true);
});

test("files writes table details and escapes registry CSV fields", () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "file-automation-"));
  const inputDirectory = path.join(temporaryDirectory, "company");
  const outputDirectory = path.join(temporaryDirectory, "nested", "out");
  fs.mkdirSync(inputDirectory);
  fs.writeFileSync(
    path.join(inputDirectory, "a,b.csv"),
    "\uFEFFИмя;Комментарий\nАлиса;значение, с запятой\nБоб;обычное\n",
  );
  fs.writeFileSync(
    path.join(inputDirectory, "items.json"),
    '[{"id":1,"name":"Алиса"},{"id":2,"amount":3}]',
  );
  fs.writeFileSync(path.join(inputDirectory, "notes.txt"), "текст");
  fs.writeFileSync(path.join(inputDirectory, "scan.pdf"), "%PDF sample");
  fs.writeFileSync(path.join(inputDirectory, "stray.bin"), "data");

  const output = runCommand("files", inputDirectory, outputDirectory);
  const registryPath = path.join(outputDirectory, "registry.csv");
  const registry = fs.readFileSync(registryPath, "utf8");

  assert.match(output, /Реестр: .*registry\.csv/u);
  assert.match(registry, /"a,b\.csv","a,b\.csv",табличный документ/u);
  assert.match(registry, /,документ,,2,"Имя, Комментарий"/u);
  assert.match(registry, /items\.json,items\.json,табличный документ,[^,\n]+,[a-f0-9]{64},документ,,2,"id, name, amount"/u);
  assert.match(registry, /notes\.txt,notes\.txt,текстовый документ,[^,\n]+,[a-f0-9]{64},документ,,,/u);
  assert.match(registry, /scan\.pdf,scan\.pdf,непарсимый,[^,\n]+,[a-f0-9]{64},требует ручного разбора,,,/u);
  assert.match(registry, /stray\.bin,stray\.bin,непарсимый,[^,\n]+,[a-f0-9]{64},постороннее,,,/u);
  assert.equal(registry.trim().split("\n").length, 6);
  assert.deepEqual(fs.readdirSync(inputDirectory).sort(), [
    "a,b.csv",
    "items.json",
    "notes.txt",
    "scan.pdf",
    "stray.bin",
  ]);
});

test("file collection includes metadata and traverses directories recursively", () => {
  const { inputDirectory } = createInputFiles();

  const files = collectFiles(inputDirectory);
  assert.equal(files.length, 8);
  assert.deepEqual(
    files.find(({ path: filePath }) => filePath === "dogovor.txt"),
    {
      path: "dogovor.txt",
      name: "dogovor.txt",
      fullPath: path.join(inputDirectory, "dogovor.txt"),
      size: Buffer.byteLength("Договор"),
      content: Buffer.from("Договор"),
      extension: ".txt",
    },
  );
  assert.deepEqual(
    files.find(({ path: filePath }) => filePath === "Архив/dogovor.txt"),
    {
      path: "Архив/dogovor.txt",
      name: "dogovor.txt",
      fullPath: path.join(inputDirectory, "Архив", "dogovor.txt"),
      size: Buffer.byteLength("Договор"),
      content: Buffer.from("Договор"),
      extension: ".txt",
    },
  );
  assert.equal(files.find(({ name }) => name === ".DS_Store").extension, "");
  assert.equal(files.some(({ path: filePath }) => filePath.startsWith("Архив/")), true);
});

test("file types use signatures before extensions and every file has a status", () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "file-automation-"));
  const inputDirectory = path.join(temporaryDirectory, "company");
  fs.mkdirSync(inputDirectory);
  const write = (name, content) =>
    fs.writeFileSync(path.join(inputDirectory, name), content);

  write("renamed.txt", Buffer.from("%PDF content"));
  write("scan", Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  write("workbook.csv", Buffer.from("PK\x03\x04"));
  write("table.json", '[{"name":"Alice"}]');
  write("notes.md", "Notes");
  write("unknown.bin", "data");
  write(".DS_Store", "metadata");
  write("empty.csv", "");

  const analysis = analyzeFiles(inputDirectory);
  const files = Object.fromEntries(analysis.files.map((file) => [file.name, file]));

  assert.equal(files["renamed.txt"].type, "unparsable");
  assert.equal(files["renamed.txt"].status, "manualReview");
  assert.equal(files.scan.type, "unparsable");
  assert.equal(files.scan.status, "manualReview");
  assert.equal(files["workbook.csv"].type, "unparsable");
  assert.equal(files["workbook.csv"].status, "manualReview");
  assert.equal(files["table.json"].type, "tabular");
  assert.equal(files["table.json"].status, "document");
  assert.equal(files["notes.md"].type, "text");
  assert.equal(files["notes.md"].status, "document");
  assert.equal(files["unknown.bin"].type, "unparsable");
  assert.equal(files["unknown.bin"].status, "irrelevant");
  assert.equal(files[".DS_Store"].status, "irrelevant");
  assert.equal(files["empty.csv"].type, "tabular");
  assert.equal(files["empty.csv"].status, "irrelevant");
  assert.equal(analysis.stats.totalFiles, 8);
  assert.equal(
    analysis.stats.tabularFiles +
      analysis.stats.textFiles +
      analysis.stats.unparsableFiles,
    analysis.stats.totalFiles,
  );
  assert.equal(
    analysis.stats.documents +
      analysis.stats.manualReview +
      analysis.stats.irrelevant,
    analysis.stats.totalFiles,
  );
});

test("files groups byte-identical and normalized-name copies deterministically", () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "file-automation-"));
  const inputDirectory = path.join(temporaryDirectory, "company");
  fs.mkdirSync(inputDirectory);
  const write = (name, content) =>
    fs.writeFileSync(path.join(inputDirectory, name), content);

  write("same-content.txt", "identical bytes");
  write("unrelated-name.bin", "identical bytes");
  write("СЧЁТ.csv", "first version");
  write("Счёт (1).csv", "second version");
  write("Копия счёт.csv", "third version");
  write("счёт.txt", "different extension");

  const analysis = analyzeFiles(inputDirectory);
  const registry = Object.fromEntries(
    analysis.files.map(({ path: filePath, duplicateOf }) => [filePath, duplicateOf]),
  );

  assert.equal(analysis.stats.duplicateFiles, 3);
  assert.equal(analysis.stats.duplicateGroups, 2);
  assert.deepEqual(
    analysis.duplicateGroups.map(({ primary, files }) => ({ primary, files })),
    [
      {
        primary: "same-content.txt",
        files: ["same-content.txt", "unrelated-name.bin"],
      },
      {
        primary: "Копия счёт.csv",
        files: ["Копия счёт.csv", "СЧЁТ.csv", "Счёт (1).csv"],
      },
    ],
  );
  assert.equal(registry["same-content.txt"], null);
  assert.equal(registry["unrelated-name.bin"], "same-content.txt");
  assert.equal(registry["Копия счёт.csv"], null);
  assert.equal(registry["СЧЁТ.csv"], "Копия счёт.csv");
  assert.equal(registry["Счёт (1).csv"], "Копия счёт.csv");
  assert.equal(registry["счёт.txt"], null);
  assert.match(
    runCommand("files", inputDirectory, path.join(temporaryDirectory, "out")),
    /Копий найдено: 3 в 2 группах/u,
  );
});

test("contacts command creates reports including nested files", () => {
  const { inputDirectory, outputDirectory } = createInputFiles();

  const contactsOutput = runCommand("contacts", inputDirectory, outputDirectory);
  const textPath = path.join(outputDirectory, "report.txt");
  const jsonPath = path.join(outputDirectory, "report.json");
  const textReport = fs.readFileSync(textPath, "utf8");
  const jsonText = fs.readFileSync(jsonPath, "utf8");
  const report = JSON.parse(jsonText);

  assert.equal(report.files.stats.totalFiles, 8);
  assert.deepEqual(report.files.manualReview, ["scan.pdf"]);
  assert.deepEqual(report.files.irrelevant, [".DS_Store", "empty.csv", "logo.png"]);
  assert.equal(report.files.stats.duplicateFiles, 1);
  assert.equal(report.files.stats.duplicateGroups, 1);
  assert.deepEqual(report.files.registry[0], {
    path: ".DS_Store",
    duplicateOf: null,
  });
  assert.equal(report.contacts.stats.sourceCount, 2);
  assert.equal(report.contacts.stats.acceptedRecords, 3);
  assert.equal(report.contacts.stats.uniqueContacts, 2);
  assert.equal(report.contacts.stats.rejectedRecords, 1);
  assert.match(textReport, /Архив\/contacts\.csv/u);
  assert.match(textReport, /Копии: 1 в 1 группах/u);
  assert.match(textReport, /kontakty\.csv/u);
  assert.match(contactsOutput, /Отчёт для программ:/u);
  assert.equal(fs.readFileSync(jsonPath, "utf8"), jsonText);
});

test("file collection traverses arbitrary nesting depths", () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "file-automation-"));
  const inputDirectory = path.join(temporaryDirectory, "company");
  const deepDirectory = path.join(inputDirectory, "a", "b", "c", "d");
  fs.mkdirSync(deepDirectory, { recursive: true });
  fs.writeFileSync(path.join(deepDirectory, "deep.txt"), "глубокий файл");

  const files = collectFiles(inputDirectory);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "a/b/c/d/deep.txt");
  assert.equal(files[0].name, "deep.txt");
});
