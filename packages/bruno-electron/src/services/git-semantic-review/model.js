const SEVERITY = Object.freeze({ BREAKING: 'breaking', WARNING: 'warning', INFO: 'info', SECRET: 'secret' });
const CONFIDENCE = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

const createFinding = ({ ruleId, severity, confidence = CONFIDENCE.HIGH, category, title, description, filePath, section, evidence = {}, suggestedTests = [], affectedRequestPaths = [] }) => ({
  id: `${ruleId}:${filePath || 'collection'}:${section || 'general'}:${evidence.key || evidence.fieldPath || evidence.name || ''}`,
  ruleId, severity, confidence, category, title, description, filePath, section, evidence, suggestedTests, affectedRequestPaths
});

const summarizeFindings = (findings = [], affectedRequests = []) => findings.reduce((summary, finding) => {
  if (finding.severity === SEVERITY.BREAKING) summary.breaking += 1;
  if (finding.severity === SEVERITY.WARNING) summary.warnings += 1;
  if (finding.severity === SEVERITY.INFO) summary.info += 1;
  if (finding.severity === SEVERITY.SECRET) summary.secrets += 1;
  return summary;
}, { breaking: 0, warnings: 0, info: 0, secrets: 0, affectedRequests: affectedRequests.length });

module.exports = { SEVERITY, CONFIDENCE, createFinding, summarizeFindings };
