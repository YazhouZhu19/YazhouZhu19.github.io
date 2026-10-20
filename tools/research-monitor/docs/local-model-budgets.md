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
IDs are never silently truncated. Methods, results and stated conclusions/limitations take priority
using the existing sentence parser and evidence patterns; omitted text is marked. Unstructured text
retains its beginning and end. Original abstracts and stored records remain unchanged. Synthesis and
final inference use the selected model's cap as well.

Regression fixtures with 24 long Chinese abstracts fit in four batches for every model (no increase
from the previous six-record cap; the previous conservative estimator could produce 24 batches).
Tests also check projected prompt sizes, ID preservation, exact sample limits, long-background
extraction and rejection before any model initialization for an oversized internal envelope.
