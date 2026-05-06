/**
 * Phase 6.2: type re-exports + runtime helpers for the
 * priced add-ons catalog.
 *
 * Thin re-export layer over `lib/addons/catalog.ts` so that
 * downstream code (Zod validators, admin UI, customer
 * checkout-prep page) can import types without pulling in the
 * full 20-row catalog data.
 */

export type {
  AddonCatalogEntry,
  AddonStatus,
  AddonSuggestionKey,
  AddonType,
} from './catalog';

export {
  ADDONS_BY_SUBTYPE,
  ADDONS_BY_TYPE,
  ADDONS_CATALOG,
  KNOWN_ADDON_SUBTYPES,
} from './catalog';
