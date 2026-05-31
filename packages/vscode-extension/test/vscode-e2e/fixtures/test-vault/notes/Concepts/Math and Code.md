---
id: concept_math_code
tags: [test, math, code]
---

# Math and Code Rendering Test

This file tests both math equation and code block rendering.

## Inline Math

The softmax function is defined as $\sigma(x_i) = \frac{e^{x_i}}{\sum_{j} e^{x_j}}$.

Another example: $a^2 + b^2 = c^2$ and $\nabla f(x) = \left[\frac{\partial f}{\partial x_1}, \ldots, \frac{\partial f}{\partial x_n}\right]$.

## Block Math

The softmax with numerical stability:

$$\sigma(x_i) = \frac{e^{x_i - \max(x)}}{\sum_{j} e^{x_j - \max(x)}}$$

The attention mechanism:

$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

## Python Code

```python
def softmax(x):
    """Compute softmax numerically stable."""
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum()

def attention(Q, K, V):
    d_k = Q.shape[-1]
    scores = np.dot(Q, K.T) / np.sqrt(d_k)
    weights = softmax(scores)
    return np.dot(weights, V)
```

## JavaScript Code

```javascript
function flashAttention(Q, K, V) {
  const scale = Math.sqrt(Q[0].length);
  let O = new Array(Q.length).fill(null).map(() => new Array(V[0].length).fill(0));
  let m = new Array(Q.length).fill(-Infinity);
  let l = new Array(Q.length).fill(0);
  return O;
}
```

## Rust Code

```rust
fn online_softmax(x: &[f32]) -> Vec<f32> {
    let mut max_val = f32::NEG_INFINITY;
    let mut sum_exp = 0.0f32;
    for &xi in x {
        let new_max = max_val.max(xi);
        sum_exp = sum_exp * (max_val - new_max).exp() + (xi - new_max).exp();
        max_val = new_max;
    }
    x.iter().map(|&xi| (xi - max_val).exp() / sum_exp).collect()
}
```

## Math Inside Lists

Key equations:

- Softmax: $\sigma(x_i) = \frac{e^{x_i}}{\sum_j e^{x_j}}$
- Cross-entropy loss: $L = -\sum_{i} y_i \log(\hat{y}_i)$
- Gradient: $\frac{\partial L}{\partial x_i} = \hat{y}_i - y_i$

## Code with Comments

```python
# Online softmax maintains running statistics
# to compute softmax in a single pass
class OnlineSoftmax:
    def __init__(self):
        self.max_val = float('-inf')
        self.sum_exp = 0.0

    def update(self, x):
        new_max = max(self.max_val, x)
        self.sum_exp = self.sum_exp * exp(self.max_val - new_max) + exp(x - new_max)
        self.max_val = new_max
```
