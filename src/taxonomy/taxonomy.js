/**
 * Google Product Category (GPC) Taxonomy — "the number system".
 *
 * Google organizes every product on the web into a single hierarchical tree of
 * ~6,000+ categories. Each category has:
 *   - a unique numeric id (e.g. 187)
 *   - a full category path (e.g. "Apparel & Accessories > Shoes > Athletic Shoes")
 *
 * This turns messy, merchant-specific product titles into one universal language
 * so the algorithm knows the broad classification of an item before it ever looks
 * at the fine-grained details.
 *
 * This module can load the official taxonomy file published by Google
 * (`taxonomy-with-ids.en-US.txt`), whose lines look like:
 *
 *     # Google_Product_Taxonomy_Version: 2021-09-21
 *     1 - Animals & Pet Supplies
 *     3237 - Animals & Pet Supplies > Live Animals
 *     187 - Apparel & Accessories > Shoes > Athletic Shoes
 *
 * If no file is provided it falls back to a curated bundled subset so the system
 * runs out of the box.
 */

import { readFileSync } from 'node:fs';
import { SAMPLE_TAXONOMY } from './sample-taxonomy.js';

const PATH_SEPARATOR = ' > ';

export class Taxonomy {
  constructor() {
    /** @type {Map<number, {id:number, name:string, path:string, parts:string[], parentId:number|null, childIds:number[]}>} */
    this.byId = new Map();
    /** @type {Map<string, number>} lowercased full path -> id */
    this.byPath = new Map();
  }

  /**
   * Build a Taxonomy from the official Google taxonomy text format.
   * @param {string} text
   * @returns {Taxonomy}
   */
  static fromText(text) {
    const tax = new Taxonomy();
    const lines = text.split(/\r?\n/);
    const pending = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      // Format: "<id> - <full > path>"
      const dash = line.indexOf(' - ');
      let id, path;
      if (dash !== -1) {
        id = Number.parseInt(line.slice(0, dash).trim(), 10);
        path = line.slice(dash + 3).trim();
      } else {
        // Some files ship without ids; synthesize a stable id from order.
        id = pending.length + 1;
        path = line;
      }
      if (!Number.isFinite(id) || !path) continue;
      pending.push({ id, path });
    }

    for (const { id, path } of pending) {
      tax._add(id, path);
    }
    tax._linkParents();
    return tax;
  }

  /**
   * Load the official taxonomy from a file path.
   * @param {string} filePath
   * @returns {Taxonomy}
   */
  static fromFile(filePath) {
    return Taxonomy.fromText(readFileSync(filePath, 'utf8'));
  }

  /**
   * The bundled curated subset (works offline, no file needed).
   * @returns {Taxonomy}
   */
  static sample() {
    return Taxonomy.fromText(SAMPLE_TAXONOMY);
  }

  _add(id, path) {
    const parts = path.split(PATH_SEPARATOR).map((p) => p.trim());
    const name = parts[parts.length - 1];
    const node = { id, name, path, parts, parentId: null, childIds: [] };
    this.byId.set(id, node);
    this.byPath.set(path.toLowerCase(), id);
  }

  _linkParents() {
    for (const node of this.byId.values()) {
      if (node.parts.length <= 1) continue;
      const parentPath = node.parts.slice(0, -1).join(PATH_SEPARATOR);
      const parentId = this.byPath.get(parentPath.toLowerCase());
      if (parentId != null && this.byId.has(parentId)) {
        node.parentId = parentId;
        this.byId.get(parentId).childIds.push(node.id);
      }
    }
  }

  /** @returns {number} number of categories loaded */
  get size() {
    return this.byId.size;
  }

  /** Look up a category by its numeric id. */
  get(id) {
    return this.byId.get(id) ?? null;
  }

  /** Look up a category id by its full path (case-insensitive). */
  getByPath(path) {
    const id = this.byPath.get(String(path).toLowerCase());
    return id != null ? this.byId.get(id) : null;
  }

  /** Return the chain of nodes from root down to the given category. */
  ancestors(id) {
    const chain = [];
    let node = this.get(id);
    while (node) {
      chain.unshift(node);
      node = node.parentId != null ? this.get(node.parentId) : null;
    }
    return chain;
  }

  /** Direct children of a category. */
  children(id) {
    const node = this.get(id);
    if (!node) return [];
    return node.childIds.map((cid) => this.get(cid));
  }

  /** All leaf categories (no children) — the "digital aisles" products land in. */
  leaves() {
    return [...this.byId.values()].filter((n) => n.childIds.length === 0);
  }

  /** Iterate every category node. */
  all() {
    return [...this.byId.values()];
  }
}

export { PATH_SEPARATOR };
