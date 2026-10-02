// Loads the catalog the app uses: built-in, merged with the relay's newer
// copy when one is cached. Also refreshes that cache in the background.
import builtinDoc from "../data/catalog.json";
import { mergeCatalogs, parseCatalog, type Catalog } from "./catalog";

const builtin = parseCatalog(builtinDoc) ?? { version: "0", updated: "", entries: [] };

export async function loadCatalog(): Promise<Catalog> {
  if (!("__TAURI_INTERNALS__" in window)) return builtin;
  const { invoke } = await import("@tauri-apps/api/core");
  void invoke("catalog_fetch_remote").catch(() => {}); // next load gets it
  const cached = await invoke<unknown>("catalog_cached").catch(() => null);
  return mergeCatalogs(builtin, cached ? parseCatalog(cached) : null);
}

export function builtinCatalog(): Catalog {
  return builtin;
}
