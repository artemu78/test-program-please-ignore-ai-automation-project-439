const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readContactExports } = require("./contacts");
const { parseCsv } = require("./tabular");

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

  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
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

function normalizeFileName(name) {
  const extension = path.extname(name).toLocaleLowerCase("ru");
  const basename = path
    .basename(name, path.extname(name))
    .toLocaleLowerCase("ru")
    .replace(/\s*\(1\)\s*$/u, "")
    .replace(/(?<![\p{L}\p{N}_])копия(?![\p{L}\p{N}_])/giu, "")
    .replace(/^[\s._-]+|[\s._-]+$/gu, "")
    .replace(/\s+/gu, " ");

  return `${basename}${extension}`;
}

function analyzeFiles(directory, excludedDirectory) {
  const files = collectFiles(directory, excludedDirectory).map(classifyFile);
  const parents = files.map((_, index) => index);
  const seenHashes = new Map();
  const seenNames = new Map();
  const manualReview = [];
  const irrelevant = [];
  let tabularFiles = 0;
  let textFiles = 0;
  let unparsableFiles = 0;
  let documents = 0;

  function find(index) {
    if (parents[index] !== index) {
      parents[index] = find(parents[index]);
    }
    return parents[index];
  }

  function connect(first, second) {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) {
      parents[secondRoot] = firstRoot;
    }
  }

  for (const [index, file] of files.entries()) {
    const digest = crypto.createHash("sha256").update(file.content).digest("hex");
    file.hash = digest;
    const previousHash = seenHashes.get(digest);
    if (previousHash !== undefined) {
      connect(previousHash, index);
    } else {
      seenHashes.set(digest, index);
    }

    const normalizedName = normalizeFileName(file.name);
    const previousName = seenNames.get(normalizedName);
    if (previousName !== undefined) {
      connect(previousName, index);
    } else {
      seenNames.set(normalizedName, index);
    }

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

  const groupedFiles = new Map();
  for (const [index, file] of files.entries()) {
    const root = find(index);
    const group = groupedFiles.get(root) || [];
    group.push(file);
    groupedFiles.set(root, group);
  }

  const duplicateGroups = [...groupedFiles.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const primary = group[0];
      for (const file of group) {
        file.duplicateOf = file === primary ? null : primary.path;
      }
      return {
        primary: primary.path,
        files: group.map(({ path: filePath }) => filePath),
        extraBytes: group.slice(1).reduce((total, file) => total + file.size, 0),
      };
    });

  for (const file of files) {
    file.duplicateOf ??= null;
  }

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
  const emailParts = emailValue.split("@");
  const email =
    emailParts.length === 2 && emailParts.every(Boolean) ? emailValue : "";
  const phone = normalizePhone(String(record.phone || ""));

  if (!name || (!email && !phone)) {
    return null;
  }
  return { name, email, phone };
}

function analyzeContacts(files) {
  const contactExports = readContactExports(files);
  const acceptedBySource = new Map(
    contactExports.sources.map(({ file }) => [file, 0]),
  );
  const accepted = [];
  let rejectedRecords = 0;

  for (const record of contactExports.records) {
    const contact = parseContact({
      name: record.имя,
      phone: record.телефон,
      email: record.почта,
    });
    if (!contact) {
      rejectedRecords += 1;
      continue;
    }
    acceptedBySource.set(
      record.источник,
      acceptedBySource.get(record.источник) + 1,
    );
    accepted.push({ ...contact, source: record.источник });
  }

  const sources = contactExports.sources.map(({ file }) => ({
    file,
    records: acceptedBySource.get(file),
  }));
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
      recordsRead: contactExports.records.length,
      acceptedRecords: accepted.length,
      uniqueContacts: uniqueContacts.length,
      rejectedRecords,
      rejectedValues: contactExports.rejectedValues,
      recordsWithoutPhoneAndEmail: contactExports.recordsWithoutPhoneAndEmail,
    },
    sources,
    imports: contactExports.sources,
    records: contactExports.records,
    unmappedColumns: contactExports.unmappedColumns,
    contacts: uniqueContacts.map(({ sources: contactSources, ...contact }) => ({
      ...contact,
      sources: [...contactSources].sort(),
    })),
  };
}

module.exports = { analyzeContacts, analyzeFiles, collectFiles, parseCsv };
