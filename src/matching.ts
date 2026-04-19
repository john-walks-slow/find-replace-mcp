import type { SearchConfig, SearchMatcher } from './types.js';

export function createMatcher(config: SearchConfig, query: string): SearchMatcher {
  if (config.regex) {
    return {
      mode: 'js-regex',
      createGlobalRegex: () => buildJsRegex(query, config.wholeWord, config.caseSensitive),
      renderReplacement: (match, input, replacement) => expandReplacementTemplate(match, replacement, input)
    };
  }

  const literalSource = escapeRegexLiteral(query);
  return {
    mode: 'literal',
    createGlobalRegex: () => buildJsRegex(literalSource, config.wholeWord, config.caseSensitive),
    renderReplacement: (_match, _input, replacement) => replacement
  };
}

function buildJsRegex(source: string, wholeWord: boolean, caseSensitive: boolean): RegExp {
  const wrapped = wholeWord ? wrapWholeWord(source) : source;
  const flags = `${caseSensitive ? '' : 'i'}gu`;
  return new RegExp(wrapped, flags);
}

function wrapWholeWord(source: string): string {
  return `(?<![\\p{L}\\p{N}_$])(?:${source})(?![\\p{L}\\p{N}_$])`;
}

export function expandReplacementTemplate(match: RegExpExecArray, replacement: string, input: string): string {
  const groups = match.groups ?? {};
  const captures = match.slice(1);
  const matchText = match[0] ?? '';
  const matchStart = match.index;
  const matchEnd = matchStart + matchText.length;

  return replacement.replace(/\$(?:\$|&|`|'|\d{1,2}|<[^>]+>)/g, (token) => {
    if (token === '$$') {
      return '$';
    }
    if (token === '$&') {
      return matchText;
    }
    if (token === '$`') {
      return input.slice(0, matchStart);
    }
    if (token === "$'") {
      return input.slice(matchEnd);
    }
    if (/^\$\d{1,2}$/.test(token)) {
      const index = Number(token.slice(1));
      return captures[index - 1] ?? '';
    }
    if (token.startsWith('$<') && token.endsWith('>')) {
      return groups[token.slice(2, -1)] ?? '';
    }
    return token;
  });
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
