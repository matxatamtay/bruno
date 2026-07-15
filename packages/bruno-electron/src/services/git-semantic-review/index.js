const analyzeRequestChange = require('./analyze-request-change');
const { summarizeFindings } = require('./model');

const analyzeSemanticChanges = ({ commitHash, snapshots = [], affectedRequests = [], partial = false, warnings = [] }) => {
  const findings = snapshots.flatMap(analyzeRequestChange);
  return { commitHash, summary: summarizeFindings(findings, affectedRequests), findings, affectedRequests, partial, warnings };
};

module.exports = { analyzeRequestChange, analyzeSemanticChanges };
