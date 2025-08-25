const fs = require('fs');
const path = require('path');

let cachedSchema = null;

/**
 * Load and parse str.csv into an in-memory schema description.
 * Returns an object keyed by table name → { columns: string[], primaryKeys: string[] }
 */
function loadSchema() {
  if (cachedSchema) return cachedSchema;

  // Try multiple possible paths for str.csv
  const possiblePaths = [
    path.resolve(__dirname, '..', '..', '..', 'str.csv'), // From utils directory
    path.resolve(__dirname, '..', '..', 'str.csv'), // From src directory
    path.resolve(process.cwd(), 'str.csv'), // From project root
    path.resolve(process.cwd(), 'nazdeeki', 'str.csv'), // From workspace root
  ];

  let csvPath = null;
  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      csvPath = testPath;
      break;
    }
  }

  if (!csvPath) {
    console.warn(`⚠️  [SCHEMA-LOADER] str.csv not found. Tried paths:`, possiblePaths);
    console.warn(`⚠️  [SCHEMA-LOADER] Falling back to empty schema.`);
    cachedSchema = { tables: {}, referencesMap: {} };
    return cachedSchema;
  }

  console.log(`✅ [SCHEMA-LOADER] Found str.csv at: ${csvPath}`);

  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  if (!header) {
    cachedSchema = { tables: {}, referencesMap: {} };
    return cachedSchema;
  }

  // Helper to safely split a CSV line respecting quoted commas.
  const splitCsvLine = (line) => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        // Toggle inQuotes unless escaping a quote
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  };

  const schema = {};
  const referencesMap = {};

  for (const line of lines) {
    const cells = splitCsvLine(line).map((cell) => cell.replace(/(^\"|\"$)/g, '')); // Trim surrounding quotes
    const [tableSchema, tableName, _ordinal, columnName, _dataType, _nullable, isPrimaryKey, fkTable, fkColumn] = cells;

    // Only consider public schema tables for now
    if (tableSchema !== 'public') continue;
    // Initialize table entry
    if (!schema[tableName]) {
      schema[tableName] = { columns: [], primaryKeys: [] };
    }

    schema[tableName].columns.push(columnName);
    if (isPrimaryKey === 'YES') {
      schema[tableName].primaryKeys.push(columnName);
    }

    if (fkTable && fkColumn) {
      if (!referencesMap[fkTable]) referencesMap[fkTable] = [];
      referencesMap[fkTable].push({ table: tableName, column: columnName, referencesColumn: fkColumn });
    }
  }

  cachedSchema = { tables: schema, referencesMap };
  return cachedSchema;
}

/**
 * Convenience helper – returns the first primary key column for a table,
 * or `id` as a sensible default.
 */
function getPrimaryKey(tableName) {
  const { tables } = loadSchema();
  return tables[tableName]?.primaryKeys?.[0] || 'id';
}

function getSchemaTables() {
  return loadSchema().tables;
}

function getReferencingRelations(targetTable, targetColumn) {
  const { referencesMap } = loadSchema();
  const list = referencesMap[targetTable] || [];
  return list.filter((rel) => rel.referencesColumn === targetColumn);
}

module.exports = { loadSchema, getSchemaTables, getPrimaryKey, getReferencingRelations }; 