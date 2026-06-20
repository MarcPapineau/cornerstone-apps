/**
 * @vitalis/protocol-core — the shared LOGIC core for the Vitalis Optimization Platform.
 *
 * Surface-agnostic (no Express, no DOM). Every clinical boundary is a pure gate:
 * source-of-truth → research → compliance → draft → review. The server is authoritative;
 * surfaces ask, they never decide. Sibling of @vitalis/stack-core (the DATA core).
 *
 * Consumed today by My Vitalis Health. Reserved for the embeddable widget,
 * white-label surfaces, and the Nutrition + Diet generator modules.
 *
 * NOT medical advice — research / resource tooling only.
 */
const gates = require('./gates');
const models = require('./models');
const connectors = require('./connectors');
const data = require('./data');
const reserved = require('./reserved');
const generator = require('./generator');
const presentation = require('./presentation');
const nutrition = require('./nutrition');
const packages = require('./packages');
const accounts = require('./accounts');
const addons = require('./addons');
const research = require('./research');
const meals = require('./meals');
const supplements = require('./supplements');
const documentModel = require('./document-model');
const verticalDocumentModel = require('./vertical-document-model');

module.exports = {
  gates,
  models,
  connectors,
  data,
  reserved,
  generator,
  presentation,
  // Nutrition module — the deficiency → "request for your naturopath" engine (wires the
  // reserved Nutrition slot: lab parse + two-source nutrient basis + Dr. Vincent Lun slip).
  nutrition,
  nutrientEvidence: nutrition.NUTRIENT_EVIDENCE,
  // Client Package — the one-click bundle: a gated protocol presented as Protocol + Bloodwork
  // + Nutrition, generated once, approved through the existing gate, opened in the portal.
  packages,
  composeClientPackage: packages.composeClientPackage,
  // Platform layer — onboarding (invitations + self-intake + documents), subscription
  // entitlements, the paid add-on workflow (supplement + meal plans), and the research
  // source registry. All server-authoritative gates; same DRAFT → approve → client-visible spine.
  accounts,
  addons,
  research,
  // Meal + supplement generators (the paid add-on engines behind the Diet / Supplement add-ons).
  meals,
  supplements,
  generateMealPlan: meals.generateMealPlan,
  generateSupplementPlan: supplements.generateSupplementPlan,
  // Vertical-document adapters (Research Source Doctrine labeling) — pure, server-run.
  documentModel,
  toPeptideDocProps: documentModel.toPeptideDocProps,
  // Non-peptide vertical-document adapters (Nutrition / Supplement / Meal / Blood-Requisition) —
  // siblings of toPeptideDocProps; reshape the live engine output onto the SAME dossier schema.
  verticalDocumentModel,
  toNutritionDocProps: verticalDocumentModel.toNutritionDocProps,
  toSupplementDocProps: verticalDocumentModel.toSupplementDocProps,
  toMealDocProps: verticalDocumentModel.toMealDocProps,
  toBloodRequisitionDocProps: verticalDocumentModel.toBloodRequisitionDocProps,
  researchSourceRegistry: research.researchSourceRegistry,
  RESEARCH_SOURCES: research.RESEARCH_SOURCES,
  MODEL_NAMES: models.MODEL_NAMES,
  RESERVED_MODEL_NAMES: reserved.RESERVED_MODEL_NAMES,
  CONNECTORS: connectors.CONNECTORS,
};
