/**
 * Curated subset of the Google Product Category taxonomy, in Google's official
 * "<id> - <full > path>" line format.
 *
 * This is an illustrative slice (apparel, shoes, outerwear, electronics, sporting
 * goods, health & beauty) chosen so the bundled demos run offline. For production,
 * download the full ~6,000-category file from Google and load it with
 * `Taxonomy.fromFile(...)`:
 *
 *   https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt
 *
 * The ids below follow Google's taxonomy where known; a few leaf ids are
 * illustrative so the documented examples resolve cleanly. Merchant Center also
 * accepts the full category path string as google_product_category.
 */
export const SAMPLE_TAXONOMY = `# Google_Product_Taxonomy (curated subset)
166 - Apparel & Accessories
1604 - Apparel & Accessories > Clothing
5322 - Apparel & Accessories > Clothing > Outerwear
5598 - Apparel & Accessories > Clothing > Outerwear > Coats & Jackets
5506 - Apparel & Accessories > Clothing > Activewear
2271 - Apparel & Accessories > Clothing > Shirts & Tops
1581 - Apparel & Accessories > Shoes
187 - Apparel & Accessories > Shoes > Athletic Shoes
3237 - Apparel & Accessories > Shoes > Boots
3034 - Apparel & Accessories > Shoes > Sandals
167 - Apparel & Accessories > Handbags, Wallets & Cases
6552 - Apparel & Accessories > Handbags, Wallets & Cases > Backpacks
222 - Electronics
2082 - Electronics > Audio
505762 - Electronics > Audio > Audio Components > Headphones
267 - Electronics > Communications > Telephony > Mobile Phones
328 - Electronics > Computers
325 - Electronics > Computers > Laptops
988 - Sporting Goods
499713 - Sporting Goods > Outdoor Recreation
1011 - Sporting Goods > Outdoor Recreation > Camping & Hiking
3530 - Sporting Goods > Outdoor Recreation > Camping & Hiking > Sleeping Bags
536 - Home & Garden
604 - Home & Garden > Kitchen & Dining
668 - Home & Garden > Kitchen & Dining > Cookware
436 - Home & Garden > Furniture
469 - Health & Beauty
484 - Health & Beauty > Personal Care
2915 - Health & Beauty > Personal Care > Cosmetics
2619 - Health & Beauty > Personal Care > Cosmetics > Makeup
2779 - Health & Beauty > Personal Care > Cosmetics > Makeup > Eye Makeup
7362 - Health & Beauty > Personal Care > Cosmetics > Makeup > Eye Makeup > Eyebrow Enhancers
8206 - Health & Beauty > Personal Care > Cosmetics > Makeup > Face Makeup
2775 - Health & Beauty > Personal Care > Cosmetics > Makeup > Lip Makeup
2779001 - Health & Beauty > Personal Care > Cosmetics > Makeup > Nail Polish
567 - Health & Beauty > Personal Care > Cosmetics > Skin Care
2526 - Health & Beauty > Personal Care > Cosmetics > Skin Care > Moisturizers
2544 - Health & Beauty > Personal Care > Hair Care
2559 - Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne
537 - Baby & Toddler
1239 - Toys & Games
922 - Office Supplies
412 - Food, Beverages & Tobacco
`;
