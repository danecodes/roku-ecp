import { describe, it, expect } from 'vitest';
import { parseConsoleForIssues } from '../console.js';

describe('parseConsoleForIssues', () => {
  it('returns empty for clean output', () => {
    const result = parseConsoleForIssues('Loading manifest...\nHomeScene created');
    expect(result.errors).toHaveLength(0);
    expect(result.crashes).toHaveLength(0);
    expect(result.exceptions).toHaveLength(0);
  });

  it('catches BRIGHTSCRIPT: ERROR', () => {
    const { errors } = parseConsoleForIssues(
      'BRIGHTSCRIPT: ERROR roSGNode.CallFunc: Unknown function "badFn"'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('BRIGHTSCRIPT: ERROR');
  });

  it('catches Runtime Error', () => {
    const { errors } = parseConsoleForIssues(
      'Runtime Error. (runtime error &h02) in pkg:/source/utils.brs(17)'
    );
    expect(errors).toHaveLength(1);
  });

  it('catches Backtrace', () => {
    const { crashes } = parseConsoleForIssues('Backtrace:\n#1 Function crashyFn()');
    expect(crashes).toHaveLength(1);
  });

  it('catches BRIGHTSCRIPT STOP', () => {
    const { crashes } = parseConsoleForIssues('BRIGHTSCRIPT STOP encountered');
    expect(crashes).toHaveLength(1);
  });

  it('catches STOP in file', () => {
    const { exceptions } = parseConsoleForIssues('STOP in file pkg:/source/debug.brs(5)');
    expect(exceptions).toHaveLength(1);
  });

  it('catches PAUSE in file', () => {
    const { exceptions } = parseConsoleForIssues('PAUSE in file pkg:/source/ui.brs(12)');
    expect(exceptions).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const { errors } = parseConsoleForIssues('brightscript: error something');
    expect(errors).toHaveLength(1);
  });

  it('trims whitespace', () => {
    const { errors } = parseConsoleForIssues('   BRIGHTSCRIPT: ERROR bad   ');
    expect(errors[0]).toBe('BRIGHTSCRIPT: ERROR bad');
  });

  it('categorizes independently', () => {
    const result = parseConsoleForIssues(
      'BRIGHTSCRIPT: ERROR bad\nBacktrace:\nSTOP in file pkg:/foo.brs(1)'
    );
    expect(result.errors).toHaveLength(1);
    expect(result.crashes).toHaveLength(1);
    expect(result.exceptions).toHaveLength(1);
  });

  it('handles empty string', () => {
    const result = parseConsoleForIssues('');
    expect(result.errors).toHaveLength(0);
    expect(result.crashes).toHaveLength(0);
    expect(result.exceptions).toHaveLength(0);
  });
});
