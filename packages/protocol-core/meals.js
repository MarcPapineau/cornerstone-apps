'use strict';
/**
 * meals.js — the native meal-plan generator (wires the reserved Diet / Meal-Prep slot).
 *
 * Deterministic, offline, never fabricates. It produces a macro TARGET, a weekly plan of
 * real seeded meals, a grocery list, substitutions, and prep notes — as a DRAFT, resource
 * only, never a medical claim. Three honesty rules:
 *   1. HARD EXCLUSION: a meal containing a listed allergen OR a disliked food is removed —
 *      it can never appear in the plan (the acceptance tests lock this).
 *   2. ESTIMATED IS LABELLED: when calories are not provided, the target is estimated via
 *      Mifflin–St Jeor and flagged ESTIMATED + providerReviewRequired; when the inputs to
 *      estimate are missing, it is honestly UNKNOWN (no number invented).
 *   3. SOURCE_PENDING, NOT FAKE: macros come from the curated seed (data/foods.js), labelled
 *      CURATED_ESTIMATE pending USDA verification; a food not in the seed → SOURCE_PENDING.
 * NOT medical advice, NOT a diagnosis, NOT a prescription.
 */
const gates = require('./gates');
const foodsData = require('./data/foods');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null));
const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));
const round = (n) => (n == null ? null : Math.round(n));

// --- Macro target -----------------------------------------------------------
// Activity factor from training days/week + intensity (standard multipliers).
function activityFactor(daysPerWeek, intensity) {
  const d = num(daysPerWeek) || 0;
  const i = norm(intensity);
  if (d <= 0) return 1.2;                       // sedentary
  if (d <= 2) return 1.375;                      // light
  if (d <= 4) return i.includes('high') || i.includes('vigorous') ? 1.6 : 1.55; // moderate
  if (d <= 6) return 1.725;                      // very active
  return 1.9;                                    // extra active
}

// Goal → calorie adjustment + protein g/kg (of lean mass if known, else body weight).
const GOAL_TUNE = {
  'fat loss': { kcalMult: 0.80, proteinPerKg: 2.0 },
  'muscle gain': { kcalMult: 1.10, proteinPerKg: 1.8 },
  maintenance: { kcalMult: 1.0, proteinPerKg: 1.6 },
  recovery: { kcalMult: 1.0, proteinPerKg: 1.8 },
  energy: { kcalMult: 1.0, proteinPerKg: 1.6 },
};
function goalTune(goal) {
  const g = norm(goal);
  for (const key of Object.keys(GOAL_TUNE)) if (g.includes(norm(key))) return GOAL_TUNE[key];
  return GOAL_TUNE.maintenance;
}

/**
 * estimateMacroTarget(input) → { status, kcal, proteinG, carbG, fatG, basis, providerReviewRequired, source }
 *   status: 'PROVIDED' (caller gave calories) | 'ESTIMATED' (computed) | 'UNKNOWN' (cannot compute)
 * Never invents a number: if calories are unknown AND the inputs to estimate are missing,
 * it returns UNKNOWN with null macros and providerReviewRequired:true.
 */
function estimateMacroTarget(input = {}) {
  // Accept either `goal` (string) or `goals` (array, the intake shape) — otherwise the
  // goal-based calorie + protein adjustment is silently skipped.
  const goal = input.goal || (Array.isArray(input.goals) ? input.goals[0] : input.goals) || null;
  const tune = goalTune(goal);
  const weightKg = num(input.weightKg);
  const leanKg = num(input.leanMassKg);
  const proteinBaseKg = leanKg || weightKg;

  // 1) Calories provided → use them verbatim.
  const provided = num(input.caloriesKnown != null ? input.caloriesKnown : input.kcalKnown);
  if (provided) {
    return macroSplit('PROVIDED', provided, proteinBaseKg, tune, false,
      'Calories provided by the client; macros split to goal.');
  }

  // 2) Estimate via Mifflin–St Jeor (needs age, sex, height, weight).
  const age = num(input.age);
  const heightCm = num(input.heightCm);
  const sex = norm(input.sex);
  if (age && heightCm && weightKg && (sex === 'male' || sex === 'female')) {
    const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
    const tdee = bmr * activityFactor(input.activityDaysPerWeek, input.intensity);
    const kcal = tdee * tune.kcalMult;
    return macroSplit('ESTIMATED', kcal, proteinBaseKg, tune, true,
      'Estimated via Mifflin–St Jeor × activity factor, adjusted to goal. ESTIMATE — confirm with your practitioner.');
  }

  // 3) Cannot estimate honestly → UNKNOWN (never a guessed number).
  return {
    status: 'UNKNOWN',
    kcal: null, proteinG: null, carbG: null, fatG: null,
    basis: 'Not enough inputs to estimate calories (need age, sex, height, weight, or a known calorie target). Left UNKNOWN — your practitioner will set this.',
    providerReviewRequired: true,
    source: foodsData.MACRO_SOURCE,
  };
}

function macroSplit(status, kcal, proteinBaseKg, tune, providerReviewRequired, basis) {
  const k = Math.max(1000, Math.min(5000, kcal)); // sane bounds; never absurd
  const proteinG = proteinBaseKg ? proteinBaseKg * tune.proteinPerKg : (k * 0.30) / 4;
  const fatG = (k * 0.27) / 9;                     // ~27% kcal from fat
  const carbG = Math.max(0, (k - proteinG * 4 - fatG * 9) / 4);
  return {
    status,
    kcal: round(k),
    proteinG: round(proteinG),
    carbG: round(carbG),
    fatG: round(fatG),
    basis,
    providerReviewRequired: !!providerReviewRequired,
    source: foodsData.MACRO_SOURCE,
  };
}

// --- Whole-food macro lookup (SOURCE_PENDING when unseeded) ------------------
function macroForFood(name) {
  const want = norm(name);
  const hit = (foodsData.FOODS || []).find((f) => norm(f.name) === want);
  if (hit) return { name: hit.name, kcal: hit.kcal, protein: hit.protein, carb: hit.carb, fat: hit.fat, source: foodsData.MACRO_SOURCE };
  // Not in the seed → SOURCE_PENDING. The USDA connector (usda_fdc) is the enrichment path;
  // until a value is sourced we return null macros, never a fabricated number.
  return { name, kcal: null, protein: null, carb: null, fat: null, source: 'SOURCE_PENDING' };
}

// --- Exclusion (HARD) -------------------------------------------------------
function mealIsAllowed(meal, allergySet, dislikeList, style) {
  // allergen hard-block
  for (const a of meal.allergens || []) if (allergySet.has(norm(a))) return false;
  // disliked-food hard-block (substring against ingredient names)
  for (const ing of meal.ingredients || []) {
    const ni = norm(ing);
    for (const d of dislikeList) if (d && (ni.includes(d) || d.includes(ni))) return false;
  }
  // dietary-style filter (only when the client named a style)
  if (style && !(meal.dietaryStyles || []).map(norm).includes(style)) return false;
  return true;
}

// Soft preference score (higher = better fit): favorite foods, flavor, budget, prep.
function preferenceScore(meal, prefs) {
  let s = 0;
  const ingBlob = norm((meal.ingredients || []).join(' '));
  for (const fav of prefs.favorites) if (fav && ingBlob.includes(fav)) s += 5;
  if (prefs.flavor && norm(meal.flavor) === prefs.flavor) s += 2;
  if (prefs.budget && norm(meal.budget) === prefs.budget) s += 1;
  if (prefs.maxPrep && num(meal.prepMinutes) != null && meal.prepMinutes <= prefs.maxPrep) s += 1;
  return s;
}

function slotsForMealsPerDay(mealsPerDay, snacks) {
  const n = num(mealsPerDay) || 3;
  const base = ['breakfast', 'lunch', 'dinner'];
  const out = base.slice(0, Math.max(2, Math.min(3, n)));
  if (n >= 4 || snacks) out.push('snack');
  if (n >= 5) out.push('snack');
  return out;
}

/**
 * generateMealPlan(input) → a structured DRAFT meal plan (resource only).
 * input: age, sex, heightCm, weightKg, bodyFatPct, leanMassKg, goal, activityDaysPerWeek,
 *        intensity, occupation, dietaryStyle, allergies[], dislikes[], favorites[],
 *        cookingPreference, flavorPreference, mealsPerDay, snacks, prepStyle, budget,
 *        periodicity ('weekly'|'monthly'), caloriesKnown.
 */
function generateMealPlan(input = {}) {
  const allergies = arr(input.allergies).map(norm).filter(Boolean);
  const dislikes = arr(input.dislikes).map(norm).filter(Boolean);
  const allergySet = new Set(allergies);
  const style = norm(input.dietaryStyle) || null;
  const prefs = {
    favorites: arr(input.favorites).map(norm).filter(Boolean),
    flavor: norm(input.flavorPreference) || null,
    budget: norm(input.budget) || null,
    maxPrep: norm(input.cookingPreference).includes('quick') ? 20 : (num(input.maxPrepMinutes) || null),
  };
  const periodicity = norm(input.periodicity) === 'monthly' ? 'monthly' : 'weekly';
  const slots = slotsForMealsPerDay(input.mealsPerDay, input.snacks);

  const macroTarget = estimateMacroTarget(input);

  // Candidate pool per slot after HARD exclusion, ranked by soft preference (stable, no RNG).
  const poolBySlot = {};
  const emptySlots = [];
  for (const slot of slots) {
    const pool = foodsData.MEALS
      .filter((m) => m.slot === slot && mealIsAllowed(m, allergySet, dislikes, style))
      .map((m) => ({ meal: m, score: preferenceScore(m, prefs) }))
      .sort((a, b) => b.score - a.score || a.meal.id.localeCompare(b.meal.id))
      .map((x) => x.meal);
    poolBySlot[slot] = pool;
    if (!pool.length) emptySlots.push(slot);
  }

  // 7-day week; deterministic rotation through each slot's ranked pool for variety.
  const days = [];
  for (let d = 0; d < 7; d++) {
    const meals = [];
    let kcal = 0, protein = 0, carb = 0, fat = 0;
    for (const slot of slots) {
      const pool = poolBySlot[slot];
      if (!pool.length) {
        meals.push({ slot, name: null, status: 'NO_COMPLIANT_OPTION', note: 'No seeded meal fits the exclusions for this slot — your practitioner will add one.' });
        continue;
      }
      const m = pool[d % pool.length];
      meals.push({ slot, id: m.id, name: m.name, kcal: m.kcal, protein: m.protein, carb: m.carb, fat: m.fat, macroSource: foodsData.MACRO_SOURCE });
      kcal += m.kcal; protein += m.protein; carb += m.carb; fat += m.fat;
    }
    days.push({ day: d + 1, meals, dayTotals: { kcal, proteinG: protein, carbG: carb, fatG: fat, macroSource: foodsData.MACRO_SOURCE } });
  }

  // Grocery list — aggregate ingredients across the selected meals (counts), de-duplicated.
  const groceryCounts = {};
  const usedMealIds = new Set();
  for (const day of days) for (const m of day.meals) if (m.id) usedMealIds.add(m.id);
  for (const id of usedMealIds) {
    const meal = foodsData.MEALS.find((x) => x.id === id);
    for (const ing of (meal && meal.ingredients) || []) groceryCounts[ing] = (groceryCounts[ing] || 0) + 1;
  }
  const groceryList = Object.keys(groceryCounts).sort().map((item) => ({ item, mealsUsing: groceryCounts[item] }));

  // Substitutions — only for the allergens/dislikes that actually constrained the plan.
  const substitutions = [];
  for (const a of allergies) {
    const sub = foodsData.SUBSTITUTIONS.find((s) => norm(s.forTag) === a);
    if (sub) substitutions.push({ excluded: a, reason: 'allergy', alternatives: sub.alternatives });
  }
  for (const d of dislikes) substitutions.push({ excluded: d, reason: 'disliked', alternatives: ['Swap for an equivalent protein/carb you enjoy — your practitioner can tailor this.'] });

  // Prep notes from cooking/prep style.
  const prepNotes = [];
  const prepStyle = norm(input.prepStyle) + ' ' + norm(input.cookingPreference);
  if (prepStyle.includes('batch') || prepStyle.includes('prep')) prepNotes.push('Batch-cook proteins and grains once or twice a week, then assemble meals.');
  if (prepStyle.includes('quick') || prefs.maxPrep) prepNotes.push('Meals were biased toward shorter prep times where possible.');
  prepNotes.push('Adjust portion sizes to hit the macro target above — your practitioner can fine-tune.');

  const sourceNotes = [
    `Macros are ${foodsData.MACRO_SOURCE} — ${foodsData.MACRO_PROVENANCE}`,
  ];
  if (emptySlots.length) sourceNotes.push(`No compliant seeded option for: ${emptySlots.join(', ')} — left for your practitioner (no meal fabricated).`);

  const plan = {
    _model: 'MealPlanDraft',
    periodicity,
    macroTarget,
    slots,
    days,
    groceryList,
    substitutions,
    prepNotes,
    excluded: { allergies, dislikes, dietaryStyle: style },
    sourceNotes,
    monthlyNote: periodicity === 'monthly'
      ? 'Monthly plan scaffolds from this weekly template (4 rotations) — your practitioner varies it across the month.'
      : null,
    languageOk: true,
  };

  // Language self-check over the free text this engine authored.
  const authored = [macroTarget.basis, ...prepNotes, ...sourceNotes, plan.monthlyNote]
    .concat(days.flatMap((d) => d.meals.map((m) => m.note).filter(Boolean)))
    .filter(Boolean).join('  \n  ');
  const lang = gates.languageGate(authored);
  plan.languageOk = lang.ok;
  if (!lang.ok) plan.languageViolations = lang.violations;

  return plan;
}

module.exports = {
  estimateMacroTarget,
  macroForFood,
  generateMealPlan,
  activityFactor,
  goalTune,
};
