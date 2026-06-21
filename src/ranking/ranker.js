/**
 * Learned ranker — the seam for moving ranking from hand-tuned weights to a
 * model that predicts engagement (CTR / conversion) from a blend of signals.
 *
 * The search engine scores candidates with a fixed linear formula
 * (`w.semantic * semantic + w.category * categoryBonus + …`). That works, but
 * the weights are guessed. This module keeps the same linear blend yet treats
 * the coefficients as *learnable*: a logistic-regression head over a feature
 * vector. Each candidate is reduced to a small, canonical feature vector
 *
 *   { semantic, category, price, quality, availability, attr }   // each ~0..1
 *
 * and the model emits `predict(features)` ∈ (0,1), interpretable as
 * P(click / convert). Train it on logged outcomes (`{ features, label }`) to
 * let the data, rather than intuition, set the relative pull of each signal.
 */

/**
 * Canonical feature names, in the fixed order the model's weight vector and
 * dot product iterate over.
 * @type {readonly string[]}
 */
export const FEATURE_KEYS = ['semantic', 'category', 'price', 'quality', 'availability', 'attr'];

/**
 * Sensible starting weights: semantic relevance dominates, the rest fill in.
 * `bias` shifts the decision boundary (negative → most items default to "no").
 * @type {{semantic:number, category:number, price:number, quality:number, availability:number, attr:number, bias:number}}
 */
export const DEFAULT_WEIGHTS = {
  semantic: 3,
  category: 1,
  price: 1,
  quality: 0.8,
  availability: 0.5,
  attr: 0.6,
  bias: -2,
};

/**
 * Logistic sigmoid, squashing a real number into (0,1).
 * @param {number} z
 * @returns {number}
 */
export function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

export class LearnedRanker {
  /**
   * @param {object} [weights=DEFAULT_WEIGHTS] per-feature weights plus a `bias`
   *   term. Cloned so callers can't mutate the model by reference; a `bias` of
   *   0 is filled in when absent.
   */
  constructor(weights = DEFAULT_WEIGHTS) {
    this.weights = { ...weights };
    if (typeof this.weights.bias !== 'number') this.weights.bias = 0;
  }

  /**
   * Raw linear combination: dot product of weights and features over
   * FEATURE_KEYS, plus the bias. Missing features count as 0.
   * @param {Record<string, number>} features
   * @returns {number}
   */
  score(features = {}) {
    let z = this.weights.bias;
    for (const key of FEATURE_KEYS) {
      z += (this.weights[key] ?? 0) * (features[key] ?? 0);
    }
    return z;
  }

  /**
   * Predicted probability of engagement, sigmoid(score) ∈ (0,1).
   * @param {Record<string, number>} features
   * @returns {number}
   */
  predict(features) {
    return sigmoid(this.score(features));
  }

  /**
   * Rank items by predicted probability, descending.
   * @param {{id:*, features:Record<string, number>}[]} items
   * @returns {{id:*, features:Record<string, number>, score:number}[]} new
   *   array, each item augmented with `score` (the predicted probability).
   */
  rank(items) {
    return items
      .map((item) => ({ ...item, score: this.predict(item.features) }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Fit weights and bias by logistic-regression gradient descent.
   * @param {{features:Record<string, number>, label:0|1}[]} samples
   * @param {object} [opts]
   * @param {number} [opts.epochs=200] number of full passes over the data
   * @param {number} [opts.lr=0.1] learning rate
   * @param {number} [opts.l2=0] L2 regularization strength (weights only)
   * @returns {{epochs:number, finalLoss:number}} avg log loss after training
   */
  train(samples, { epochs = 200, lr = 0.1, l2 = 0 } = {}) {
    const n = samples.length;
    let finalLoss = 0;
    for (let epoch = 0; epoch < epochs; epoch++) {
      const grad = {};
      for (const key of FEATURE_KEYS) grad[key] = 0;
      grad.bias = 0;
      finalLoss = 0;

      for (const { features, label } of samples) {
        const p = this.predict(features);
        const error = p - label;
        for (const key of FEATURE_KEYS) {
          grad[key] += error * (features[key] ?? 0);
        }
        grad.bias += error;
        finalLoss += logLoss(p, label);
      }

      finalLoss = n ? finalLoss / n : 0;
      if (!n) break;

      for (const key of FEATURE_KEYS) {
        this.weights[key] = (this.weights[key] ?? 0) - lr * (grad[key] / n + l2 * (this.weights[key] ?? 0));
      }
      this.weights.bias -= lr * (grad.bias / n);
    }
    return { epochs, finalLoss };
  }

  /**
   * Plain-object snapshot for persistence.
   * @returns {{weights:Record<string, number>}}
   */
  toJSON() {
    return { weights: { ...this.weights } };
  }

  /**
   * Rebuild a ranker from a `toJSON()` snapshot (or a bare weights object).
   * @param {{weights?:Record<string, number>}} obj
   * @returns {LearnedRanker}
   */
  static fromJSON(obj) {
    return new LearnedRanker(obj?.weights ?? obj);
  }
}

/** Per-sample log loss, clamped to avoid log(0). */
function logLoss(p, label) {
  const eps = 1e-12;
  const clamped = Math.min(Math.max(p, eps), 1 - eps);
  return -(label * Math.log(clamped) + (1 - label) * Math.log(1 - clamped));
}
