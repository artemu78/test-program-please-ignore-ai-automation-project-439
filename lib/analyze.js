const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FILE_TYPES = {
  ".csv": "tabular",
  ".json": "tabular",
  ".txt": "text",
  ".md": "text",
  ".pdf": "unparsable",
  ".jpg": "unparsable",
  ".jpeg": "unparsable",
  ".xlsx": "unparsable",
};
const FILE_SIGNATURES = [
  { bytes: [0x25, 0x50, 0x44, 0x46], type: "unparsable" },
  { bytes: [0xff, 0xd8, 0xff], type: "unparsable" },
  { bytes: [0x50, 0x4b], type: "unparsable" },
];

function relativeName(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function collectFiles(directory, excludedDirectory) {
  const root = path.resolve(directory);
  const excluded = excludedDirectory && path.resolve(excludedDirectory);

  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Путь не является папкой: ${directory}`);
  }

  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);

    if (
      !entry.isFile() ||
      (excluded && (fullPath === excluded || excluded.startsWith(`${fullPath}${path.sep}`)))
    ) {
      continue;
    }

    const content = fs.readFileSync(fullPath);
    files.push({
      path: relativeName(root, fullPath),
      name: entry.name,
      fullPath,
      size: fs.statSync(fullPath).size,
      content,
      extension: path.extname(entry.name).toLowerCase(),
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path, "ru"));
}

function getFileSignature(content) {
  return FILE_SIGNATURES.find(({ bytes }) =>
    bytes.every((byte, index) => content[index] === byte),
  );
}

function classifyFile(file) {
  const signature = getFileSignature(file.content);
  const hasKnownExtension = Object.hasOwn(FILE_TYPES, file.extension);
  const type = signature?.type || FILE_TYPES[file.extension] || "unparsable";
  let status = "irrelevant";

  if (file.size > 0 && (signature || hasKnownExtension)) {
    status = type === "unparsable" ? "manualReview" : "document";
  }

  return { ...file, type, status };
}

function analyzeFiles(directory, excludedDirectory) {
  const files = collectFiles(directory, excludedDirectory).map(classifyFile);
  const duplicateMap = new Map();
  const manualReview = [];
  const irrelevant = [];
  let tabularFiles = 0;
  let textFiles = 0;
  let unparsableFiles = 0;
  let documents = 0;

  for (const file of files) {
    const digest = crypto.createHash("sha256").update(file.content).digest("hex");
    const matches = duplicateMap.get(digest) || [];
    matches.push(file);
    duplicateMap.set(digest, matches);

    if (file.type === "tabular") {
      tabularFiles += 1;
    } else if (file.type === "text") {
      textFiles += 1;
    } else {
      unparsableFiles += 1;
    }

    if (file.status === "document") {
      documents += 1;
    } else if (file.status === "manualReview") {
      manualReview.push(file.path);
    } else {
      irrelevant.push(file.path);
    }
  }

  const duplicateGroups = [...duplicateMap.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      files: group.map(({ path: filePath }) => filePath),
      extraBytes: group.slice(1).reduce((total, file) => total + file.size, 0),
    }));

  return {
    stats: {
      totalFiles: files.length,
      tabularFiles,
      textFiles,
      unparsableFiles,
      documents,
      manualReview: manualReview.length,
      irrelevant: irrelevant.length,
      duplicateFiles: duplicateGroups.reduce(
        (total, group) => total + group.files.length - 1,
        0,
      ),
      duplicateGroups: duplicateGroups.length,
      duplicateExtraBytes: duplicateGroups.reduce(
        (total, group) => total + group.extraBytes,
        0,
      ),
    },
    manualReview,
    irrelevant,
    duplicateGroups,
    files,
  };
}

function parseCsv(content) {
  const text = content.toString("utf8").replace(/^\uFEFF/, "");
  const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g) || []).length >
    (text.split(/\r?\n/, 1)[0].match(/,/g) || []).length
    ? ";"
    : ",";
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(header) {
  return header.toLocaleLowerCase("ru").replace(/[^a-zа-яё0-9]/giu, "");
}

function findHeaderIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(normalizeHeader(header)));
}

function normalizePhone(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) {
    return `7${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `7${digits}`;
  }
  return "";
}

function parseContact(record) {
  const name = String(record.name || "").replace(/\s+/g, " ").trim();
  const emailValue = String(record.email || "").trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(emailValue) ? emailValue : "";
  const phone = normalizePhone(String(record.phone || ""));

  if (!name || (!email && !phone)) {
    return null;
  }
  return { name, email, phone };
}

function csvContacts(file) {
  const rows = parseCsv(file.content);
  if (rows.length < 2) {
    return null;
  }

  const headers = rows[0];
  const nameIndex = findHeaderIndex(headers, /^(имя|фио|name|fullname)$/u);
  const phoneIndex = findHeaderIndex(headers, /(телефон|phone|mobile)/u);
  const emailIndex = findHeaderIndex(headers, /(почта|email|mail)/u);
  if (nameIndex < 0 || (phoneIndex < 0 && emailIndex < 0)) {
    return null;
  }

  return rows.slice(1).map((row) => ({
    name: row[nameIndex] || "",
    phone: phoneIndex < 0 ? "" : row[phoneIndex] || "",
    email: emailIndex < 0 ? "" : row[emailIndex] || "",
  }));
}

function jsonContacts(file) {
  if (file.type !== "tabular" || file.extension !== ".json") {
    return null;
  }
  const records = JSON.parse(file.content.toString("utf8"));
  if (!Array.isArray(records)) {
    return null;
  }
  return records.map((record) => ({
    name: record.name || record.fullName || record["ФИО"] || record["Имя"] || "",
    phone: record.phone || record.telephone || record["Телефон"] || "",
    email: record.email || record.mail || record["Почта"] || "",
  }));
}

function analyzeContacts(files) {
  const sources = [];
  const accepted = [];
  let rejectedRecords = 0;
  let recordsRead = 0;

  for (const file of files) {
    if (file.type !== "tabular") {
      continue;
    }
    let records = null;
    if (file.extension === ".csv") {
      records = csvContacts(file);
    } else if (file.extension === ".json") {
      records = jsonContacts(file);
    }
    if (records === null) {
      continue;
    }

    let sourceAccepted = 0;
    recordsRead += records.length;
    for (const record of records) {
      const contact = parseContact(record);
      if (!contact) {
        rejectedRecords += 1;
        continue;
      }
      sourceAccepted += 1;
      accepted.push({ ...contact, source: file.path });
    }
    sources.push({ file: file.path, records: sourceAccepted });
  }

  const contactsByIdentity = new Map();
  const uniqueContacts = [];
  for (const contact of accepted) {
    const previous =
      contactsByIdentity.get(contact.email) || contactsByIdentity.get(contact.phone);
    if (previous) {
      previous.sources.add(contact.source);
      previous.email ||= contact.email;
      previous.phone ||= contact.phone;
      if (contact.email) {
        contactsByIdentity.set(contact.email, previous);
      }
      if (contact.phone) {
        contactsByIdentity.set(contact.phone, previous);
      }
      continue;
    }

    const unique = { ...contact, sources: new Set([contact.source]) };
    if (contact.email) {
      contactsByIdentity.set(contact.email, unique);
    }
    if (contact.phone) {
      contactsByIdentity.set(contact.phone, unique);
    }
    uniqueContacts.push(unique);
  }

  return {
    stats: {
      sourceCount: sources.length,
      recordsRead,
      acceptedRecords: accepted.length,
      uniqueContacts: uniqueContacts.length,
      rejectedRecords,
    },
    sources,
    contacts: uniqueContacts.map(({ sources: contactSources, ...contact }) => ({
      ...contact,
      sources: [...contactSources].sort(),
    })),
  };
}

module.exports = { analyzeContacts, analyzeFiles, collectFiles };
