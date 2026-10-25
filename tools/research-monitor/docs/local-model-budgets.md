# Local input budgets (P4.6)

| Model | Runtime context | Input cap (estimated) | Output reserve | Quick-preview records |
| --- | ---: | ---: | ---: | ---: |
| Qwen3-0.6B | 8,192 | 4,200 | 2,200 | 4 |
| Qwen3-1.7B | 8,192 | 5,200 | 2,200 | 6 |
| Qwen3-4B | 8,192 | 5,600 | 2,200 | 6 |

Estimation follows the plan: Han characters /1.5, other characters /4, plus 200 tokens of message
framing. This is a heuristic, not the model tokenizer; a context-related runtime rejection remains an
error, never an accepted truncated result. Runtime context remains bounded at 8,192 for every model.

Before adding a batch, the entire actual prompt is checked. Abstract/source excerpt budgets adapt
900 → 700 → 500 → 300 → 180 → 80 characters before another batch is created. Questions and citation
IDs are never silently truncated. Paper abstracts use complete source sentences, prioritizing a stated
limitation or negative conclusion and then methods/results. Selected sentences stay in source order;
nonconsecutive passages are separated by complete omission markers. No sentence, word or marker is
cut to force an excerpt under the cap.

`abstractExcerptStatus=excerpted` identifies selected sentences whose leading/trailing source sections
may be absent. If no complete sentence fits, the excerpt is empty and marked `omitted-budget`; this
explicitly means the source abstract exists but was omitted from this request, not that it was missing
at the source. The prompt tells the model to acknowledge this limitation and not infer results from a
title. Short abstracts that fit remain complete and unmarked. Original abstracts and stored records
remain unchanged. Synthesis and final inference use the selected model's cap as well.

Regression fixtures with 24 long Chinese abstracts fit in four batches for every model (no increase
from the previous six-record cap; the previous conservative estimator could produce 24 batches).
Tests also check projected prompt sizes, ID preservation, exact sample limits, long-background
extraction and rejection before any model initialization for an oversized internal envelope.

The excerpt follow-up passes 69 AI evidence, budget, client, retrieval and combined-source tests.
Boundary cases cover 300/180/80-character excerpts, complete negative conclusions, an oversized
single sentence explicitly omitted at 180/80, unchanged source text and IDs, and the actual Qwen3-0.6B
request with a 2,000-Han-character question and four long titles. That request remains one batch and
within its 4,200-token estimated input cap; the standard 24-record fixtures still require no more than
four batches. TypeScript checks also pass. These are local deterministic/mocked checks, not live model
quality or latency measurements.
