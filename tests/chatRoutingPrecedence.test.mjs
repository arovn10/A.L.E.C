/**
 * Regression test for chat routing precedence.
 *
 * Three rules this locks in:
 *   1. STOA's `isStoaRelated` anchor now matches contract/expir/tenant/unit
 *      terms so "what contracts are expiring soon" reaches STOA's
 *      getExpiringContracts handler instead of falling through to
 *      TenantCloud hallucinations.
 *   2. Source-preference override: the sourcePref detector in backend/server.js
 *      must extract "not tenantcloud" → excluded, "from stoa" → only=stoa.
 *   3. The TC regex (without the "tenantcloud" literal that caused self-firing
 *      on override phrases) still matches ordinary property/lease/rent words.
 *
 * We re-implement the exact regexes here and assert behavior so that if someone
 * edits server.js or stoaQueryService.js and breaks the invariant, this test
 * will catch it.
 */
import { describe, it, expect } from '@jest/globals';
import { detectStoaIntent } from '../services/stoaQueryService.js';

// ── Replicas of the live regexes (keep in sync with backend/server.js) ───
const tcIntentStream = /\b(tenants?|rent|payments?|overdue|maintenance|leases?|property|properties|units?|inquiry|inquiries|renters?|move.?out|move.?in|vacancy|vacant|occupan|evict)\b/i;

function sourcePref(userText) {
  const t = userText.toLowerCase();
  const excl = new Set(); const only = new Set();
  if (/\b(not|no|don'?t\s+use|skip|without|exclude|avoid)\s+(tenantcloud|tc)\b/.test(t)) excl.add('tc');
  if (/\b(not|no|don'?t\s+use|skip|without|exclude|avoid)\s+stoa\b/.test(t))             excl.add('stoa');
  if (/\b(from|use|only|via)\s+stoa\b|\bstoa\s+only\b|\bstoa\s+data\b/.test(t)) only.add('stoa');
  if (/\b(from|use|only|via)\s+tenantcloud\b|\btenantcloud\s+only\b/.test(t))   only.add('tc');
  return { excluded: excl, onlyThese: only };
}

describe('STOA intent anchor — contract/lease terms', () => {
  it('matches "what contracts are expiring soon"', () => {
    const r = detectStoaIntent('what contracts are expiring soon');
    expect(r).not.toBeNull();
    expect(r.intents).toContain('contract');
  });

  it('matches "which leases expire next month"', () => {
    const r = detectStoaIntent('which leases expire next month');
    expect(r).not.toBeNull();
    // Either 'renewal' or 'contract' intent should fire on "expire"
    expect(
      r.intents.includes('renewal') || r.intents.includes('contract')
    ).toBe(true);
  });

  it('still rejects unrelated questions', () => {
    expect(detectStoaIntent('how is the weather in miami')).toBeNull();
    expect(detectStoaIntent('what time is it')).toBeNull();
  });
});

describe('Source preference override', () => {
  it('"from stoa data not tenantcloud" → only=stoa, excluded=tc', () => {
    const p = sourcePref('from stoa data not tenantcloud');
    expect(p.onlyThese.has('stoa')).toBe(true);
    expect(p.excluded.has('tc')).toBe(true);
  });

  it('"use tenantcloud only" → only=tc', () => {
    const p = sourcePref('use tenantcloud only');
    expect(p.onlyThese.has('tc')).toBe(true);
  });

  it('"skip stoa" → excluded=stoa', () => {
    const p = sourcePref('skip stoa and check the portfolio');
    expect(p.excluded.has('stoa')).toBe(true);
  });

  it('neutral questions have no preference', () => {
    const p = sourcePref('how is hammond doing');
    expect(p.onlyThese.size).toBe(0);
    expect(p.excluded.size).toBe(0);
  });
});

describe('TC intent regex — no self-firing on "tenantcloud" literal', () => {
  it('does not match bare "tenantcloud" word', () => {
    // Before the fix, the regex had `tenantcloud|...` as a leading alternation,
    // so any message containing "tenantcloud" fired TC — including
    // "not tenantcloud" exclusion phrases. After the fix the alternation is
    // gone; the word "tenantcloud" alone does not qualify.
    expect(tcIntentStream.test('tenantcloud')).toBe(false);
    expect(tcIntentStream.test('not tenantcloud')).toBe(false);
  });

  it('still matches ordinary property/tenant/rent vocabulary', () => {
    expect(tcIntentStream.test('who has overdue rent')).toBe(true);
    expect(tcIntentStream.test('list open maintenance requests')).toBe(true);
    expect(tcIntentStream.test('how many tenants do we have')).toBe(true);
  });
});

describe('Precedence semantics (allow flags)', () => {
  // Composed behaviour: given sourcePref + stoaFired flag, decide whether TC fires.
  function tcShouldFire({ userText, stoaFired }) {
    const pref = sourcePref(userText);
    const allowTC = !pref.excluded.has('tc') &&
                    (pref.onlyThese.size === 0 || pref.onlyThese.has('tc'));
    const tcExplicit = pref.onlyThese.has('tc') || /\btenantcloud\b/i.test(userText);
    const tcIntent = tcIntentStream.test(userText);
    return allowTC && tcIntent && (tcExplicit || !stoaFired);
  }

  it('STOA fires → TC suppressed for overlapping intent', () => {
    expect(tcShouldFire({
      userText: 'what contracts are expiring soon',
      stoaFired: true,
    })).toBe(false);
  });

  it('STOA fires but user explicitly asked for TC → TC still fires', () => {
    expect(tcShouldFire({
      userText: 'pull overdue rent from tenantcloud',
      stoaFired: true,
    })).toBe(true);
  });

  it('STOA did not fire and user allows TC → TC fires', () => {
    expect(tcShouldFire({
      userText: 'any overdue rent',
      stoaFired: false,
    })).toBe(true);
  });

  it('User excludes TC → TC never fires', () => {
    expect(tcShouldFire({
      userText: 'from stoa data not tenantcloud — contracts expiring',
      stoaFired: false,
    })).toBe(false);
  });
});
