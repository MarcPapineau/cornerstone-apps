'use strict';
/**
 * foods.js — seeded meal + whole-food library for the meal-plan generator.
 *
 * HONESTY: per-serving macros here are CURATED ESTIMATES from standard references, carried
 * so the generator can assemble a usable plan offline. They are LABELLED as estimates
 * (macroSource: 'CURATED_ESTIMATE') everywhere they surface — never presented as precise
 * USDA facts. The registry's first enrichment target is USDA FoodData Central (connectors.js
 * usda_fdc); a food NOT in this seed resolves to SOURCE_PENDING (meals.macroForFood) — its
 * macros are never fabricated. Allergen + dietary-style + flavor + budget tags drive the
 * generator's HARD allergy/dislike exclusion and soft preferences. NOT medical advice.
 *
 * Allergen vocabulary: dairy | gluten | shellfish | fish | eggs | nuts | soy
 * Dietary styles:       omnivore | vegetarian | vegan | pescatarian
 * Slots:                breakfast | lunch | dinner | snack
 */

const MACRO_SOURCE = 'CURATED_ESTIMATE';
const MACRO_PROVENANCE =
  'Approximate per-serving values from standard nutrition references; verify against USDA FoodData Central before clinical use.';

// Each meal: per-serving kcal/protein/carb/fat (grams), allergens it contains, the dietary
// styles it fits, plus flavor/budget/prepMinutes for soft preference. ingredients are real
// whole foods used to build the grocery list + drive dislike exclusion (substring match).
const MEALS = [
  // --- breakfast ---
  { id: 'm_oats_berries_whey', name: 'Steel-cut oats with berries & whey', slot: 'breakfast', kcal: 420, protein: 32, carb: 55, fat: 9, allergens: ['dairy'], dietaryStyles: ['vegetarian', 'omnivore'], flavor: 'simple', budget: 'low', prepMinutes: 10, ingredients: ['Steel-cut oats', 'Mixed berries', 'Whey protein', 'Almond milk'] },
  { id: 'm_tofu_scramble', name: 'Veggie tofu scramble with avocado', slot: 'breakfast', kcal: 380, protein: 24, carb: 20, fat: 24, allergens: ['soy'], dietaryStyles: ['vegan', 'vegetarian', 'omnivore'], flavor: 'moderate', budget: 'low', prepMinutes: 15, ingredients: ['Firm tofu', 'Spinach', 'Bell pepper', 'Avocado', 'Olive oil'] },
  { id: 'm_yogurt_chia_walnut', name: 'Greek yogurt with chia & walnuts', slot: 'breakfast', kcal: 350, protein: 28, carb: 30, fat: 14, allergens: ['dairy', 'nuts'], dietaryStyles: ['vegetarian', 'omnivore'], flavor: 'simple', budget: 'moderate', prepMinutes: 5, ingredients: ['Greek yogurt', 'Chia seeds', 'Walnuts', 'Honey', 'Blueberries'] },
  { id: 'm_eggwhite_omelet', name: 'Egg-white veggie omelet with oats', slot: 'breakfast', kcal: 360, protein: 30, carb: 34, fat: 10, allergens: ['eggs'], dietaryStyles: ['vegetarian', 'omnivore'], flavor: 'moderate', budget: 'low', prepMinutes: 15, ingredients: ['Egg whites', 'Spinach', 'Mushrooms', 'Rolled oats'] },

  // --- lunch ---
  { id: 'm_chicken_quinoa', name: 'Grilled chicken with quinoa & greens', slot: 'lunch', kcal: 480, protein: 42, carb: 40, fat: 16, allergens: [], dietaryStyles: ['omnivore'], flavor: 'moderate', budget: 'moderate', prepMinutes: 20, ingredients: ['Chicken breast', 'Quinoa', 'Mixed greens', 'Olive oil', 'Lemon'] },
  { id: 'm_lentil_rice_bowl', name: 'Lentil & brown rice bowl', slot: 'lunch', kcal: 450, protein: 22, carb: 70, fat: 8, allergens: [], dietaryStyles: ['vegan', 'vegetarian', 'omnivore'], flavor: 'moderate', budget: 'low', prepMinutes: 25, ingredients: ['Lentils', 'Brown rice', 'Carrot', 'Onion', 'Cumin'] },
  { id: 'm_salmon_poke', name: 'Salmon poke bowl', slot: 'lunch', kcal: 500, protein: 38, carb: 45, fat: 18, allergens: ['fish', 'soy'], dietaryStyles: ['pescatarian', 'omnivore'], flavor: 'high', budget: 'moderate', prepMinutes: 15, ingredients: ['Wild salmon', 'Sushi rice', 'Edamame', 'Cucumber', 'Soy sauce'] },
  { id: 'm_shrimp_stirfry', name: 'Shrimp stir-fry with rice', slot: 'lunch', kcal: 470, protein: 36, carb: 52, fat: 10, allergens: ['shellfish', 'soy'], dietaryStyles: ['pescatarian', 'omnivore'], flavor: 'high', budget: 'moderate', prepMinutes: 20, ingredients: ['Shrimp', 'Jasmine rice', 'Broccoli', 'Soy sauce', 'Ginger'] },

  // --- dinner ---
  { id: 'm_chicken_sweetpotato', name: 'Baked chicken, sweet potato & broccoli', slot: 'dinner', kcal: 520, protein: 44, carb: 48, fat: 14, allergens: [], dietaryStyles: ['omnivore'], flavor: 'simple', budget: 'moderate', prepMinutes: 30, ingredients: ['Chicken breast', 'Sweet potato', 'Broccoli', 'Olive oil'] },
  { id: 'm_beef_rice_veg', name: 'Lean beef with jasmine rice & vegetables', slot: 'dinner', kcal: 560, protein: 40, carb: 50, fat: 20, allergens: [], dietaryStyles: ['omnivore'], flavor: 'moderate', budget: 'moderate', prepMinutes: 25, ingredients: ['Lean ground beef', 'Jasmine rice', 'Zucchini', 'Tomato'] },
  { id: 'm_cod_potato_asparagus', name: 'Baked cod with potatoes & asparagus', slot: 'dinner', kcal: 470, protein: 40, carb: 40, fat: 14, allergens: ['fish'], dietaryStyles: ['pescatarian', 'omnivore'], flavor: 'simple', budget: 'moderate', prepMinutes: 30, ingredients: ['Cod', 'Baby potatoes', 'Asparagus', 'Olive oil'] },
  { id: 'm_chickpea_curry', name: 'Chickpea coconut curry with rice', slot: 'dinner', kcal: 520, protein: 18, carb: 72, fat: 18, allergens: [], dietaryStyles: ['vegan', 'vegetarian', 'omnivore'], flavor: 'high', budget: 'low', prepMinutes: 30, ingredients: ['Chickpeas', 'Coconut milk', 'Basmati rice', 'Spinach', 'Curry spices'] },

  // --- snack ---
  { id: 'm_yogurt_honey', name: 'Greek yogurt with honey', slot: 'snack', kcal: 180, protein: 18, carb: 20, fat: 3, allergens: ['dairy'], dietaryStyles: ['vegetarian', 'omnivore'], flavor: 'simple', budget: 'low', prepMinutes: 2, ingredients: ['Greek yogurt', 'Honey'] },
  { id: 'm_apple_almondbutter', name: 'Apple with almond butter', slot: 'snack', kcal: 220, protein: 6, carb: 28, fat: 12, allergens: ['nuts'], dietaryStyles: ['vegan', 'vegetarian', 'omnivore'], flavor: 'simple', budget: 'low', prepMinutes: 2, ingredients: ['Apple', 'Almond butter'] },
  { id: 'm_hummus_carrots', name: 'Hummus with carrots & rice cakes', slot: 'snack', kcal: 210, protein: 7, carb: 30, fat: 8, allergens: [], dietaryStyles: ['vegan', 'vegetarian', 'omnivore'], flavor: 'moderate', budget: 'low', prepMinutes: 5, ingredients: ['Hummus', 'Carrots', 'Rice cakes'] },
  { id: 'm_protein_shake_banana', name: 'Protein shake with banana', slot: 'snack', kcal: 240, protein: 30, carb: 24, fat: 3, allergens: ['dairy'], dietaryStyles: ['vegetarian', 'omnivore'], flavor: 'simple', budget: 'low', prepMinutes: 3, ingredients: ['Whey protein', 'Banana', 'Almond milk'] },
];

// A small whole-food table for the SOURCE_PENDING / grocery-normalization path. Per-serving
// macros, same CURATED_ESTIMATE provenance. A food NOT here → SOURCE_PENDING (never invented).
const FOODS = [
  { name: 'Chicken breast', kcal: 165, protein: 31, carb: 0, fat: 4, allergens: [] },
  { name: 'Wild salmon', kcal: 208, protein: 20, carb: 0, fat: 13, allergens: ['fish'] },
  { name: 'Cod', kcal: 90, protein: 20, carb: 0, fat: 1, allergens: ['fish'] },
  { name: 'Shrimp', kcal: 99, protein: 24, carb: 0, fat: 1, allergens: ['shellfish'] },
  { name: 'Lean ground beef', kcal: 176, protein: 20, carb: 0, fat: 10, allergens: [] },
  { name: 'Firm tofu', kcal: 144, protein: 17, carb: 3, fat: 9, allergens: ['soy'] },
  { name: 'Lentils', kcal: 116, protein: 9, carb: 20, fat: 0.4, allergens: [] },
  { name: 'Chickpeas', kcal: 164, protein: 9, carb: 27, fat: 3, allergens: [] },
  { name: 'Greek yogurt', kcal: 59, protein: 10, carb: 4, fat: 0.4, allergens: ['dairy'] },
  { name: 'Whey protein', kcal: 120, protein: 24, carb: 3, fat: 1.5, allergens: ['dairy'] },
  { name: 'Egg whites', kcal: 52, protein: 11, carb: 0.7, fat: 0.2, allergens: ['eggs'] },
  { name: 'Quinoa', kcal: 120, protein: 4.4, carb: 21, fat: 1.9, allergens: [] },
  { name: 'Brown rice', kcal: 123, protein: 2.7, carb: 26, fat: 1, allergens: [] },
  { name: 'Jasmine rice', kcal: 130, protein: 2.7, carb: 28, fat: 0.3, allergens: [] },
  { name: 'Sweet potato', kcal: 86, protein: 1.6, carb: 20, fat: 0.1, allergens: [] },
  { name: 'Steel-cut oats', kcal: 150, protein: 5, carb: 27, fat: 2.5, allergens: [] },
  { name: 'Almond butter', kcal: 98, protein: 3.4, carb: 3, fat: 9, allergens: ['nuts'] },
  { name: 'Avocado', kcal: 160, protein: 2, carb: 9, fat: 15, allergens: [] },
  { name: 'Broccoli', kcal: 34, protein: 2.8, carb: 7, fat: 0.4, allergens: [] },
  { name: 'Spinach', kcal: 23, protein: 2.9, carb: 3.6, fat: 0.4, allergens: [] },
];

// Allergen / dislike → whole-food alternatives (for the substitutions list). Honest, generic.
const SUBSTITUTIONS = [
  { forTag: 'dairy', alternatives: ['Unsweetened almond or oat milk', 'Coconut yogurt', 'Pea-protein isolate'] },
  { forTag: 'gluten', alternatives: ['Rice', 'Quinoa', 'Certified gluten-free oats', 'Corn tortillas'] },
  { forTag: 'shellfish', alternatives: ['Wild salmon', 'Chicken breast', 'Firm tofu'] },
  { forTag: 'fish', alternatives: ['Chicken breast', 'Lean beef', 'Tempeh'] },
  { forTag: 'eggs', alternatives: ['Tofu scramble', 'Chia "egg"', 'Greek yogurt'] },
  { forTag: 'nuts', alternatives: ['Pumpkin seeds', 'Sunflower-seed butter', 'Roasted chickpeas'] },
  { forTag: 'soy', alternatives: ['Chicken breast', 'Lentils', 'Greek yogurt'] },
];

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const ALLERGENS = ['dairy', 'gluten', 'shellfish', 'fish', 'eggs', 'nuts', 'soy'];
const DIETARY_STYLES = ['omnivore', 'vegetarian', 'vegan', 'pescatarian'];

module.exports = {
  _provenance: { source: 'curated seed (standard references)', macroSource: MACRO_SOURCE, note: MACRO_PROVENANCE },
  MACRO_SOURCE,
  MACRO_PROVENANCE,
  MEALS,
  FOODS,
  SUBSTITUTIONS,
  SLOTS,
  ALLERGENS,
  DIETARY_STYLES,
};
