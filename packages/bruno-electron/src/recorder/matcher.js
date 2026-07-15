const PLACEHOLDER = /\{\{[^}]+\}\}|:[A-Za-z_][A-Za-z0-9_]*/g;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const NUMBER_SEGMENT = /^\d+$/;

const safeUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  const variableBaseMatch = trimmed.match(/^\{\{[^}]+\}\}(\/.*)?$/);
  if (variableBaseMatch) {
    try {
      return new URL(variableBaseMatch[1] || '/', 'http://bruno.local');
    } catch {
      return null;
    }
  }

  const normalized = trimmed.replace(PLACEHOLDER, 'bruno-placeholder');
  try {
    return new URL(normalized);
  } catch {
    try {
      return new URL(normalized, 'http://bruno.local');
    } catch {
      return null;
    }
  }
};

const splitPath = (pathname = '/') => pathname.split('/').filter(Boolean);

const segmentMatches = (definition, actual) => {
  if (definition === 'bruno-placeholder') return true;
  if (definition === actual) return true;
  if ((UUID_SEGMENT.test(actual) || NUMBER_SEGMENT.test(actual)) && /^(\{\{|:)/.test(definition)) return true;
  return false;
};

const scoreCandidate = (browserRequest, candidate) => {
  const browserMethod = String(browserRequest.method || 'GET').toUpperCase();
  const candidateMethod = String(candidate.method || 'GET').toUpperCase();
  if (browserMethod !== candidateMethod) return -1;

  const actualUrl = safeUrl(browserRequest.url);
  const definitionUrl = safeUrl(candidate.url);
  if (!actualUrl || !definitionUrl) return -1;

  let score = 8;
  const rawAuthority = String(candidate.url || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i)?.[1] || '';
  const definitionHasRealHost = definitionUrl.hostname !== 'bruno.local'
    && !String(candidate.url || '').trim().startsWith('{{')
    && !/\{\{[^}]+\}\}/.test(rawAuthority);
  if (definitionHasRealHost) {
    if (definitionUrl.hostname !== actualUrl.hostname) return -1;
    score += 4;
  }

  const actualSegments = splitPath(actualUrl.pathname);
  const definitionSegments = splitPath(definitionUrl.pathname);
  if (actualSegments.length !== definitionSegments.length) return -1;

  for (let index = 0; index < definitionSegments.length; index += 1) {
    if (!segmentMatches(definitionSegments[index], actualSegments[index])) return -1;
    score += definitionSegments[index] === actualSegments[index] ? 2 : 1;
  }

  const expectedQueryKeys = [...definitionUrl.searchParams.keys()].sort();
  const actualQueryKeys = new Set(actualUrl.searchParams.keys());
  if (expectedQueryKeys.length > 0) {
    score += expectedQueryKeys.filter((key) => actualQueryKeys.has(key)).length;
  }

  return score;
};

const matchCollectionRequest = (browserRequest, candidates = []) => {
  let best = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(browserRequest, candidate);
    if (score < 8 || (best && best.score >= score)) continue;
    best = {
      score,
      confidence: score >= 16 ? 'exact' : 'probable',
      itemUid: candidate.itemUid || candidate.uid || null,
      pathname: candidate.pathname || null,
      name: candidate.name || null,
      type: candidate.type || 'http-request',
      method: candidate.method || 'GET',
      url: candidate.url || ''
    };
  }
  return best;
};

module.exports = {
  matchCollectionRequest,
  scoreCandidate
};
