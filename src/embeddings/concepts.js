/**
 * Concept / synonym groups for the LocalEmbedder's semantic layer.
 *
 * Each key is a concept id; each value is the list of surface terms that should
 * map onto it. When any of these terms appears in a query or a product, the
 * embedder fires the same concept dimension — so paraphrases land near each
 * other in vector space (e.g. "parka" and "winter coat" both hit `outerwear`).
 *
 * This is the offline stand-in for what a trained embedding model learns
 * implicitly. Extend it freely; nothing else needs to change.
 */
export const CONCEPTS = {
  // --- Outerwear / warmth -------------------------------------------------
  outerwear: ['coat', 'jacket', 'parka', 'outerwear', 'overcoat', 'anorak', 'windbreaker'],
  warmth: ['warm', 'insulated', 'thermal', 'fleece', 'cozy', 'heated', 'down', 'puffer'],
  cold_weather: ['winter', 'cold', 'snow', 'arctic', 'subzero', 'freezing'],
  waterproof: ['waterproof', 'rainproof', 'rain', 'water', 'resistant', 'gore'],

  // --- Footwear -----------------------------------------------------------
  athletic_shoe: ['sneaker', 'trainer', 'kick', 'runner', 'athletic', 'gym', 'tennis'],
  shoe: ['shoe', 'footwear', 'boot', 'sandal', 'cleat'],
  running: ['running', 'jog', 'marathon', 'sprint'],

  // --- Tops / activewear --------------------------------------------------
  top: ['shirt', 'tee', 't-shirt', 'top', 'blouse', 'jersey', 'hoodie', 'sweater'],
  activewear: ['activewear', 'sportswear', 'workout', 'training', 'performance', 'dri'],

  // --- Bags ---------------------------------------------------------------
  bag: ['bag', 'backpack', 'rucksack', 'knapsack', 'daypack', 'tote', 'handbag'],

  // --- Electronics --------------------------------------------------------
  phone: ['phone', 'smartphone', 'mobile', 'cellphone', 'handset', 'iphone', 'android'],
  laptop: ['laptop', 'notebook', 'ultrabook', 'macbook', 'chromebook'],
  computer: ['computer', 'pc', 'desktop'],
  headphones: ['headphone', 'earphone', 'earbud', 'headset', 'airpod'],
  wireless: ['wireless', 'bluetooth', 'cordless'],
  noise_cancelling: ['noise', 'cancelling', 'cancellation', 'anc', 'isolating'],

  // --- Camping / outdoor --------------------------------------------------
  camping: ['camping', 'camp', 'hiking', 'backpacking', 'trekking', 'outdoor'],
  sleeping_bag: ['sleeping', 'bag', 'bivy', 'mummy', 'bedroll'],

  // --- Kitchen ------------------------------------------------------------
  cookware: ['cookware', 'pan', 'pot', 'skillet', 'saucepan', 'wok', 'frypan'],
  nonstick: ['nonstick', 'ceramic', 'teflon', 'coated'],

  // --- Health & Beauty ----------------------------------------------------
  cosmetics: ['cosmetic', 'cosmetics', 'makeup', 'beauty'],
  makeup: ['makeup', 'lipstick', 'lip', 'gloss', 'mascara', 'eyeliner', 'foundation', 'concealer', 'blush', 'bronzer', 'eyeshadow', 'highlighter'],
  eye_makeup: ['eyebrow', 'brow', 'eyeliner', 'eyeshadow', 'mascara', 'lash', 'eye'],
  brow: ['brow', 'eyebrow', 'sculpt', 'gel', 'wax'],
  skincare: ['skincare', 'serum', 'moisturizer', 'moisturiser', 'cleanser', 'toner', 'cream', 'lotion', 'spf', 'sunscreen', 'exfoliant'],
  haircare: ['shampoo', 'conditioner', 'haircare', 'hairspray', 'pomade'],
  fragrance: ['perfume', 'cologne', 'fragrance', 'eau', 'parfum'],
  nailcare: ['nail', 'polish', 'lacquer', 'manicure'],

  // --- Generic attributes -------------------------------------------------
  lightweight: ['lightweight', 'light', 'ultralight', 'featherweight'],
  durable: ['durable', 'rugged', 'tough', 'heavy', 'duty', 'sturdy'],
  premium: ['premium', 'luxury', 'pro', 'professional', 'flagship', 'elite'],
  budget: ['budget', 'cheap', 'affordable', 'value', 'economy'],
};
