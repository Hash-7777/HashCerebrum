//! Typst manuscript rendering. The renderer hands over a structured
//! manuscript plus an already-resolved reference list; this builds a
//! self-contained Typst document and compiles it to PDF bytes with the
//! embedded Typst compiler.
//!
//! Fully offline: fonts come bundled via typst-assets, and no Typst
//! package or network access is configured.

use crate::error::{AppError, AppResult};
use serde::Deserialize;
use typst_as_lib::TypstEngine;

#[derive(Debug, Default, Deserialize)]
struct Abstract {
    #[serde(default)]
    background: String,
    #[serde(default)]
    objective: String,
    #[serde(default)]
    methods: String,
    #[serde(default)]
    results: String,
    #[serde(default)]
    conclusions: String,
}

#[derive(Debug, Default, Deserialize)]
struct Section {
    #[serde(default)]
    heading: String,
    #[serde(default)]
    body: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Figure {
    #[serde(default)]
    title: String,
    #[serde(default)]
    caption: String,
    #[serde(default)]
    svg: String,
}

#[derive(Debug, Default, Deserialize)]
struct Table {
    #[serde(default)]
    title: String,
    #[serde(default)]
    caption: String,
    #[serde(default)]
    columns: Vec<String>,
    #[serde(default)]
    rows: Vec<Vec<String>>,
}

#[derive(Debug, Default, Deserialize)]
struct Publication {
    #[serde(default)]
    standard: String,
    #[serde(default)]
    figures: Vec<Figure>,
    #[serde(default)]
    tables: Vec<Table>,
}

#[derive(Debug, Default, Deserialize)]
struct Manuscript {
    #[serde(default)]
    title: String,
    #[serde(default, rename = "abstract")]
    abstract_: Abstract,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    sections: Vec<Section>,
    #[serde(default)]
    publication: Option<Publication>,
}

// Public because it appears in the #[tauri::command] signature.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceLine {
    #[serde(default)]
    marker: String,
    #[serde(default)]
    text: String,
}

/// Escape a string so it is safe inside a Typst string literal. Content
/// rendered from a Typst string is never re-parsed as markup, so escaping
/// the two literal delimiters is sufficient.
fn esc(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn is_table_separator(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.contains('-') && trimmed.chars().all(|c| matches!(c, ' ' | '|' | ':' | '-'))
}

fn table_cells(line: &str) -> Vec<String> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim())
        .filter(|cell| !cell.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn collapse_ws(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn soften_long_token(token: &str) -> String {
    if token.chars().count() <= 42 {
        return token.to_string();
    }

    let mut out = String::new();
    let mut span = 0usize;
    for ch in token.chars() {
        out.push(ch);
        span += 1;
        if matches!(
            ch,
            '/' | '.' | ':' | '_' | '-' | '=' | '&' | '?' | '#' | ';' | ','
        ) || span >= 24
        {
            out.push('\u{200B}');
            span = 0;
        }
    }
    out
}

fn soften_long_tokens(value: &str) -> String {
    value
        .split(' ')
        .map(soften_long_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn table_rows_to_prose(rows: &[String]) -> Vec<String> {
    let parsed: Vec<Vec<String>> = rows
        .iter()
        .filter(|line| !is_table_separator(line))
        .map(|line| table_cells(line))
        .filter(|cells| cells.len() > 1)
        .collect();
    if parsed.is_empty() {
        return Vec::new();
    }

    let has_header = parsed.len() > 1;
    let header = &parsed[0];
    let data_rows: &[Vec<String>] = if has_header {
        &parsed[1..]
    } else {
        &parsed[..]
    };
    data_rows
        .iter()
        .map(|cells| {
            let text = if has_header && header.len() == cells.len() {
                cells
                    .iter()
                    .enumerate()
                    .map(|(index, cell)| format!("{}: {}", header[index], cell))
                    .collect::<Vec<_>>()
                    .join("; ")
            } else {
                cells.join("; ")
            };
            collapse_ws(&text)
        })
        .collect()
}

fn flush_table(output: &mut Vec<String>, table: &mut Vec<String>) {
    if table.is_empty() {
        return;
    }
    output.extend(table_rows_to_prose(table));
    table.clear();
}

fn clean_body_text(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n");
    let mut output = Vec::new();
    let mut table = Vec::new();

    for raw in normalized.lines() {
        let line = raw.trim();
        let is_table_row = line.contains('|') && table_cells(line).len() > 1;
        if is_table_row || (!table.is_empty() && is_table_separator(line)) {
            table.push(line.to_owned());
            continue;
        }

        flush_table(&mut output, &mut table);
        output.push(raw.replace('|', "; "));
    }

    flush_table(&mut output, &mut table);
    soften_long_tokens(&collapse_ws(&output.join(" ")))
}

/// One body paragraph as a Typst string in markup context.
fn paragraph(value: &str) -> String {
    format!("#\"{}\"\n\n", esc(&clean_body_text(value)))
}

struct PreparedFigure {
    filename: String,
    title: String,
    caption: String,
    bytes: Vec<u8>,
}

struct RenderStyle {
    margin_x: &'static str,
    margin_y: &'static str,
    body_size: &'static str,
    title_size: &'static str,
    heading_size: &'static str,
    paragraph_leading: &'static str,
}

fn render_style(manuscript: &Manuscript) -> RenderStyle {
    let standard = manuscript
        .publication
        .as_ref()
        .map(|publication| publication.standard.as_str())
        .unwrap_or("icmje_generic");
    match standard {
        "ama" => RenderStyle {
            margin_x: "2.54cm",
            margin_y: "2.54cm",
            body_size: "10pt",
            title_size: "18pt",
            heading_size: "12.5pt",
            paragraph_leading: "0.68em",
        },
        "nejm_style" => RenderStyle {
            margin_x: "2.35cm",
            margin_y: "2.6cm",
            body_size: "10.7pt",
            title_size: "19.5pt",
            heading_size: "13pt",
            paragraph_leading: "0.72em",
        },
        "lancet_style" => RenderStyle {
            margin_x: "2.15cm",
            margin_y: "2.45cm",
            body_size: "10.2pt",
            title_size: "18.5pt",
            heading_size: "12.5pt",
            paragraph_leading: "0.7em",
        },
        "nature_medicine_style" => RenderStyle {
            margin_x: "2.0cm",
            margin_y: "2.35cm",
            body_size: "10pt",
            title_size: "18pt",
            heading_size: "12pt",
            paragraph_leading: "0.68em",
        },
        _ => RenderStyle {
            margin_x: "2.3cm",
            margin_y: "2.7cm",
            body_size: "10.5pt",
            title_size: "19pt",
            heading_size: "13pt",
            paragraph_leading: "0.72em",
        },
    }
}

const SVG_ALLOWLIST: &[&str] = &[
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "defs",
    "use",
    "clipPath",
    "mask",
    "linearGradient",
    "radialGradient",
    "stop",
    "title",
    "desc",
    "style",
];

fn safe_svg_bytes(value: &str) -> Option<Vec<u8>> {
    let trimmed = value.trim();
    if trimmed.len() > 512 * 1024 {
        return None;
    }
    let lowered = trimmed.to_lowercase();
    if !lowered.starts_with("<svg") && !lowered.contains("<svg") {
        return None;
    }

    // Scan for disallowed tags, event handlers, and dangerous URLs.
    // We do a simple stateful scan over '<' delimited chunks.
    for chunk in trimmed.split('<').skip(1) {
        let tag_end = chunk
            .find(['>', ' ', '\t', '\n', '\r'])
            .unwrap_or(chunk.len());
        let tag = &chunk[..tag_end];
        let tag_lower = tag.to_lowercase();

        // Reject script and foreignObject outright
        if tag_lower == "script" || tag_lower == "foreignobject" {
            return None;
        }

        // Skip closing tags and comments
        if tag.starts_with('/') || tag.starts_with('!') {
            continue;
        }

        if !SVG_ALLOWLIST.iter().any(|allowed| tag_lower == *allowed) {
            return None;
        }

        // Check attributes in the remainder of the chunk (before '>')
        if let Some(gt_pos) = chunk.find('>') {
            let attr_section = &chunk[..gt_pos];
            // Reject event handlers: on...= (case-insensitive)
            if attr_section.to_lowercase().contains("on") && attr_section.chars().any(|c| c == '=')
            {
                // More precise: look for on[a-z]+\s*=
                let attr_lower = attr_section.to_lowercase();
                if attr_lower.contains("onload")
                    || attr_lower.contains("onclick")
                    || attr_lower.contains("onerror")
                    || attr_lower.contains("onmouse")
                    || attr_lower.contains("onkey")
                    || attr_lower.contains("onfocus")
                    || attr_lower.contains("onblur")
                    || attr_lower.contains("onsubmit")
                    || attr_lower.contains("onchange")
                    || attr_lower.contains("ondblclick")
                    || attr_lower.contains("oncontextmenu")
                    || attr_lower.contains("ondrag")
                    || attr_lower.contains("ondrop")
                    || attr_lower.contains("onscroll")
                    || attr_lower.contains("onwheel")
                    || attr_lower.contains("ontouch")
                    || attr_lower.contains("onpointer")
                    || attr_lower.contains("onanimation")
                    || attr_lower.contains("ontransition")
                {
                    return None;
                }
            }

            // Reject dangerous href / xlink:href values
            let attr_lower = attr_section.to_lowercase();
            if attr_lower.contains("javascript:")
                || attr_lower.contains("data:")
                || attr_lower.contains("file:")
            {
                return None;
            }
        }
    }

    Some(trimmed.as_bytes().to_vec())
}

fn prepare_figures(manuscript: &Manuscript) -> Vec<PreparedFigure> {
    manuscript
        .publication
        .as_ref()
        .map(|publication| {
            publication
                .figures
                .iter()
                .enumerate()
                .filter_map(|(index, figure)| {
                    safe_svg_bytes(&figure.svg).map(|bytes| PreparedFigure {
                        filename: format!("hashcerebrum-figure-{}.svg", index + 1),
                        title: figure.title.clone(),
                        caption: figure.caption.clone(),
                        bytes,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn build_typ(
    manuscript: &Manuscript,
    references: &[ReferenceLine],
    meta: &str,
    figures: &[PreparedFigure],
) -> String {
    let mut doc = String::new();
    let style = render_style(manuscript);

    doc.push_str(&format!(
        "#set document(title: \"{}\")\n",
        esc(&manuscript.title)
    ));
    doc.push_str(&format!(
        "#set page(paper: \"a4\", margin: (x: {}, y: {}), numbering: \"1 / 1\", number-align: center)\n",
        style.margin_x, style.margin_y
    ));
    doc.push_str(&format!(
        "#set text(font: \"Libertinus Serif\", size: {}, lang: \"en\")\n",
        style.body_size
    ));
    doc.push_str(&format!(
        "#set par(justify: false, leading: {})\n",
        style.paragraph_leading
    ));
    doc.push_str("#set heading(numbering: none)\n");
    doc.push_str(&format!(
        "#show heading.where(level: 1): set text(size: {})\n",
        style.heading_size
    ));
    doc.push_str("#show heading: set block(above: 1.3em, below: 0.7em)\n\n");

    // Title block.
    doc.push_str(&format!(
        "#align(center, text(size: {}, weight: \"bold\")[#\"{}\"])\n",
        style.title_size,
        esc(&manuscript.title)
    ));
    doc.push_str(&format!(
        "#align(center, text(size: 9pt, style: \"italic\", fill: rgb(\"#6e7480\"))[#\"{}\"])\n",
        esc(meta)
    ));
    doc.push_str("#v(4pt)\n#line(length: 100%, stroke: 0.5pt + rgb(\"#cbd5e1\"))\n#v(8pt)\n\n");

    // Abstract.
    let a = &manuscript.abstract_;
    let has_abstract = [
        &a.background,
        &a.objective,
        &a.methods,
        &a.results,
        &a.conclusions,
    ]
    .iter()
    .any(|field| !field.trim().is_empty());
    if has_abstract {
        doc.push_str("= Abstract\n");
        let field = |label: &str, value: &str| -> String {
            if value.trim().is_empty() {
                String::new()
            } else {
                format!(
                    "#par[*{}.* #\"{}\"]\n\n",
                    label,
                    esc(&clean_body_text(value))
                )
            }
        };
        doc.push_str(&field("Background", &a.background));
        doc.push_str(&field("Objective", &a.objective));
        doc.push_str(&field("Methods", &a.methods));
        doc.push_str(&field("Results", &a.results));
        doc.push_str(&field("Conclusions", &a.conclusions));
    }
    if !manuscript.keywords.is_empty() {
        doc.push_str(&format!(
            "#par[*Keywords.* #\"{}\"]\n\n",
            esc(&manuscript.keywords.join(", "))
        ));
    }

    // Body sections.
    for section in &manuscript.sections {
        doc.push_str(&format!("= {}\n", esc_heading(&section.heading)));
        if section.body.is_empty() {
            doc.push_str(&paragraph("This section is empty."));
        } else {
            for para in &section.body {
                doc.push_str(&paragraph(para));
            }
        }
    }

    if !figures.is_empty() {
        doc.push_str("= Figures\n");
        for (index, figure) in figures.iter().enumerate() {
            let caption = format!("Figure {}. {}. {}", index + 1, figure.title, figure.caption);
            doc.push_str(&format!(
                "#figure(image(\"{}\", width: 100%), caption: [#\"{}\"])\n\n",
                esc(&figure.filename),
                esc(&clean_body_text(&caption))
            ));
        }
    }

    if let Some(publication) = &manuscript.publication {
        if !publication.tables.is_empty() {
            doc.push_str("= Tables\n");
            for (index, table) in publication.tables.iter().enumerate() {
                let heading = format!("Table {}. {}", index + 1, table.title);
                doc.push_str(&format!("== {}\n", esc_heading(&heading)));
                if !table.caption.trim().is_empty() {
                    doc.push_str(&paragraph(&table.caption));
                }
                for row in &table.rows {
                    let cells = row
                        .iter()
                        .enumerate()
                        .map(|(cell_index, cell)| {
                            let label = table
                                .columns
                                .get(cell_index)
                                .map(String::as_str)
                                .unwrap_or("Value");
                            format!("{label}: {cell}")
                        })
                        .collect::<Vec<_>>()
                        .join("; ");
                    doc.push_str(&paragraph(&cells));
                }
            }
        }
    }

    // References — hanging indent, marker in bold.
    if !references.is_empty() {
        doc.push_str("= References\n");
        for reference in references {
            doc.push_str(&format!(
                "#par(hanging-indent: 1.2em)[*{}* #\"{}\"]\n\n",
                esc_heading(&reference.marker),
                esc(&soften_long_tokens(&collapse_ws(&reference.text)))
            ));
        }
    }

    doc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_body_text_soft_breaks_long_tokens() {
        let cleaned = clean_body_text(
            "Available from https://example.org/research/supplement/verylongunbrokentokenabcdefghijklmnopqrstuvwxyz0123456789.pdf",
        );

        assert!(cleaned.contains('\u{200B}'));
    }

    #[test]
    fn build_typ_soft_breaks_long_reference_lines() {
        let manuscript = Manuscript {
            title: "Export wrap test".into(),
            abstract_: Abstract::default(),
            keywords: Vec::new(),
            sections: vec![Section {
                heading: "Results".into(),
                body: vec!["A short result paragraph.".into()],
            }],
            publication: None,
        };
        let source = build_typ(
            &manuscript,
            &[ReferenceLine {
                marker: "[1]".into(),
                text: "A. Author. Long reference. Available from: https://example.org/research/supplement/verylongunbrokentokenabcdefghijklmnopqrstuvwxyz0123456789.pdf".into(),
            }],
            "HashCerebrum",
            &[],
        );

        assert!(source.contains('\u{200B}'));
    }
}

/// A heading is emitted inline (not as a string), so strip Typst markup
/// characters that would otherwise be interpreted.
fn esc_heading(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(c, '#' | '*' | '_' | '`' | '$' | '<' | '>' | '@' | '\\'))
        .collect()
}

fn compile(source: String, figures: Vec<PreparedFigure>) -> AppResult<Vec<u8>> {
    let figure_files = figures
        .into_iter()
        .map(|figure| (figure.filename, figure.bytes))
        .collect::<Vec<_>>();
    let static_files = figure_files
        .iter()
        .map(|(filename, bytes)| (filename.as_str(), bytes.as_slice()))
        .collect::<Vec<_>>();
    let engine = TypstEngine::builder()
        .main_file(source)
        .fonts(typst_assets::fonts())
        .with_static_file_resolver(static_files)
        .build();
    let document = engine
        .compile()
        .output
        .map_err(|errors| AppError::Pdf(format!("typst compile: {errors:?}")))?;
    typst_pdf::pdf(&document, &Default::default())
        .map_err(|errors| AppError::Pdf(format!("typst pdf: {errors:?}")))
}

const MAX_MANUSCRIPT_JSON_BYTES: usize = 5 * 1024 * 1024; // 5 MB
const MAX_SECTIONS: usize = 64;
const MAX_FIGURES: usize = 32;

#[tauri::command]
pub async fn render_manuscript_pdf(
    manuscript: serde_json::Value,
    references: Vec<ReferenceLine>,
    meta: Option<String>,
) -> AppResult<Vec<u8>> {
    let json_bytes =
        serde_json::to_vec(&manuscript).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    if json_bytes.len() > MAX_MANUSCRIPT_JSON_BYTES {
        return Err(AppError::InvalidInput(format!(
            "manuscript payload exceeds {} bytes",
            MAX_MANUSCRIPT_JSON_BYTES
        )));
    }
    let manuscript: Manuscript = serde_json::from_value(manuscript)?;
    if manuscript.sections.is_empty() {
        return Err(AppError::InvalidInput("manuscript has no sections".into()));
    }
    if manuscript.sections.len() > MAX_SECTIONS {
        return Err(AppError::InvalidInput(format!(
            "manuscript has {} sections (max {})",
            manuscript.sections.len(),
            MAX_SECTIONS
        )));
    }
    let figure_count = manuscript
        .publication
        .as_ref()
        .map(|p| p.figures.len())
        .unwrap_or(0);
    if figure_count > MAX_FIGURES {
        return Err(AppError::InvalidInput(format!(
            "manuscript has {} figures (max {})",
            figure_count, MAX_FIGURES
        )));
    }
    let figures = prepare_figures(&manuscript);
    let source = build_typ(
        &manuscript,
        &references,
        meta.as_deref().unwrap_or("HashCerebrum"),
        &figures,
    );
    // Typst compilation is CPU-bound and synchronous — keep it off the
    // async runtime's worker threads.
    tokio::task::spawn_blocking(move || compile(source, figures))
        .await
        .map_err(|e| AppError::Pdf(format!("join: {e}")))?
}
