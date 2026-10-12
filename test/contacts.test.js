const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { analyzeFiles } = require("../lib/analyze");
const { readContactExports } = require("../lib/contacts");

const cliPath = path.resolve(__dirname, "../bin/file-automation.js");
let temporaryDirectory;

afterEach(() => {
  if (temporaryDirectory) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

test("contacts maps CSV and JSON columns and reports unrecognized columns", () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "file-automation-"));
  const inputDirectory = path.join(temporaryDirectory, "company");
  const outputDirectory = path.join(temporaryDirectory, "out");
  fs.mkdirSync(inputDirectory);
  fs.writeFileSync(
    path.join(inputDirectory, "unknown-name.csv"),
    "\uFEFFФИО ; Моб. телефон ; E-mail ; Должность\nАЛИСА НЕСТЕРОВА;8-921-555-14-95; USER001@EXAMPLE.COM ;Менеджер\nКороткий;123;no-at;Стажёр\nБез данных;-;NULL;Неизвестно\n",
  );
  fs.writeFileSync(
    path.join(inputDirectory, "another-unexpected-name.json"),
    '[{"name":"Борис","phone":"+74995554442","company":"ООО Гранит"}]',
  );
  fs.writeFileSync(
    path.join(inputDirectory, "invoice.csv"),
    "Дата,Сумма\n2025-01-01,1000\n",
  );

  const files = analyzeFiles(inputDirectory).files;
  const imports = readContactExports(files);

  assert.deepEqual(imports.sources, [
    { file: "another-unexpected-name.json", records: 1 },
    { file: "unknown-name.csv", records: 3 },
  ]);
  assert.deepEqual(imports.records, [
    {
      имя: "Борис",
      телефон: "74995554442",
      почта: "",
      источник: "another-unexpected-name.json",
    },
    {
      имя: "Алиса Нестерова",
      телефон: "79215551495",
      почта: "user001@example.com",
      источник: "unknown-name.csv",
    },
    {
      имя: "Короткий",
      телефон: "",
      почта: "",
      источник: "unknown-name.csv",
    },
    {
      имя: "Без Данных",
      телефон: "",
      почта: "",
      источник: "unknown-name.csv",
    },
  ]);
  assert.equal(imports.rejectedValues, 2);
  assert.equal(imports.recordsWithoutPhoneAndEmail, 2);
  assert.deepEqual(imports.unmappedColumns, [
    { column: "company", source: "another-unexpected-name.json" },
    { column: "Должность", source: "unknown-name.csv" },
  ]);

  const output = execFileSync(
    process.execPath,
    [cliPath, "contacts", inputDirectory, "--out", outputDirectory],
    { encoding: "utf8" },
  );
  const report = JSON.parse(
    fs.readFileSync(path.join(outputDirectory, "report.json"), "utf8"),
  );
  assert.deepEqual(report.contacts.records, imports.records);
  assert.match(output, /another-unexpected-name\.json: записей 1/u);
  assert.match(output, /unknown-name\.csv: записей 3/u);
  assert.match(output, /Выгрузок прочитано: 2, записей: 4/u);
  assert.match(
    output,
    /Отбраковано значений: 2, записей без телефона и почты: 2/u,
  );
  assert.match(
    output,
    /Колонки без соответствия: company \(another-unexpected-name\.json\), Должность \(unknown-name\.csv\)/u,
  );
});
