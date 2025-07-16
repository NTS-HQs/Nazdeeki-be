const fs = require('fs');
const path = require('path');

let cachedSchema = null;

/**
 * Load and parse str.csv into an in-memory schema description.
 * Returns an object keyed by table name → { columns: string[], primaryKeys: string[] }
 */
function loadSchema() {
  if (cachedSchema) return cachedSchema;

  // Resolve path to str.csv two directories up from this file (project root)
  const csvPath = path.resolve(__dirname, '..', '..', '..', 'str.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn(`⚠️  [SCHEMA-LOADER] str.csv not found at ${csvPath}. Falling back to empty schema.`);
    cachedSchema = { tables: {}, referencesMap: {} };
    return cachedSchema;
  }

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