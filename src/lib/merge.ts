/**
 * Fusion à trois voies d'un document JSON (exercice, séance) modifié à plusieurs.
 *
 * `base` est le dernier état connu en commun, `local` et `remote` les deux versions divergentes.
 * On descend dans les objets clé par clé et dans les listes d'objets à `id` élément par élément :
 * deux personnes qui déplacent des joueurs différents gardent chacune leur modification.
 * Si les deux ont changé la même valeur, `prefer` départage (de façon identique des deux côtés).
 */
type Json = unknown;
type Obj = Record<string, Json>;

const isObj = (v: Json): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdList = (v: Json): v is Obj[] => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string');

export function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as Json[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], bb[i])) return false;
    return true;
  }
  const ka = Object.keys(a as Obj).filter((k) => (a as Obj)[k] !== undefined);
  const kb = Object.keys(b as Obj).filter((k) => (b as Obj)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!equal((a as Obj)[k], (b as Obj)[k])) return false;
  return true;
}

export function merge3<T>(base: T, local: T, remote: T, prefer: 'local' | 'remote'): T {
  return m(base, local, remote, prefer) as T;
}

function m(base: Json, local: Json, remote: Json, prefer: 'local' | 'remote'): Json {
  if (equal(local, remote)) return local;
  if (equal(base, local)) return remote;
  if (equal(base, remote)) return local;
  if (isObj(local) && isObj(remote)) return mergeObj(isObj(base) ? base : {}, local, remote, prefer);
  if (isIdList(local) && isIdList(remote)) return mergeList(isIdList(base) ? base : [], local, remote, prefer);
  return prefer === 'local' ? local : remote;
}

/** Une clé présente d'un seul côté : ajoutée (on la garde) ou supprimée (on la retire, sauf si l'autre côté l'a modifiée). */
function keepOneSided(inBase: boolean, baseV: Json, v: Json, side: 'local' | 'remote', prefer: 'local' | 'remote') {
  if (!inBase) return true;
  if (equal(baseV, v)) return false;
  return prefer === side;
}

function mergeObj(base: Obj, local: Obj, remote: Obj, prefer: 'local' | 'remote'): Obj {
  const out: Obj = {};
  for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const inL = local[k] !== undefined;
    const inR = remote[k] !== undefined;
    const inB = base[k] !== undefined;
    if (inL && inR) out[k] = m(base[k], local[k], remote[k], prefer);
    else if (inL) {
      if (keepOneSided(inB, base[k], local[k], 'local', prefer)) out[k] = local[k];
    } else if (inR) {
      if (keepOneSided(inB, base[k], remote[k], 'remote', prefer)) out[k] = remote[k];
    }
  }
  return out;
}

function mergeList(base: Obj[], local: Obj[], remote: Obj[], prefer: 'local' | 'remote'): Obj[] {
  const byId = (l: Obj[]) => new Map(l.map((x) => [x.id as string, x]));
  const b = byId(base);
  const l = byId(local);
  const out: Obj[] = [];
  // L'ordre de référence est celui de `remote` : identique des deux côtés tant que personne ne réordonne.
  for (const r of remote) {
    const id = r.id as string;
    const lv = l.get(id);
    if (lv) out.push(m(b.get(id), lv, r, prefer) as Obj);
    else if (keepOneSided(b.has(id), b.get(id), r, 'remote', prefer)) out.push(r);
  }
  // Éléments ajoutés (ou modifiés) uniquement en local : on les insère après leur voisin d'origine.
  const r = byId(remote);
  local.forEach((lv, i) => {
    const id = lv.id as string;
    if (r.has(id) || !keepOneSided(b.has(id), b.get(id), lv, 'local', prefer)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.findIndex((x) => x.id === local[j].id);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    out.splice(at, 0, lv);
  });
  return out;
}
