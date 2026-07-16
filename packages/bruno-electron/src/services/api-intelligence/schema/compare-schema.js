const typeCompatible = (expected, actual) => {
  if (expected === actual || expected === 'unknown' || actual === 'unknown') return true;
  return expected === 'number' && actual === 'integer';
};

const acceptsSchema = (expected, actual) => {
  if (expected?.type === 'union') return (expected.anyOf || []).some((candidate) => acceptsSchema(candidate, actual));
  return typeCompatible(expected?.type, actual?.type);
};

const finding = (severity, ruleId, path, message, expected, actual) => ({
  severity,
  ruleId,
  path,
  message,
  expected,
  actual
});

const compareSchema = (expected, actual, path = '$', findings = []) => {
  if (!expected || !actual) return findings;

  if (expected.type === 'union') {
    if (!(expected.anyOf || []).some((candidate) => acceptsSchema(candidate, actual))) {
      findings.push(finding('breaking', 'response-type-changed', path, `Type at ${path} is no longer compatible with the accepted contract`, expected.type, actual.type));
    }
    return findings;
  }

  if (!typeCompatible(expected.type, actual.type)) {
    findings.push(finding('breaking', 'response-type-changed', path, `Type changed at ${path}`, expected.type, actual.type));
    return findings;
  }

  if (expected.type === 'object') {
    const expectedProperties = expected.properties || {};
    const actualProperties = actual.properties || {};
    for (const key of expected.required || []) {
      if (!Object.prototype.hasOwnProperty.call(actualProperties, key)) {
        findings.push(finding('breaking', 'required-field-removed', `${path}.${key}`, `Required response field ${path}.${key} is missing`, expectedProperties[key]?.type || 'present', 'missing'));
      }
    }
    for (const [key, expectedProperty] of Object.entries(expectedProperties)) {
      if (Object.prototype.hasOwnProperty.call(actualProperties, key)) {
        compareSchema(expectedProperty, actualProperties[key], `${path}.${key}`, findings);
      }
    }
    for (const [key, actualProperty] of Object.entries(actualProperties)) {
      if (!Object.prototype.hasOwnProperty.call(expectedProperties, key)) {
        findings.push(finding('non-breaking', 'optional-field-added', `${path}.${key}`, `New response field ${path}.${key} was observed`, 'missing', actualProperty.type));
      }
    }
  }

  if (expected.type === 'array') compareSchema(expected.items, actual.items, `${path}[]`, findings);

  if (expected.type === 'string' && expected.format && actual.format && expected.format !== actual.format) {
    findings.push(finding('warning', 'string-format-drift', path, `String format changed at ${path}`, expected.format, actual.format));
  }

  return findings;
};

module.exports = { compareSchema, typeCompatible };
