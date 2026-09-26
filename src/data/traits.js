/**
 * Personality traits. Each trait modifies NPC behaviour through these numbers:
 *
 * relGain     — how quickly the NPC warms up to the player (chats, gifts)
 * workXp      — how fast they level up in their profession
 * social      — how often they chat with other villagers in free time
 * quitChance  — chance per day to quit after going unpaid
 * lateWake    — hours they oversleep
 * priceMarkup — extra markup if they own a shop
 * requestMult — reward multiplier for favours they ask
 * workSpeed   — how fast they work (chopping, mining, farm output)
 * tireMult    — how early they give up and go home to rest when tired
 */
/** Traits that can't go together (a child born to a hard worker and a lazy parent gets one of them, not both). */
export const TRAIT_OPPOSITES = { hard_worker: 'lazy', lazy: 'hard_worker', greedy: 'generous', generous: 'greedy', careful: 'risk_taker', risk_taker: 'careful', friendly: 'aggressive', aggressive: 'friendly' };

/** A trait list with no contradictions (the first of a clashing pair stays). */
export function consistentTraits(list) {
  const out = [];
  for (const t of list) if (!out.includes(t) && !out.includes(TRAIT_OPPOSITES[t])) out.push(t);
  return out;
}

export const TRAITS = {
  hard_worker: { workXp: 1.25, quitChance: 0.5, workSpeed: 1.15, tireMult: 0.6 },
  lazy: { workXp: 0.8, lateWake: 1, workSpeed: 0.85, tireMult: 1.8 },
  greedy: { priceMarkup: 0.05, relGain: 0.85, requestMult: 0.85 },
  generous: { relGain: 1.2, requestMult: 1.25 },
  loyal: { quitChance: 0.15, relGain: 1.1 },
  ambitious: { workXp: 1.1 },
  entrepreneur: { workXp: 1.05 },
  friendly: { relGain: 1.3, social: 1.6 },
  aggressive: { relGain: 0.7, social: 0.7 },
  scholar: { workXp: 1.15 },
  natural_leader: { relGain: 1.05 },
  risk_taker: { quitChance: 1.4 },
  careful: { quitChance: 0.7 },
};

export function traitValue(traits, field, fallback = 1) {
  let v = fallback;
  for (const t of traits || []) {
    const def = TRAITS[t];
    if (def && def[field] !== undefined) v = field === 'lateWake' || field === 'priceMarkup' ? v + def[field] : v * def[field];
  }
  return v;
}
