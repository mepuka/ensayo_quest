/**
 * SeedData - Declarative seed data using ScenarioTemplate instances.
 *
 * This replaces the SQL-based seed.sql with type-safe Effect-native definitions.
 * Contains 16 scenarios: 4 topics (travel, food, work, hobbies) × 4 levels (A1-B2).
 *
 * @see apps/api/db/seed.sql - Original SQL seed data (to be deleted)
 */
import { Effect } from "effect";
import { ScenarioTemplate } from "../domain/ScenarioTemplate";
import { TurnPlan } from "../domain/TurnPlan";
import { RoleRubric } from "../domain/RoleRubric";
import { SeedValidationError } from "./SeedError";

/**
 * SeedScenario represents a complete scenario ready for database insertion.
 * Includes template data plus D1 schema fields (region, register).
 */
export interface SeedScenario {
  readonly template: ScenarioTemplate;
  readonly region: "ANY" | "ES" | "MX" | "AR";
  readonly register: "neutral" | "formal" | "informal";
}

// =============================================================================
// Helper: Create a single-turn user scenario
// =============================================================================

const makeScenario = (config: {
  templateId: string;
  topic: string;
  level: string;
  seedPrompt: string;
  targetVocab: string[];
  targetGrammar: string[];
  region?: "ANY" | "ES" | "MX" | "AR";
  register?: "neutral" | "formal" | "informal";
}): SeedScenario => ({
  template: new ScenarioTemplate({
    templateId: config.templateId,
    topic: config.topic,
    level: config.level,
    seedPrompt: config.seedPrompt,
    turnPlan: [
      new TurnPlan({
        turnIndex: 0,
        speakerRole: "A",
        promptType: "user",
        objectiveIds: ["o1"]
      })
    ],
    roleRubrics: [
      new RoleRubric({
        roleId: "A",
        targetVocab: config.targetVocab,
        targetGrammar: config.targetGrammar
      })
    ]
  }),
  region: config.region ?? "ANY",
  register: config.register ?? "neutral"
});

// =============================================================================
// Seed Scenarios - 16 total (4 topics × 4 levels)
// =============================================================================

export const seedScenarios: readonly SeedScenario[] = [
  // -------------------------------------------------------------------------
  // Travel scenarios
  // -------------------------------------------------------------------------
  makeScenario({
    templateId: "tpl-travel-a1",
    topic: "travel",
    level: "A1",
    seedPrompt: "Hola! Bienvenido a la estación de autobuses. A dónde quieres ir?",
    targetVocab: ["billete", "ida", "vuelta", "autobus", "tren"],
    targetGrammar: ["querer_present", "basic_questions"]
  }),
  makeScenario({
    templateId: "tpl-travel-a2",
    topic: "travel",
    level: "A2",
    seedPrompt:
      "Buenos días! Bienvenido al aeropuerto. En qué puedo ayudarle con su viaje?",
    targetVocab: ["vuelo", "equipaje", "pasaporte", "embarque", "llegada", "salida"],
    targetGrammar: ["ir_a_future", "prepositions_place"]
  }),
  makeScenario({
    templateId: "tpl-travel-b1",
    topic: "travel",
    level: "B1",
    seedPrompt:
      "Hola viajero! Cuéntame sobre tu próximo destino. Qué tipo de experiencia buscas?",
    targetVocab: [
      "alojamiento",
      "itinerario",
      "excursión",
      "reserva",
      "temporada",
      "presupuesto"
    ],
    targetGrammar: ["conditional", "subjunctive_wishes"]
  }),
  makeScenario({
    templateId: "tpl-travel-b2",
    topic: "travel",
    level: "B2",
    seedPrompt:
      "Bienvenido a nuestra agencia de viajes premium. Estoy aquí para diseñar su experiencia perfecta. Qué destinos le interesan?",
    targetVocab: [
      "sostenible",
      "auténtico",
      "gastronomía",
      "patrimonio",
      "inmersión",
      "personalizado"
    ],
    targetGrammar: ["subjunctive_emotion", "passive_voice", "complex_conditionals"],
    register: "formal"
  }),

  // -------------------------------------------------------------------------
  // Food scenarios
  // -------------------------------------------------------------------------
  makeScenario({
    templateId: "tpl-food-a1",
    topic: "food",
    level: "A1",
    seedPrompt: "Hola! Qué quieres comer hoy? Tenemos muchas opciones.",
    targetVocab: ["agua", "pan", "carne", "pescado", "verduras", "fruta"],
    targetGrammar: ["querer_present", "articles"]
  }),
  makeScenario({
    templateId: "tpl-food-a2",
    topic: "food",
    level: "A2",
    seedPrompt:
      "Bienvenido a nuestro restaurante! Soy tu camarero. Qué te gustaría pedir hoy?",
    targetVocab: ["menú", "plato", "postre", "cuenta", "propina", "especialidad"],
    targetGrammar: ["gustar_verbs", "polite_conditional"]
  }),
  makeScenario({
    templateId: "tpl-food-b1",
    topic: "food",
    level: "B1",
    seedPrompt:
      "Hola! Soy el chef. Me encanta hablar de cocina. Qué tipo de comida te gusta preparar en casa?",
    targetVocab: ["receta", "ingrediente", "cocinar", "hornear", "sazonar", "mezclar"],
    targetGrammar: ["imperative", "sequencing_words"]
  }),
  makeScenario({
    templateId: "tpl-food-b2",
    topic: "food",
    level: "B2",
    seedPrompt:
      "Bienvenido a nuestra experiencia gastronómica. Como sommelier, me gustaría conocer sus preferencias para recomendar el maridaje perfecto.",
    targetVocab: [
      "maridaje",
      "degustación",
      "textura",
      "aroma",
      "terroir",
      "denominación"
    ],
    targetGrammar: ["subjunctive_opinion", "relative_clauses"],
    register: "formal"
  }),

  // -------------------------------------------------------------------------
  // Work scenarios
  // -------------------------------------------------------------------------
  makeScenario({
    templateId: "tpl-work-a1",
    topic: "work",
    level: "A1",
    seedPrompt: "Hola! Soy tu nuevo compañero de trabajo. Cómo te llamas? Qué haces aquí?",
    targetVocab: ["trabajo", "oficina", "jefe", "reunión", "computadora", "teléfono"],
    targetGrammar: ["ser_estar_basic", "present_tense"]
  }),
  makeScenario({
    templateId: "tpl-work-a2",
    topic: "work",
    level: "A2",
    seedPrompt:
      "Buenos días. Soy el gerente de recursos humanos. Cuénteme sobre su experiencia laboral.",
    targetVocab: [
      "experiencia",
      "estudios",
      "habilidades",
      "disponibilidad",
      "salario",
      "contrato"
    ],
    targetGrammar: ["preterite_basic", "formal_usted"],
    register: "formal"
  }),
  makeScenario({
    templateId: "tpl-work-b1",
    topic: "work",
    level: "B1",
    seedPrompt:
      "Bienvenido a la entrevista. Me gustaría conocer más sobre cómo manejas situaciones difíciles en el trabajo.",
    targetVocab: [
      "proyecto",
      "equipo",
      "plazo",
      "objetivo",
      "rendimiento",
      "colaboración"
    ],
    targetGrammar: ["past_tenses_contrast", "conditional"],
    register: "formal"
  }),
  makeScenario({
    templateId: "tpl-work-b2",
    topic: "work",
    level: "B2",
    seedPrompt:
      "Como director ejecutivo, busco líderes visionarios. Cuénteme sobre un momento en que transformó un desafío en una oportunidad.",
    targetVocab: [
      "estrategia",
      "innovación",
      "liderazgo",
      "stakeholder",
      "escalabilidad",
      "KPI"
    ],
    targetGrammar: ["subjunctive_doubt", "complex_sentences", "passive_se"],
    register: "formal"
  }),

  // -------------------------------------------------------------------------
  // Hobbies scenarios
  // -------------------------------------------------------------------------
  makeScenario({
    templateId: "tpl-hobbies-a1",
    topic: "hobbies",
    level: "A1",
    seedPrompt: "Hola amigo! Qué te gusta hacer en tu tiempo libre?",
    targetVocab: ["música", "deportes", "libros", "películas", "juegos", "cocinar"],
    targetGrammar: ["gustar_basic", "frequency_adverbs"],
    register: "informal"
  }),
  makeScenario({
    templateId: "tpl-hobbies-a2",
    topic: "hobbies",
    level: "A2",
    seedPrompt:
      "Qué tal! Me encanta conocer gente nueva. Cuéntame sobre tus pasatiempos favoritos y por qué te gustan.",
    targetVocab: ["afición", "coleccionar", "practicar", "entrenar", "aprender", "disfrutar"],
    targetGrammar: ["porque_clauses", "comparatives"],
    register: "informal"
  }),
  makeScenario({
    templateId: "tpl-hobbies-b1",
    topic: "hobbies",
    level: "B1",
    seedPrompt:
      "Hola! Soy instructor de actividades. Estoy creando un club de hobbies. Qué actividad te apasiona y cómo empezaste?",
    targetVocab: [
      "dedicación",
      "habilidad",
      "comunidad",
      "competencia",
      "creatividad",
      "relajación"
    ],
    targetGrammar: ["imperfect_preterite", "indirect_speech"],
    register: "informal"
  }),
  makeScenario({
    templateId: "tpl-hobbies-b2",
    topic: "hobbies",
    level: "B2",
    seedPrompt:
      "Como blogger de estilo de vida, entrevisto a personas sobre sus pasiones. Cómo ha influido tu hobby en tu desarrollo personal?",
    targetVocab: [
      "autodisciplina",
      "bienestar",
      "networking",
      "monetizar",
      "equilibrio",
      "autorrealización"
    ],
    targetGrammar: ["subjunctive_adjective_clauses", "perfect_tenses", "hypothetical"],
    register: "informal"
  })
] as const;

// =============================================================================
// Validation
// =============================================================================

/** All topics that must have scenarios */
export const REQUIRED_TOPICS = ["travel", "food", "work", "hobbies"] as const;

/** All levels that must have scenarios */
export const REQUIRED_LEVELS = ["A1", "A2", "B1", "B2"] as const;

/**
 * Validates that seedScenarios covers all required topic/level combinations.
 * Returns Effect that fails with SeedValidationError if any are missing.
 */
export const validateSeedCompleteness = Effect.gen(function* () {
  const expected = REQUIRED_TOPICS.flatMap((topic) =>
    REQUIRED_LEVELS.map((level) => `${topic}-${level}`)
  );
  const actual = seedScenarios.map(
    (s) => `${s.template.topic}-${s.template.level}`
  );
  const missing = expected.filter((e) => !actual.includes(e));

  if (missing.length > 0) {
    return yield* Effect.fail(new SeedValidationError({ missing }));
  }
});
