// Headless test for big loans, seasonal prices, mines, crime and the newspaper:
//   loans    — the moneylender (no bank yet), terms by credit record, weekly payments, three missed → seized
//              buildings (never your home), and bankruptcy when that's not enough
//   prices   — the time of year moves prices (cheap food after the harvest), the weekly price record
//   mines    — dig a level (planks + money), shore up, ore from the tunnels each evening, cave-ins
//   crime    — who'd steal (and who never would), thefts from your storage, the lock, the constable, fines,
//              banishment the third time
//   news     — the weekly issue (headlines, prices, thefts), advertisements once the valley can print
//   and      — saving; old saves; no dice
// Usage: node tools/smoke-society.mjs
import { Simulation } from '../src/core/Simulation.js';
import { BANK_LOANS } from '../src/systems/FinanceSystem.js';
import { MINE } from '../src/systems/MineSystem.js';
import { CRIME } from '../src/systems/CrimeSystem.js';
import { NEWS } from '../src/systems/NewsSystem.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 6161);
const p = sim.state.player;
const F = sim.finance;
p.money = 200;

// ---------------------------------------------------------------- loans
check('No bank yet: the moneylender lends', F.lender() === 'moneylender');
check('A middling record to start', F.credit() === BANK_LOANS.startCredit);
const t1 = F.bankTerms(1200);
p.credit = 90;
const t2 = F.bankTerms(1200);
p.credit = BANK_LOANS.startCredit;
check('A good record means a cheaper loan', t2.rate < t1.rate, `${Math.round(t1.rate * 100)}% → ${Math.round(t2.rate * 100)}%`);
check('Not more than they would lend', F.canBankBorrow(3000).reason === 'over_limit', `limit ${F.bankLimit()}`);
const r0 = rand.getState();
const b = F.bankBorrow(1200);
check('Borrowed 1200', b.ok && p.money === 1400 && p.bankLoan?.left === t1.total, JSON.stringify(p.bankLoan));
check('One loan at a time', F.canBankBorrow(500).reason === 'loan_outstanding');
F.repayBankLoan();
check('A weekly payment, on time: the record improves', p.bankLoan.left === t1.total - t1.weekly && F.credit() === BANK_LOANS.startCredit + BANK_LOANS.onTime);
// Someone's house becomes yours (to be seized), and you go broke.
const P = sim.property;
const spare = Object.keys(P.all).find((id) => P.rec(id)?.owner && P.rec(id).owner !== 'village' && P.rec(id).owner !== 'player' && P.isHome(id) && id !== p.homeId);
P.transfer(spare, 'player', 'bought', 0);
p.money = 0;
F.repayBankLoan();
F.repayBankLoan();
check('Two payments missed: warned, record worse', p.bankLoan?.missed === 2 && F.credit() < BANK_LOANS.startCredit);
const seized = F.repayBankLoan();
check('Third missed: the lender takes what is owed', !p.bankLoan && P.rec(spare).owner === 'village', JSON.stringify(seized ?? null));
check('…but never the home you live in', !seized.taken.includes(p.homeId));
check('…and, as the house did not cover it all, you are bankrupt', p.bankrupt === sim.time.day && F.credit() === BANK_LOANS.bankruptCredit);
check('No one lends to you for a while', F.canBankBorrow(500).reason === 'recently_bankrupt');
check('Loans roll no dice', rand.getState() === r0);

// ---------------------------------------------------------------- prices
const E = sim.economy;
const T = sim.time;
const at = (season, day) => {
  const idx = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
  sim.state.time.totalMinutes = ((Math.floor(T.day / 56) * 56) + idx * 14 + day - 1) * 1440 + 10 * 60;
};
at('autumn', 10);
const autumn = E.seasonFactor('apple');
at('winter', 10);
const winter = E.seasonFactor('apple');
check('Apples are cheap after the harvest, dear in winter', autumn < 1 && winter > 1, `${autumn} / ${winter}`);
at('winter', 1);
check('…the change eases in over the first days', E.seasonFactor('apple') < winter && E.seasonFactor('apple') > autumn);
check('Next season the outlook: dearer', E.seasonOutlook('apple') === null || ['up', 'down'].includes(E.seasonOutlook('apple')));
const prices = sim.history.prices();
check('The weekly record of prices', prices.bread > 0 && Object.keys(prices).length >= 4, JSON.stringify(prices));

// ---------------------------------------------------------------- mines
const M = sim.mines;
const hut = Object.keys(P.all).find((id) => P.rec(id)?.owner === 'village' && !P.isHome(id) && !E.businessAtBuilding(id)) || spare;
sim.state.businesses.mine1 = { id: 'mine1', type: 'mining_camp', building: hut, owner: 'player', money: 100, stock: {}, daysUnpaid: 0, markup: 1, wageLevel: 1, reputation: 50, maxWorkers: 3, history: [], today: { rev: 0, exp: 0 }, opened: T.day, nameIdx: 0, founder: 'player' };
check('A mining camp of yours is a mine', M.isMine('mine1') && sim.holdings.isMine('mine1'));
p.money = 1000;
check("Digging needs planks", M.canDig('mine1').reason === 'need_item');
sim.inventory.add('planks', 60, { force: true });
const d = M.dig('mine1');
check('Dug down to level 2', d.ok && M.mine('mine1').depth === 2 && p.money === 1000 - MINE.digCost(1).money);
check('Unshored tunnels are risky', M.risk('mine1') > 0 && M.safety('mine1') === 0);
M.shore('mine1');
check('Shored up: safer', M.safety('mine1') === 1 && M.risk('mine1') === 0);
const miner = sim.state.npcs.find((n) => n.age >= 18 && n.age < 60);
miner.employer = 'mine1';
for (let i = 0; i < 4; i++) {
  miner.workedToday = true;
  M.daily();
}
check('The tunnels give coal each evening a miner worked', (sim.state.businesses.mine1.stock.coal || 0) >= 2, JSON.stringify(sim.state.businesses.mine1.stock));
M.dig('mine1');
M.dig('mine1');
const h0 = miner.health ?? 100;
const hurt = M.caveIn('mine1');
check('A cave-in: work stops, the miners are hurt, supports lost', M.halted('mine1') && hurt === 1 && miner.health < h0 && M.mine('mine1').supports < MINE.supportsPerLevel);
check("…and no one digs until it's cleared", M.canDig('mine1').reason === 'mine_caved_in');
const r1 = rand.getState();
M.weekly();
check('Mines roll no dice', rand.getState() === r1);

// ---------------------------------------------------------------- crime
const C = sim.crime;
const thief = sim.state.npcs.find((n) => n.age >= 20 && n !== miner && !n.traits.includes('generous') && !n.traits.includes('loyal') && !n.traits.includes('careful'));
thief.money = 2;
thief.mood = 10;
check('At the end of their rope, someone might steal', C.temptation(thief) > 0);
const saint = sim.state.npcs.find((n) => n.traits.includes('generous') || n.traits.includes('loyal') || n.traits.includes('careful'));
if (saint) {
  saint.money = 0;
  saint.mood = 0;
  check('The generous, the loyal, the careful never do', C.temptation(saint) === 0);
}
sim.home.add?.('bread', 10) ?? sim.state.player.storage.push({ id: 'bread', qty: 10 });
if (!sim.state.player.storage.some((s) => s && s.id === 'bread')) sim.state.player.storage.push({ id: 'bread', qty: 10 });
// Steal until one is from your storage (the target follows the hash of the day: try a few days).
let yours = null;
for (let i = 0; i < 30 && !yours; i++) {
  sim.state.time.totalMinutes += 1440;
  const c = C.steal(thief);
  if (c?.target === 'player') yours = c;
}
check('A theft from your storage, recorded as a case', !!yours && C.open().some((c) => c.id === yours.id), JSON.stringify(yours));
check('Only the constable investigates', C.canInvestigate(yours.id).reason === 'not_constable');
p.reputation = CRIME.constableRep + 1;
check('You can become the constable', C.becomeConstable().ok && C.isConstable());
check('Your patrols put thieves off', C.temptation(thief) < CRIME.base * 2);
thief.money = 100;
p.energy = 80;
const inv = C.investigate(yours.id);
check('Looked into it: solved, the thief fined', inv.solved && thief.convictions === 1 && inv.fined > 0, JSON.stringify(inv));
check('A lock on your storage', C.fitLock().ok && p.lock);
thief.convictions = CRIME.banishAfter - 1;
C.fine({ id: 999, day: T.day, thief: thief.id, target: 'player', kind: 'goods', item: 'bread', qty: 1, value: 3, solved: false }, false);
check('Caught the third time: they leave the valley', thief.leaving === true);
const r2 = rand.getState();
C.night();
check('Crime rolls no dice', rand.getState() === r2);

// ---------------------------------------------------------------- news
const N = sim.news;
sim.chronicle('chronicle.player_constable', {});
const issue = N.publish();
check('The weekly issue: headlines (you first), prices, thefts', issue.headlines.length > 0 && issue.headlines.some((h) => h.you) && Object.keys(issue.prices).length > 0, `${issue.headlines.length} headlines`);
check("…a hand-written sheet until the valley can print", issue.printed === false);
const shop = Object.keys(sim.state.businesses).find((id) => E.def(id)?.kind === 'shop');
sim.state.businesses[shop].owner = 'player';
check('No advertisements without a press', N.canAdvertise(shop).reason === 'no_press');
sim.state.tech.known ??= {};
sim.state.tech.known.printing = sim.state.tech.known.printing || { day: T.day };
check('With printing: The Valley Gazette', N.printed());
p.money = 500;
check('Advertise a shop of yours for a week', N.advertise(shop).ok && N.adBoost(shop) === NEWS.adBoost);
const issue2 = N.publish();
check('…the advertisement is in the paper', issue2.printed && issue2.ads.includes(shop));

// ---------------------------------------------------------------- saved
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('Saved: mines, cases, the paper, your credit', copy.mines.mine('mine1').depth === M.mine('mine1').depth && copy.mines.mine('mine1').depth >= 3 && copy.crime.S.cases.length === sim.crime.S.cases.length && copy.news.S.issues.length === 2 && copy.finance.credit() === F.credit());
const old = JSON.parse(JSON.stringify(sim.state));
delete old.mines;
delete old.crime;
delete old.news;
const o = new Simulation(old);
check('An old save (from before) loads', o.mines && o.crime.S.cases.length === 0 && o.news.S.issues.length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll society checks passed');
process.exit(failures ? 1 : 0);
