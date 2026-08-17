---
name: pdf
description: Use when an agent receives an LLM Wiki PDF selection, an RFC 8118 page/viewrect link, or must inspect a PDF figure, table, equation, page region, or cross-page text range in a vault.
---

# PDF selections

Treat the PDF as authoritative. Keep any copied raw text in context, then use the bundled helper to verify the source hash and extract the exact page region.

## Workflow

1. Collect every `Source` link in its given order, the `PDF source SHA-256`, and optional selected text.
2. Run from any directory:

   ```bash
   python3 .agents/skills/pdf/scripts/extract_selection.py extract \
     --vault /path/to/vault \
     --link 'raw/paper.pdf#page=2&viewrect=90%2C45%2C432%2C140' \
     --sha256 HEX \
     --quote 'optional copied text'
   ```

   Add one `--link` per cross-page region. Preserve their order.
3. Use `--render` only when layout or visual content matters, including figures, tables, diagrams, and equations. Inspect every returned PNG.
4. Compare `quote_status`, extracted text, and the source hash. Report mismatches instead of silently substituting text.
5. Remove rendered temporary files with the exact returned cleanup path:

   ```bash
   python3 .agents/skills/pdf/scripts/extract_selection.py cleanup --path /tmp/llm-wiki-pdf-selection-...
   ```

If `pdfplumber` is unavailable, run the helper through a temporary environment, for example `uv run --with 'pdfplumber>=0.11,<0.12' python ...`. Do not copy the PDF or retain screenshots in the vault.

## Output

The helper returns JSON with ordered targets, per-region raw text, normalized joined `extracted_text`, `quote_status`, rendered image paths, and `cleanup_path`.

## Common mistakes

- Do not turn `viewrect=L,T,W,H` into right/bottom coordinates before calling the helper.
- Do not merge or reorder cross-page links.
- Do not use OCR when the bounded PDF text layer is present.
- Do not trust a selection after a SHA-256 mismatch.
