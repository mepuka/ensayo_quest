/**
 * ScenarioFixtures - Type-safe fixture builders for ScenarioTemplate and related types.
 *
 * Uses Schema.Class directly so compile errors occur if schemas change.
 * @see apps/api/src/domain/ScenarioTemplate.ts
 */
import { ScenarioTemplate } from "../../domain/ScenarioTemplate";
import { TurnPlan } from "../../domain/TurnPlan";
import { RoleRubric } from "../../domain/RoleRubric";

// =============================================================================
// TurnPlan Fixtures
// =============================================================================

const TurnPlanDefaults = {
  turnIndex: 0,
  speakerRole: "A",
  promptType: "user" as const,
  objectiveIds: ["obj-1"]
};

export const TurnPlanFixtures = {
  defaults: TurnPlanDefaults,

  make: (overrides: Partial<typeof TurnPlanDefaults> = {}) =>
    new TurnPlan({ ...TurnPlanDefaults, ...overrides }),

  /** User turn at specified index */
  userTurn: (turnIndex: number, objectiveIds: string[] = ["obj-1"]) =>
    TurnPlanFixtures.make({ turnIndex, promptType: "user", objectiveIds }),

  /** Model (NPC) turn at specified index */
  modelTurn: (turnIndex: number, objectiveIds: string[] = ["obj-1"]) =>
    TurnPlanFixtures.make({ turnIndex, promptType: "model", objectiveIds }),

  /** Standard 4-turn conversation flow: user -> model -> user -> model */
  standardConversation: () => [
    TurnPlanFixtures.userTurn(0, ["greet"]),
    TurnPlanFixtures.modelTurn(1, ["respond"]),
    TurnPlanFixtures.userTurn(2, ["ask"]),
    TurnPlanFixtures.modelTurn(3, ["answer"])
  ]
};

// =============================================================================
// RoleRubric Fixtures
// =============================================================================

const RoleRubricDefaults = {
  roleId: "A",
  targetVocab: ["hola", "gracias"],
  targetGrammar: ["present_tense"]
};

export const RoleRubricFixtures = {
  defaults: RoleRubricDefaults,

  make: (overrides: Partial<typeof RoleRubricDefaults> = {}) =>
    new RoleRubric({ ...RoleRubricDefaults, ...overrides }),

  /** Basic rubric with custom vocab and grammar */
  basic: (roleId: string, targetVocab: string[], targetGrammar: string[] = []) =>
    RoleRubricFixtures.make({ roleId, targetVocab, targetGrammar }),

  /** Travel-themed rubric */
  travel: () =>
    RoleRubricFixtures.make({
      roleId: "A",
      targetVocab: ["billete", "ida", "vuelta", "estación", "tren"],
      targetGrammar: ["querer_present", "poder_present"]
    }),

  /** Food-themed rubric */
  food: () =>
    RoleRubricFixtures.make({
      roleId: "A",
      targetVocab: ["mesa", "menú", "cuenta", "plato", "bebida"],
      targetGrammar: ["tener_present", "pedir_present"]
    }),

  /** Work-themed rubric */
  work: () =>
    RoleRubricFixtures.make({
      roleId: "A",
      targetVocab: ["reunión", "oficina", "proyecto", "equipo", "plazo"],
      targetGrammar: ["estar_present", "trabajar_present"]
    }),

  /** Hobbies-themed rubric */
  hobbies: () =>
    RoleRubricFixtures.make({
      roleId: "A",
      targetVocab: ["tiempo", "libre", "deporte", "música", "película"],
      targetGrammar: ["gustar_present", "preferir_present"]
    })
};

// =============================================================================
// ScenarioTemplate Fixtures
// =============================================================================

const ScenarioDefaults = {
  templateId: "tpl-test",
  topic: "travel",
  level: "A2",
  seedPrompt: "Hola, bienvenido.",
  turnPlan: [] as TurnPlan[],
  roleRubrics: [] as RoleRubric[]
};

export const ScenarioFixtures = {
  defaults: ScenarioDefaults,

  make: (overrides: Partial<typeof ScenarioDefaults> = {}) =>
    new ScenarioTemplate({ ...ScenarioDefaults, ...overrides }),

  // -------------------------------------------------------------------------
  // Level presets by topic
  // -------------------------------------------------------------------------

  /** Travel A1 - Basic station greeting */
  travelA1: () =>
    ScenarioFixtures.make({
      templateId: "tpl-travel-a1",
      topic: "travel",
      level: "A1",
      seedPrompt: "Hola! Bienvenido a la estación de autobuses.",
      turnPlan: [TurnPlanFixtures.userTurn(0, ["greet", "ask-ticket"])],
      roleRubrics: [RoleRubricFixtures.travel()]
    }),

  /** Travel A2 - Buying a ticket */
  travelA2: () =>
    ScenarioFixtures.make({
      templateId: "tpl-travel-a2",
      topic: "travel",
      level: "A2",
      seedPrompt: "Buenos días. ¿En qué puedo ayudarle?",
      turnPlan: TurnPlanFixtures.standardConversation(),
      roleRubrics: [RoleRubricFixtures.travel()]
    }),

  /** Travel B1 - Complex journey planning */
  travelB1: () =>
    ScenarioFixtures.make({
      templateId: "tpl-travel-b1",
      topic: "travel",
      level: "B1",
      seedPrompt:
        "Bienvenido a la agencia de viajes. Tenemos varias opciones para su destino.",
      turnPlan: TurnPlanFixtures.standardConversation(),
      roleRubrics: [RoleRubricFixtures.travel()]
    }),

  /** Travel B2 - Travel problem resolution */
  travelB2: () =>
    ScenarioFixtures.make({
      templateId: "tpl-travel-b2",
      topic: "travel",
      level: "B2",
      seedPrompt:
        "Lamento informarle que su vuelo ha sido cancelado. Permítame revisar las alternativas.",
      turnPlan: TurnPlanFixtures.standardConversation(),
      roleRubrics: [RoleRubricFixtures.travel()]
    }),

  /** Food A1 - Basic restaurant greeting */
  foodA1: () =>
    ScenarioFixtures.make({
      templateId: "tpl-food-a1",
      topic: "food",
      level: "A1",
      seedPrompt: "Hola! Bienvenido al restaurante. ¿Mesa para cuántos?",
      turnPlan: [TurnPlanFixtures.userTurn(0, ["greet", "request-table"])],
      roleRubrics: [RoleRubricFixtures.food()]
    }),

  /** Food A2 - Ordering food */
  foodA2: () =>
    ScenarioFixtures.make({
      templateId: "tpl-food-a2",
      topic: "food",
      level: "A2",
      seedPrompt: "Aquí tiene el menú. ¿Qué le gustaría pedir?",
      turnPlan: TurnPlanFixtures.standardConversation(),
      roleRubrics: [RoleRubricFixtures.food()]
    }),

  /** Work A1 - Basic office introduction */
  workA1: () =>
    ScenarioFixtures.make({
      templateId: "tpl-work-a1",
      topic: "work",
      level: "A1",
      seedPrompt: "Buenos días. Soy su nuevo compañero de trabajo.",
      turnPlan: [TurnPlanFixtures.userTurn(0, ["greet", "introduce"])],
      roleRubrics: [RoleRubricFixtures.work()]
    }),

  /** Work A2 - Simple work discussion */
  workA2: () =>
    ScenarioFixtures.make({
      templateId: "tpl-work-a2",
      topic: "work",
      level: "A2",
      seedPrompt: "Hola! ¿Cómo va el proyecto?",
      turnPlan: TurnPlanFixtures.standardConversation(),
      roleRubrics: [RoleRubricFixtures.work()]
    }),

  /** Hobbies A1 - Basic interests */
  hobbiesA1: () =>
    ScenarioFixtures.make({
      templateId: "tpl-hobbies-a1",
      topic: "hobbies",
      level: "A1",
      seedPrompt: "Hola! ¿Qué te gusta hacer en tu tiempo libre?",
      turnPlan: [TurnPlanFixtures.userTurn(0, ["answer-hobby"])],
      roleRubrics: [RoleRubricFixtures.hobbies()]
    }),

  /** Hobbies A2 - Discussing activities */
  hobbiesA2: () =>
    ScenarioFixtures.make({
      templateId: "tpl-hobbies-a2",
      topic: "hobbies",
      level: "A2",
      seedPrompt: "Me encanta el fútbol. ¿Y a ti, qué deportes te gustan?",
      turnPlan: TurnPlanFixtures.standardConversation(),
      roleRubrics: [RoleRubricFixtures.hobbies()]
    }),

  // -------------------------------------------------------------------------
  // Utility: Get preset by topic and level
  // -------------------------------------------------------------------------

  forTopicLevel: (topic: string, level: string): ScenarioTemplate => {
    const key = `${topic}${level}` as keyof typeof ScenarioFixtures;
    const preset = ScenarioFixtures[key];
    if (typeof preset === "function") {
      return preset() as ScenarioTemplate;
    }
    // Fallback to defaults with the requested topic/level
    return ScenarioFixtures.make({
      templateId: `tpl-${topic}-${level.toLowerCase()}`,
      topic,
      level
    });
  }
};
