INSERT INTO users (id, handle, created_at)
VALUES ('user_seed', 'seed', strftime('%s','now'));

INSERT INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-restaurant-a2',
  'restaurant',
  'A2',
  'ANY',
  'neutral',
  '{"templateId":"tpl-restaurant-a2","topic":"restaurant","level":"A2","seedPrompt":"Bienvenido. Soy tu camarero. Que deseas pedir?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["menu","agua","por favor"],"targetGrammar":["polite_request"]}]}',
  strftime('%s','now')
);

INSERT INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-hotel-a2',
  'hotel',
  'A2',
  'ANY',
  'formal',
  '{"templateId":"tpl-hotel-a2","topic":"hotel","level":"A2","seedPrompt":"Buenas tardes, bienvenido al Hotel Sol. En que puedo ayudarle?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["habitacion","reserva","noche","llave","desayuno"],"targetGrammar":["formal_usted","numbers"]}]}',
  strftime('%s','now')
);

INSERT INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-shopping-b1',
  'shopping',
  'B1',
  'ANY',
  'neutral',
  '{"templateId":"tpl-shopping-b1","topic":"shopping","level":"B1","seedPrompt":"Hola! Buscas algo en particular? Tenemos ofertas especiales hoy.","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["talla","precio","descuento","probador","efectivo","tarjeta"],"targetGrammar":["comparatives","conditionals"]}]}',
  strftime('%s','now')
);

INSERT INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-medical-b1',
  'medical',
  'B1',
  'ANY',
  'formal',
  '{"templateId":"tpl-medical-b1","topic":"medical","level":"B1","seedPrompt":"Buenos dias, soy el doctor Garcia. Cuenteme, que le trae por aqui hoy?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["dolor","sintomas","medicina","receta","cita","fiebre"],"targetGrammar":["present_perfect","body_parts","duration_expressions"]}]}',
  strftime('%s','now')
);

INSERT INTO scenario_templates (id, topic, level, region, register, template_json, created_at)
VALUES (
  'tpl-social-a2',
  'social',
  'A2',
  'ANY',
  'informal',
  '{"templateId":"tpl-social-a2","topic":"social","level":"A2","seedPrompt":"Hola! Que tal? Hace tiempo que no nos vemos. Como has estado?","turnPlan":[{"turnIndex":0,"speakerRole":"A","promptType":"user","objectiveIds":["o1"]}],"roleRubrics":[{"roleId":"A","targetVocab":["bien","mal","trabajo","familia","fin de semana","vacaciones"],"targetGrammar":["informal_tu","preterite_basics","estar_feelings"]}]}',
  strftime('%s','now')
);
