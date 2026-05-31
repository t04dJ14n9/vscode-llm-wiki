---
id: concept_online_softmax
tags: [ml, math, softmax]
---

# Online Softmax

Online softmax is a technique for computing softmax in a single pass using running max and sum estimates.

## Algorithm

Given a sequence $x_1, x_2, \ldots, x_n$, online softmax maintains:

$$m_k = \max(m_{k-1}, x_k)$$

This is the key insight that enables FlashAttention's blockwise computation.
