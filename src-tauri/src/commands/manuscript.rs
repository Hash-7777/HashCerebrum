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
struct Manuscript {
    #[serde(default)]
    title: String,
    #[serde(default, rename = "abstract")]
    abstract_: Abstract,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    sections: Vec<Section>,
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
    trimmed.contains('-')
        && trimmed
            .chars()
            .all(|c| matches!(c, ' ' | '|' | ':' | '-'))
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
    let data_rows: &[Vec<String>] = if has_header { &parsed[1..] } else { &parsed[..] };
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
    collapse_ws(&output.join(" "))
}

/// One body paragraph as a Typst string in markup context.
fn paragraph(value: &str) -> String {
    format!("#\"{}\"\n\n", esc(&clean_body_text(value)))
}

fn build_typ(manuscript: &Manuscript, references: &[ReferenceLine], meta: &str) -> String {
    let mut doc = String::new();

    doc.push_str(&format!("#set document(title: \"{}\")\n", esc(&manuscript.title)));
    doc.push_str(
        "#set page(paper: \"a4\", margin: (x: 2.3cm, y: 2.7cm), numbering: \"1 / 1\", number-align: center)\n",
    );
    doc.push_str("#set text(font: \"Libertinus Serif\", size: 10.5pt, lang: \"en\")\n");
    doc.push_str("#set par(justify: false, leading: 0.72em)\n");
    doc.push_str("#set heading(numbering: none)\n");
    doc.push_str("#show heading.where(level: 1): set text(size: 13pt)\n");
    doc.push_str("#show heading: set block(above: 1.3em, below: 0.7em)\n\n");

    // Title block.
    doc.push_str(&format!(
        "#align(center, text(size: 19pt, weight: \"bold\")[#\"{}\"])\n",
        esc(&manuscript.title)
    ));
    doc.push_str(&format!(
        "#align(center, text(size: 9pt, style: \"italic\", fill: rgb(\"#6e7480\"))[#\"{}\"])\n",
        esc(meta)
    ));
    doc.push_str("#v(4pt)\n#line(length: 100%, stroke: 0.5pt + rgb(\"#cbd5e1\"))\n#v(8pt)\n\n");

    // Abstract.
    let a = &manuscript.abstract_;
    let has_abstract = [&a.background, &a.objective, &a.methods, &a.results, &a.conclusions]
        .iter()
        .any(|field| !field.trim().is_empty());
    if has_abstract {
        doc.push_str("= Abstract\n");
        let field = |label: &str, value: &str| -> String {
            if value.trim().is_empty() {
                String::new()
            } else {
                format!("#par[*{}.* #\"{}\"]\n\n", label, esc(&clean_body_text(value)))
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

    // References — hanging indent, marker in bold.
    if !references.is_empty() {
        doc.push_str("= References\n");
        for reference in references {
            doc.push_str(&format!(
                "#par(hanging-indent: 1.2em)[*{}* #\"{}\"]\n\n",
                esc_heading(&reference.marker),
                esc(&reference.text)
            ));
        }
    }

    doc
}

/// A heading is emitted inline (not as a string), so strip Typst markup
/// characters that would otherwise be interpreted.
fn esc_heading(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(c, '#' | '*' | '_' | '`' | '$' | '<' | '>' | '@' | '\\'))
        .collect()
}

fn compile(source: String) -> AppResult<Vec<u8>> {
    let engine = TypstEngine::builder()
        .main_file(source)
        .fonts(typst_assets::fonts())
        .build();
    let document = engine
        .compile()
        .output
        .map_err(|errors| AppError::Pdf(format!("typst compile: {errors:?}")))?;
    typst_pdf::pdf(&document, &Default::default())
        .map_err(|errors| AppError::Pdf(format!("typst pdf: {errors:?}")))
}

#[tauri::command]
pub async fn render_manuscript_pdf(
    manuscript: serde_json::Value,
    references: Vec<ReferenceLine>,
    meta: Option<String>,
) -> AppResult<Vec<u8>> {
    let manuscript: Manuscript = serde_json::from_value(manuscript)?;
    if manuscript.sections.is_empty() {
        return Err(AppError::InvalidInput("manuscript has no sections".into()));
    }
    let source = build_typ(
        &manuscript,
        &references,
        meta.as_deref().unwrap_or("HashCerebrum"),
    );
    // Typst compilation is CPU-bound and synchronous — keep it off the
    // async runtime's worker threads.
    tokio::task::spawn_blocking(move || compile(source))
        .await
        .map_err(|e| AppError::Pdf(format!("join: {e}")))?
}
