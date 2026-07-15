const get = require('lodash/get');
const { SEVERITY, CONFIDENCE, createFinding } = require('./model');

const extractPaths = (value) => {
  const paths = new Set();
  JSON.stringify(value || '').replace(/res\.body\.([A-Za-z0-9_.\[\]-]+)/g, (_, path) => {
    paths.add(path);
    return _;
  });
  return paths;
};

const analyzeAssertionRisk = ({ snapshots = [] }) => snapshots.flatMap((snapshot) => {
  if (!snapshot.oldParsed || !snapshot.newParsed) return [];
  const oldAssertions = get(snapshot.oldParsed, 'request.assertions', []);
  const newAssertions = get(snapshot.newParsed, 'request.assertions', []);
  const testText = `${get(snapshot.newParsed, 'request.tests', '')}\n${JSON.stringify(newAssertions)}`;
  const paths = extractPaths(testText);
  const findings = [];
  if (paths.size && JSON.stringify(get(snapshot.oldParsed, 'request.body', {})) !== JSON.stringify(get(snapshot.newParsed, 'request.body', {}))) {
    findings.push(createFinding({
      ruleId: 'assertion.response-path-risk',
      severity: SEVERITY.WARNING,
      confidence: CONFIDENCE.LOW,
      category: 'test-coverage',
      title: 'Assertions may need review',
      description: `Response assertions reference ${[...paths].slice(0, 3).join(', ')} while the request contract changed.`,
      filePath: snapshot.filePath,
      section: newAssertions.length ? 'assertions' : 'tests',
      evidence: { paths: [...paths] }
    }));
  }
  if (oldAssertions.length > newAssertions.length) findings.push(createFinding({
    ruleId: 'assertion.coverage-reduced', severity: SEVERITY.WARNING, confidence: CONFIDENCE.HIGH,
    category: 'test-coverage', title: 'Assertion coverage reduced',
    description: `${oldAssertions.length - newAssertions.length} structured assertion(s) were removed.`,
    filePath: snapshot.filePath, section: 'assertions', evidence: { before: oldAssertions.length, after: newAssertions.length }
  }));
  return findings;
});

module.exports = analyzeAssertionRisk;
