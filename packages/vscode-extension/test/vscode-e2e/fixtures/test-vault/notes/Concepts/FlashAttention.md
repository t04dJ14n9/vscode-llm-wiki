---
id: concept_flashattention
tags: [ml, attention, cuda]
---

# FlashAttention

FlashAttention is an IO-aware attention algorithm that uses tiling to reduce memory reads/writes between GPU HBM and SRAM.

## Key Ideas

- Uses **tiling** to compute attention in blocks
- Avoids materializing the full attention matrix in HBM
- Online softmax trick enables blockwise computation

## References

The original paper is in [flash-attention.pdf](hl://pdf/raw/pdf/flash-attention.pdf?anchor=anc_pdf_001).

See also [[Online Softmax]] for the mathematical foundation.
