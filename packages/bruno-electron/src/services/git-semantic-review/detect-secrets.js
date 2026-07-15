const { SEVERITY, CONFIDENCE, createFinding } = require('./model');

const KEY_PATTERN = /(api[_-]?key|token|secret|password|passwd|private[_-]?key|client[_-]?secret|authorization)/i;
const VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}\b/i,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/
];

const mask = (value) => {
  const text = String(value || '');
  return text.length <= 6 ? '••••' : `••••${text.slice(-4)}`;
};

const walk = (value, path = '', output = []) => {
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => walk(child, path ? `${path}.${key}` : key, output));
  else if (typeof value === 'string') output.push({ path, value });
  return output;
};

const looksSecret = (path, value) => {
  if (!value || /{{.+}}/.test(value)) return false;
  return (KEY_PATTERN.test(path) && value.length >= 8) || VALUE_PATTERNS.some((pattern) => pattern.test(value));
};

const detectSecrets = ({ snapshots = [] }) => snapshots.flatMap((snapshot) => {
  if (!snapshot.newParsed && !snapshot.newContent) return [];
  const before = new Set(walk(snapshot.oldParsed || {}).map((entry) => `${entry.path}:${entry.value}`));
  return walk(snapshot.newParsed || {})
    .filter((entry) => !before.has(`${entry.path}:${entry.value}`))
    .filter((entry) => looksSecret(entry.path, entry.value))
    .map((entry) => createFinding({
      ruleId: 'secret.possible-credential-committed',
      severity: SEVERITY.SECRET,
      confidence: VALUE_PATTERNS.some((pattern) => pattern.test(entry.value)) ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      category: 'security',
      title: 'Possible secret committed',
      description: `A credential-like value was added at "${entry.path}" (${mask(entry.value)}).`,
      filePath: snapshot.filePath,
      section: entry.path.includes('auth') ? 'auth' : 'headers',
      evidence: { fieldPath: entry.path, maskedValue: mask(entry.value) }
    }));
});

const detectRawDiffSecrets = ({ diffs = [] }) => diffs.flatMap(({ filePath, diff }) => {
  const findings = [];
  String(diff || '').split('\n').forEach((line, index) => {
    if (!line.startsWith('+') || line.startsWith('+++')) return;
    const added = line.slice(1).trim();
    if (!added || /{{.+}}/.test(added)) return;
    const keyMatch = added.match(/^\s*([A-Za-z0-9_.-]*(?:token|secret|password|api[_-]?key|authorization|private[_-]?key)[A-Za-z0-9_.-]*)\s*[:=]\s*["']?(.+?)["']?\s*$/i);
    const candidate = keyMatch?.[2] || added;
    if (!looksSecret(keyMatch?.[1] || '', candidate)) return;
    findings.push(createFinding({
      ruleId: 'secret.raw-diff-credential',
      severity: SEVERITY.SECRET,
      confidence: VALUE_PATTERNS.some((pattern) => pattern.test(candidate)) ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      category: 'security',
      title: 'Possible secret added in raw diff',
      description: `A credential-like value was added on line ${index + 1} (${mask(candidate)}).`,
      filePath,
      section: 'raw',
      evidence: { line: index + 1, maskedValue: mask(candidate) }
    }));
  });
  return findings;
});

module.exports = { detectSecrets, detectRawDiffSecrets, mask };
