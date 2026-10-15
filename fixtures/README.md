# Fictional sample PDFs

[Back to DocuChat](../README.md)

These fictional PDF fixtures exercise document isolation, source references, and failure handling. They contain no real project facts or personal records.

- [orchid.pdf](orchid.pdf): page 1 — launch code ORCHID-742, capacity 37 liters, lead Mira.
- [cedar.pdf](cedar.pdf): page 1 — launch code CEDAR-219, capacity 83 liters, lead Noah.
- blank.pdf / invalid.txt are deliberate failure fixtures.
- eval-*.pdf are generated from [authored evaluation materials](../eval/materials.json); see [27 cases](../eval/cases.json).

Try:
1. Orchid only: “What is the launch code?” → ORCHID-742, page 1.
2. Orchid only: “Who leads the project?” → Mira, page 1.
3. Both documents: “Compare their storage capacities.” → Orchid 37 / Cedar 83 liters, each page 1.
4. Orchid only: “What is its annual budget?” → insufficient evidence; no budget supplied.
5. “请用中文回答：Orchid 的负责人是谁？” → expected Mira, page 1; language adherence needs a real model and human review.

Mock mode echoes a retrieved chunk, including unrelated facts; it does not implement reliable refusal or translate answers. It must not be used to score the expected semantics above.

Recreate fixtures with npm run fixtures and npm run fixtures:eval. PDF timestamps/IDs may change on regeneration; content is the reproducible basis. The screenshots show offline mock answers using orchid.pdf.
