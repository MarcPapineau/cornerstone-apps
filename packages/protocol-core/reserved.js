/**
 * reserved.js — RESERVED module slots for the Vitalis Optimization Platform.
 *
 * The platform will add a Nutritional Protocol Generator and a Diet / Meal-Prep
 * Generator that share this same core. Their gates + data models are DEFINED here so
 * the dashboard can reserve clean routes/components now and wire them later WITHOUT a
 * platform rebuild. Like every gate in this core, these never fabricate: an unwired
 * module returns status 'RESERVED' and empty results — it does not invent targets,
 * macros, or plans. Resource/educational only — never medical advice.
 */
const { uid } = require('./models');

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null));
const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

const RESERVED_MODEL_NAMES = [
  'NutritionProfile', 'NutrientTarget', 'MealPlan', 'Recipe', 'GroceryList', 'MacroTarget', 'Substitution',
];

// ===========================================================================
// RESERVED GATES (defined, not wired)
// ===========================================================================

/**
 * nutritionGate — NOW WIRED for the lab → deficiency → naturopath-slip path.
 *
 * Given confirmed lab `values`, it delegates to the real engine (nutrition.js) and returns
 * the "request for your naturopath" slip. With no values, it preserves the original RESERVED
 * contract (empty targets, no invention) so unconfigured callers behave exactly as before.
 * NEVER diagnoses; flags provider review only when a real out-of-range value is present.
 *
 * (Lazy require of ./nutrition avoids a load-time cycle: nutrition.js requires this file
 * for NutrientTarget, so we defer the back-reference until call time.)
 */
function nutritionGate(input = {}) {
  const values = Array.isArray(input.values) ? input.values : [];
  if (!values.length) {
    return {
      module: 'nutrition',
      status: 'RESERVED',
      ok: false,
      message: 'No confirmed lab values supplied — nothing to analyze. (Provide values to generate a naturopath request slip.)',
      usesBloodwork: !!(input && input.labPanelId),
      providerReviewSuggested: false,
      targets: [],
    };
  }
  const nutrition = require('./nutrition');
  const slip = nutrition.analyzeLabForNutrients({
    values,
    role: input.role,
    products: input.products || [],
    clientName: input.clientName || null,
  });
  return {
    module: 'nutrition',
    status: 'ACTIVE',
    ok: true,
    message: null,
    usesBloodwork: !!(input && input.labPanelId) || values.length > 0,
    providerReviewSuggested: slip.providerReviewSuggested,
    slip,
    targets: slip.recommendations.map((r) => r.target),
  };
}

/**
 * dietGate — NOW WIRED. Weekly/monthly meal planning from the diet inputs, allergy/dislike
 * aware. Delegates to the native engine (meals.js); lazy require avoids a load-time cycle.
 * Honest by construction: macros are CURATED_ESTIMATE / SOURCE_PENDING and an unknown calorie
 * target is ESTIMATED / UNKNOWN — never fabricated. Resource only, never a medical claim.
 */
function dietGate(input = {}) {
  const meals = require('./meals');
  const plan = meals.generateMealPlan(input || {});
  return {
    module: 'diet',
    status: 'ACTIVE',
    ok: true,
    message: null,
    periodicity: plan.periodicity,
    plan,
    groceryList: plan.groceryList,
  };
}

// ===========================================================================
// RESERVED DATA MODELS
// ===========================================================================

function NutritionProfile(input = {}) {
  return {
    _model: 'NutritionProfile', _reserved: true,
    id: input.id || uid('nutprofile'),
    clientId: input.clientId || null,
    labPanelId: input.labPanelId || null,          // present === bloodwork-informed (ideal path)
    age: num(input.age), sex: input.sex || null,
    occupation: input.occupation || null,
    lifestyle: input.lifestyle || null,
    goals: arr(input.goals),
    currentProducts: arr(input.currentProducts),    // e.g. current peptide mix
    deficiencies: arr(input.deficiencies),
    trainingStatus: input.trainingStatus || null,
    sleep: input.sleep || null,
    stress: input.stress || null,
    preferences: arr(input.preferences),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function NutrientTarget(input = {}) {
  return {
    _model: 'NutrientTarget', _reserved: true,
    nutrient: input.nutrient || null,
    unit: input.unit || null,
    target: num(input.target),                       // null === not yet determined (never guessed)
    basis: input.basis || null,                      // null === UNKNOWN
    source: input.source || null,                    // e.g. USDA FoodData Central (CC0)
  };
}

function MacroTarget(input = {}) {
  return {
    _model: 'MacroTarget', _reserved: true,
    id: input.id || uid('macro'),
    clientId: input.clientId || null,
    kcal: num(input.kcal), proteinG: num(input.proteinG), carbG: num(input.carbG), fatG: num(input.fatG),
    basis: input.basis || null,
  };
}

function Recipe(input = {}) {
  return {
    _model: 'Recipe', _reserved: true,
    id: input.id || uid('recipe'),
    name: input.name || null,
    ingredients: arr(input.ingredients),
    steps: arr(input.steps),
    macros: input.macros || {},
    allergens: arr(input.allergens),
    cuisine: input.cuisine || null,
    minutes: num(input.minutes),
  };
}

function MealPlan(input = {}) {
  return {
    _model: 'MealPlan', _reserved: true,
    id: input.id || uid('mealplan'),
    clientId: input.clientId || null,
    periodicity: input.periodicity === 'monthly' ? 'monthly' : 'weekly',
    days: arr(input.days),                           // [{ date, meals: [recipeId] }]
    macroTargetId: input.macroTargetId || null,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function GroceryList(input = {}) {
  return {
    _model: 'GroceryList', _reserved: true,
    id: input.id || uid('grocery'),
    mealPlanId: input.mealPlanId || null,
    items: arr(input.items),                         // [{ item, qty, unit }]
  };
}

function Substitution(input = {}) {
  return {
    _model: 'Substitution', _reserved: true,
    forIngredient: input.forIngredient || null,
    alternatives: arr(input.alternatives),
    reason: input.reason || null,                    // e.g. allergy, dislike, budget
  };
}

module.exports = {
  RESERVED_MODEL_NAMES,
  nutritionGate, dietGate,
  NutritionProfile, NutrientTarget, MacroTarget, Recipe, MealPlan, GroceryList, Substitution,
};
