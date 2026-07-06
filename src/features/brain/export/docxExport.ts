// Manuscript → .docx export using the docx library.
// Produces a properly formatted Word document with styles, paragraphs,
// and a reference list — suitable for journal submission or collaborator review.

import {
  Document,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  AlignmentType,
  Packer,
  type IParagraphOptions,
} from 'docx';
import type { Manuscript } from '../swarm/manuscript';
import { formatReference, referenceUrl, type CitationStyle } from './citationStyles';
import type { EvidenceItem } from '@platform/index';

function headingStyle(level: number): IParagraphOptions {
  const map: Record<number, IParagraphOptions> = {
    1: { heading: HeadingLevel.HEADING_1, spacing: { after: 200 } },
    2: { heading: HeadingLevel.HEADING_2, spacing: { after: 160 } },
    3: { heading: HeadingLevel.HEADING_3, spacing: { after: 120 } },
  };
  return map[level] ?? { spacing: { after: 120 } };
}

function parseMarkdownParagraph(md: string): Paragraph {
  const children: TextRun[] = [];
  // Split on bold markers while preserving order
  const parts = md.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      children.push(
        new TextRun({ text: part.slice(2, -2), bold: true }),
      );
    } else {
      // Split on italic markers within the remaining text
      const italicParts = part.split(/(\*[^*]+\*)/g);
      for (const ip of italicParts) {
        if (ip.startsWith('*') && ip.endsWith('*') && ip.length > 2) {
          children.push(new TextRun({ text: ip.slice(1, -1), italics: true }));
        } else {
          children.push(new TextRun({ text: ip }));
        }
      }
    }
  }
  return new Paragraph({ children, spacing: { after: 160 } });
}

export async function buildDocxBlob(
  manuscript: Manuscript,
  references: EvidenceItem[],
  style: CitationStyle,
): Promise<Blob> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      text: manuscript.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
  );

  // Abstract
  children.push(
    new Paragraph({
      text: 'Abstract',
      ...headingStyle(1),
    }),
  );

  const abstractFields = [
    { label: 'Background', text: manuscript.abstract.background },
    { label: 'Objective', text: manuscript.abstract.objective },
    { label: 'Methods', text: manuscript.abstract.methods },
    { label: 'Results', text: manuscript.abstract.results },
    { label: 'Conclusions', text: manuscript.abstract.conclusions },
  ];

  for (const field of abstractFields) {
    if (!field.text) continue;
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${field.label}: `, bold: true }),
          new TextRun({ text: field.text }),
        ],
        spacing: { after: 120 },
      }),
    );
  }

  // Keywords
  if (manuscript.keywords.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Keywords: ', bold: true }),
          new TextRun({ text: manuscript.keywords.join(', ') }),
        ],
        spacing: { after: 300 },
      }),
    );
  }

  // Sections
  for (const section of manuscript.sections) {
    children.push(
      new Paragraph({
        text: section.heading,
        ...headingStyle(1),
      }),
    );
    for (const para of section.body) {
      children.push(parseMarkdownParagraph(para));
    }
  }

  // References
  if (references.length > 0) {
    children.push(
      new Paragraph({
        text: 'References',
        ...headingStyle(1),
      }),
    );
    for (const ref of references) {
      const line = formatReference(ref, style);
      const url = referenceUrl(ref);
      children.push(
        new Paragraph({
          // When a link is resolvable, the whole reference line is a clickable
          // hyperlink to the real paper (DOI → PubMed → …); otherwise plain text.
          ...(url
            ? {
                children: [
                  new ExternalHyperlink({
                    children: [new TextRun({ text: line, style: 'Hyperlink' })],
                    link: url,
                  }),
                ],
              }
            : { text: line }),
          spacing: { after: 80 },
          indent: { hanging: 360 },
        }),
      );
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
