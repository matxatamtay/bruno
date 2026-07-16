const crypto = require('crypto');
const { inferSchema, mergeSchemas, normalizeSchema, stableStringify } = require('./infer-schema');
const { compareSchema, typeCompatible } = require('./compare-schema');

const schemaFingerprint = (schema) => crypto.createHash('sha256').update(stableStringify(normalizeSchema(schema))).digest('hex');

module.exports = {
  inferSchema,
  mergeSchemas,
  normalizeSchema,
  compareSchema,
  typeCompatible,
  schemaFingerprint
};
