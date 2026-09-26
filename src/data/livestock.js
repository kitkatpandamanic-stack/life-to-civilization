/**
 * Farm animals (LivestockSystem): what each costs, eats and gives, and how much room it takes.
 *
 * space    — room in a barn (a barn holds FARM.barnSpace, more with each level)
 * feed     — fodder a winter day (hay first, then wheat, flour, cabbages, potatoes, apples) — the rest
 *            of the year they graze
 * gives    — { item, n, every (days), winter (share in winter) }
 */
export const LIVESTOCK = {
  chicken: { price: 14, space: 1, feed: 0.25, gives: { item: 'egg', n: 1, every: 1, winter: 0.5 }, icon: '🐔', sound: 'cluck' },
  sheep: { price: 55, space: 2, feed: 1, gives: { item: 'wool', n: 3, every: 7, winter: 0 }, icon: '🐑', sound: 'baa' },
  cow: { price: 140, space: 3, feed: 2, gives: { item: 'milk', n: 2, every: 1, winter: 0.5 }, icon: '🐄', sound: 'moo' },
};

export const FARM = {
  barnSpace: 12, // room in a barn (× its level)
  fodder: ['hay', 'wheat', 'flour', 'cabbage', 'potato', 'apple'], // winter fodder, in the order it's used
  hungry: 15, // health lost a day with nothing to eat
  heal: 5, // health back a day when fed
  producesAbove: 50, // a sick animal gives nothing
  produceCap: 60, // what a barn keeps waiting (more spoils)
  sellShare: 0.5, // selling one back to the farm: this share of the price
  hatchEvery: 7, // spring: a clutch of chicks every this many days (two hens or more, and room)
  collectAt: 6, // your workers go and collect once this much is waiting
  villageHerd: { cow: 3, sheep: 4, chicken: 6 }, // the village farm's own animals (to see about the farmhouse)
};
