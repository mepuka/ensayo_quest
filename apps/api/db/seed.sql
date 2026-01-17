-- Seed data for Ensayo Quest
-- Topics must match frontend: travel, food, work, hobbies
-- Levels must match frontend: A1, A2, B1, B2

INSERT OR IGNORE INTO users (id, handle, created_at)
VALUES ('user_seed', 'seed', strftime('%s','now'));

-- Travel scenarios
INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-travel-a1',
  'travel',
  'A1',
  'ANY',
  'neutral',
  '{"templateId":"tpl-travel-a1","topic":"travel","level":"A1","seedPrompt":"Hola! Bienvenido a la estación de autobuses. A dónde quieres ir?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["billete","ida","vuelta","autobus","tren"],"targetGrammar":["querer_present","basic_questions"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-travel-a2',
  'travel',
  'A2',
  'ANY',
  'neutral',
  '{"templateId":"tpl-travel-a2","topic":"travel","level":"A2","seedPrompt":"Buenos días! Bienvenido al aeropuerto. En qué puedo ayudarle con su viaje?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["vuelo","equipaje","pasaporte","embarque","llegada","salida"],"targetGrammar":["ir_a_future","prepositions_place"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-travel-b1',
  'travel',
  'B1',
  'ANY',
  'neutral',
  '{"templateId":"tpl-travel-b1","topic":"travel","level":"B1","seedPrompt":"Hola viajero! Cuéntame sobre tu próximo destino. Qué tipo de experiencia buscas?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["alojamiento","itinerario","excursión","reserva","temporada","presupuesto"],"targetGrammar":["conditional","subjunctive_wishes"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-travel-b2',
  'travel',
  'B2',
  'ANY',
  'formal',
  '{"templateId":"tpl-travel-b2","topic":"travel","level":"B2","seedPrompt":"Bienvenido a nuestra agencia de viajes premium. Estoy aquí para diseñar su experiencia perfecta. Qué destinos le interesan?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["sostenible","auténtico","gastronomía","patrimonio","inmersión","personalizado"],"targetGrammar":["subjunctive_emotion","passive_voice","complex_conditionals"]}]}',
  strftime('%s','now')
);

-- Food scenarios
INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-food-a1',
  'food',
  'A1',
  'ANY',
  'neutral',
  '{"templateId":"tpl-food-a1","topic":"food","level":"A1","seedPrompt":"Hola! Qué quieres comer hoy? Tenemos muchas opciones.","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["agua","pan","carne","pescado","verduras","fruta"],"targetGrammar":["querer_present","articles"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-food-a2',
  'food',
  'A2',
  'ANY',
  'neutral',
  '{"templateId":"tpl-food-a2","topic":"food","level":"A2","seedPrompt":"Bienvenido a nuestro restaurante! Soy tu camarero. Qué te gustaría pedir hoy?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["menú","plato","postre","cuenta","propina","especialidad"],"targetGrammar":["gustar_verbs","polite_conditional"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-food-b1',
  'food',
  'B1',
  'ANY',
  'neutral',
  '{"templateId":"tpl-food-b1","topic":"food","level":"B1","seedPrompt":"Hola! Soy el chef. Me encanta hablar de cocina. Qué tipo de comida te gusta preparar en casa?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["receta","ingrediente","cocinar","hornear","sazonar","mezclar"],"targetGrammar":["imperative","sequencing_words"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-food-b2',
  'food',
  'B2',
  'ANY',
  'formal',
  '{"templateId":"tpl-food-b2","topic":"food","level":"B2","seedPrompt":"Bienvenido a nuestra experiencia gastronómica. Como sommelier, me gustaría conocer sus preferencias para recomendar el maridaje perfecto.","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["maridaje","degustación","textura","aroma","terroir","denominación"],"targetGrammar":["subjunctive_opinion","relative_clauses"]}]}',
  strftime('%s','now')
);

-- Work scenarios
INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-work-a1',
  'work',
  'A1',
  'ANY',
  'neutral',
  '{"templateId":"tpl-work-a1","topic":"work","level":"A1","seedPrompt":"Hola! Soy tu nuevo compañero de trabajo. Cómo te llamas? Qué haces aquí?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["trabajo","oficina","jefe","reunión","computadora","teléfono"],"targetGrammar":["ser_estar_basic","present_tense"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-work-a2',
  'work',
  'A2',
  'ANY',
  'formal',
  '{"templateId":"tpl-work-a2","topic":"work","level":"A2","seedPrompt":"Buenos días. Soy el gerente de recursos humanos. Cuénteme sobre su experiencia laboral.","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["experiencia","estudios","habilidades","disponibilidad","salario","contrato"],"targetGrammar":["preterite_basic","formal_usted"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-work-b1',
  'work',
  'B1',
  'ANY',
  'formal',
  '{"templateId":"tpl-work-b1","topic":"work","level":"B1","seedPrompt":"Bienvenido a la entrevista. Me gustaría conocer más sobre cómo manejas situaciones difíciles en el trabajo.","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["proyecto","equipo","plazo","objetivo","rendimiento","colaboración"],"targetGrammar":["past_tenses_contrast","conditional"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-work-b2',
  'work',
  'B2',
  'ANY',
  'formal',
  '{"templateId":"tpl-work-b2","topic":"work","level":"B2","seedPrompt":"Como director ejecutivo, busco líderes visionarios. Cuénteme sobre un momento en que transformó un desafío en una oportunidad.","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["estrategia","innovación","liderazgo","stakeholder","escalabilidad","KPI"],"targetGrammar":["subjunctive_doubt","complex_sentences","passive_se"]}]}',
  strftime('%s','now')
);

-- Hobbies scenarios
INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-hobbies-a1',
  'hobbies',
  'A1',
  'ANY',
  'informal',
  '{"templateId":"tpl-hobbies-a1","topic":"hobbies","level":"A1","seedPrompt":"Hola amigo! Qué te gusta hacer en tu tiempo libre?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["música","deportes","libros","películas","juegos","cocinar"],"targetGrammar":["gustar_basic","frequency_adverbs"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-hobbies-a2',
  'hobbies',
  'A2',
  'ANY',
  'informal',
  '{"templateId":"tpl-hobbies-a2","topic":"hobbies","level":"A2","seedPrompt":"Qué tal! Me encanta conocer gente nueva. Cuéntame sobre tus pasatiempos favoritos y por qué te gustan.","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["afición","coleccionar","practicar","entrenar","aprender","disfrutar"],"targetGrammar":["porque_clauses","comparatives"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-hobbies-b1',
  'hobbies',
  'B1',
  'ANY',
  'informal',
  '{"templateId":"tpl-hobbies-b1","topic":"hobbies","level":"B1","seedPrompt":"Hola! Soy instructor de actividades. Estoy creando un club de hobbies. Qué actividad te apasiona y cómo empezaste?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["dedicación","habilidad","comunidad","competencia","creatividad","relajación"],"targetGrammar":["imperfect_preterite","indirect_speech"]}]}',
  strftime('%s','now')
);

INSERT OR REPLACE INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-hobbies-b2',
  'hobbies',
  'B2',
  'ANY',
  'informal',
  '{"templateId":"tpl-hobbies-b2","topic":"hobbies","level":"B2","seedPrompt":"Como blogger de estilo de vida, entrevisto a personas sobre sus pasiones. Cómo ha influido tu hobby en tu desarrollo personal?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["autodisciplina","bienestar","networking","monetizar","equilibrio","autorrealización"],"targetGrammar":["subjunctive_adjective_clauses","perfect_tenses","hypothetical"]}]}',
  strftime('%s','now')
);
