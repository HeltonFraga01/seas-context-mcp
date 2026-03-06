import { describe, expect, it } from 'vitest';
import { enrichCortexxQuery } from '../packages/providers/cortexx/src/index.ts';
import { buildEntityPathHints, inferEntityFocus, parseQueryHints, scoreEvidenceWithHints } from '../packages/core-indexer/src/query.ts';
import type { EvidenceRecord } from '../packages/core-indexer/src/types.ts';

function evidence(path: string, score = 1): EvidenceRecord {
  return {
    id: path,
    path,
    source_type: 'local',
    snippet: path,
    score,
    confidence: 0.8,
    freshness: 0.8,
    metadata: {}
  };
}

describe('cortexx provider entity and timeline retrieval', () => {
  it('embeds structured hints in provider query enrichment', () => {
    const enriched = enrichCortexxQuery('onde está a spec da tenant factory?');
    const { cleanQuery, hints } = parseQueryHints(enriched);
    expect(cleanQuery).toContain('onde está a spec da tenant factory?');
    expect(hints.provider).toBe('cortexx');
    expect(hints.entities).toContain('spec');
    expect(hints.entities).toContain('tenant_context');
  });

  it('derives entity path hints for spec and timeline questions', () => {
    const { hints } = parseQueryHints(enrichCortexxQuery('o que mudou recentemente na spec do tenant runtime?'));
    const entities = inferEntityFocus(hints, 'o que mudou recentemente na spec do tenant runtime?');
    const pathHints = buildEntityPathHints(entities, hints.focus_terms ?? [], Boolean(hints.timeline));
    expect(pathHints).toContain('/specs/');
    expect(pathHints).toContain('requirements.md');
    expect(pathHints).toContain('runtime-contract');
    expect(pathHints).toContain('changelog');
  });

  it('scores spec artifacts above generic architecture docs for spec-focused queries', () => {
    const { hints } = parseQueryHints(enrichCortexxQuery('onde está a spec da tenant factory?'));
    const specScore = scoreEvidenceWithHints('architecture', evidence('/repo/.kiro/specs/demo/requirements.md'), 'onde está a spec da tenant factory?', hints);
    const archScore = scoreEvidenceWithHints('architecture', evidence('/repo/.context/docs/architecture.md'), 'onde está a spec da tenant factory?', hints);
    expect(specScore).toBeGreaterThan(archScore);
  });

  it('scores runbooks above generic plans for timeline-focused queries', () => {
    const { hints } = parseQueryHints(enrichCortexxQuery('o que mudou recentemente no runtime do tenant?'));
    const runbookScore = scoreEvidenceWithHints('timeline_change', evidence('/repo/.context/docs/runbooks/tenant-runtime-change.md'), 'o que mudou recentemente no runtime do tenant?', hints);
    const planScore = scoreEvidenceWithHints('timeline_change', evidence('/repo/.context/plans/runtime-plan.md'), 'o que mudou recentemente no runtime do tenant?', hints);
    expect(runbookScore).toBeGreaterThan(planScore);
  });
});
