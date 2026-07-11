import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GeneAssociationCards } from '../GeneAssociationCards';
import type { GeneAssociation } from '../../swarm/genetics/associationConfidence';

const recognized: GeneAssociation = {
  gene: 'MTHFR',
  recognized: true,
  confidence: {
    score: 30,
    band: 'weak',
    supportCount: 1,
    refuteCount: 0,
    quantitativeCount: 1,
    totalCount: 1,
    pooledDirection: 'risk',
    rationale: 'Based on 1 significant association record (consistent risk direction).',
  },
};

const fake: GeneAssociation = {
  gene: 'ZXPQ7',
  recognized: false,
  confidence: {
    score: 0,
    band: 'insufficient',
    supportCount: 0,
    refuteCount: 0,
    quantitativeCount: 0,
    totalCount: 0,
    pooledDirection: 'none',
    rationale: '',
  },
};

const html = (a: GeneAssociation[]) => renderToStaticMarkup(<GeneAssociationCards associations={a} />);

describe('GeneAssociationCards', () => {
  it('renders a graded card with gene, band, direction and gauge for a recognized gene', () => {
    const out = html([recognized]);
    expect(out).toContain('MTHFR');
    expect(out).toContain('weak');
    expect(out).toContain('↑ Risk');
    expect(out).toContain('gene-gauge'); // the animated confidence ring
    expect(out).toContain('1 supporting record');
  });

  it('renders an unrecognized card with no score for a made-up gene', () => {
    const out = html([fake]);
    expect(out).toContain('ZXPQ7');
    expect(out).toContain('unrecognized');
    expect(out).toContain('gene-card--unrecognized');
    expect(out).not.toContain('gene-gauge-fill'); // no scored ring
  });

  it('renders nothing for an empty list', () => {
    expect(html([])).toBe('');
  });
});
