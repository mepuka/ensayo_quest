Skip to content
Chat history




You said:
Yeah, can you just do deep research flow um a deep research project to look into LM prompting for uh language analysis, um so for audio and um uh and written text you know using LMs to judge quality of uh you know and fluency of uh um audio and and uh audio transcripts and written text um or for audio files and uh their transcripts to understand how LLMs have been successfully used, what the research says about actually uh using them as judges of um quality and accuracy of of um influency of uh um you know of uh um s you know language learners. Um so look into academic sources, industry sources, um, and we really want to get practical examples of of prompting styles, um, approaches and um yeah, just really get a a robust um uh overview of that literature. 
ChatGPT said:
Got it — I’ll dig into how large language models (LLMs) are used to evaluate language quality and fluency in both audio and written contexts. To make sure I focus on the most useful material, could you please clarify a few things:

Target learner level or group: Are you focusing on second-language learners (e.g., ESL students), general language proficiency evaluation, or something else?

Modality priorities: Should I treat audio (spoken language) and written text equally, or prioritize one?

Use cases: Are you most interested in educational feedback, automated grading, peer review, assessment in language learning apps, etc.?

Model types: Should I look only at LLMs like GPT/BERT or include ASR models and hybrid approaches too?

Output preference: Do you want a summary in report format with sections and examples, or a table-heavy comparison format?

Let me know, and I’ll get started right away.

You said:
Looking for all users. We're looking for audio analysis primarily, but also written. Um Yeah. Educa educational feedback, automated grading, um, that type of stuff. Yeah, ASR models, hybrid approaches, um, you know, even something like Google Gemini which has language understanding type things. Um Yeah, I want a hybrid report table summary, um just really focusing on practical uh you know, examples. If you can point to code as well, that would be helpful too. 
ChatGPT said:
Great — I’ll look into how large language models are being used to assess fluency and quality in both spoken and written language, with an emphasis on educational use cases like feedback and automated grading. I’ll include both academic and industry sources, especially examples involving hybrid models (like LLMs combined with ASR), and look for concrete prompting styles, best practices, and code where available.

I’ll return a structured report with tables and summaries of practical applications. Feel free to continue chatting with me while I work on it!

Research completed in 15m · 21 sources · 82 searches
ChatGPT said:
Large Language Models for Evaluating Language Quality in Speech and Writing
Introduction
Advances in large language models (LLMs) are transforming how we evaluate language quality and fluency for both written text and spoken audio. Traditionally, automated language assessment relied on statistical models or task-specific neural networks, but modern LLMs like GPT-4 can analyze grammar, coherence, pronunciation, and more in a holistic way. This deep dive explores current research and practical approaches using LLM prompting to judge the accuracy, fluency, and overall quality of language produced by learners. We summarize academic findings, industry use cases, and effective prompting strategies for leveraging LLMs as “AI judges” of language proficiency.
LLMs in Automated Writing Assessment
LLMs for Essay Scoring: Recent studies show that GPT-based models can perform on par with traditional essay scoring systems. For example, GPT-4 (zero-shot, with no special training) was used to assign holistic proficiency levels to second-language essays and achieved significant correlations with human scores
. Researchers have also probed GPT-4’s ability to provide analytic scoring (rating specific aspects like grammar, vocabulary, etc.) from a single holistic prompt. In one experiment, zero-shot GPT-4 outputs for nine analytic criteria showed meaningful correlation with actual proficiency features, hinting at its potential for detailed feedback
. However, consistency was an early concern – naive prompting led to variable results. A 2025 study found that “ChatGPT, when unprompted or using minimal guidance, produced volatile grades and shifting criteria”, i.e. inconsistent scores for the same essay
. Simply giving the model the instructor’s grading rubric improved stability but did not fully eliminate variability
. Only after rigorous prompt engineering – providing an example-rich rubric, a standardized output format, low-temperature settings (to reduce randomness), and even a post-processing normalization step – did GPT-4 achieve consistent, fair grading comparable to human reliability
. This highlights that LLMs can be stable essay evaluators, but they need well-crafted prompts and controls to align with human standards. Comparison to Human Raters: The literature presents a nuanced picture of LLM scoring quality. On one hand, researchers report GPT models agreeing impressively with human graders in some contexts. For instance, one team noted “substantial agreement between ChatGPT and secondary-level teachers on holistic essay scores,” suggesting GPT could be suitable for low-stakes formative assessment
. On the other hand, studies on English-as-a-foreign-language (EFL) writing found statistically significant divergences between ChatGPT and expert raters
. In particular, GPT sometimes over- or underestimates certain texts, underscoring lingering reliability concerns for high-stakes uses
. Experts generally caution that AI scoring shouldn’t fully replace human assessment yet, but can serve as a supportive tool (e.g. a “second reader”) to increase consistency
. It’s worth noting that fine-tuned models (trained on large graded essay corpora) still yield the strongest agreement with human scores, whereas GPT-based approaches are appealing for being “data-light” (no training needed) but are sensitive to prompt wording and model updates
. The takeaway is that with careful prompt design and validation, LLMs can achieve human-like scoring performance for writing – and they bring the benefit of generating rich feedback in addition to just a score. LLMs for Writing Feedback: Beyond scoring, LLMs have shown exceptional ability to generate formative feedback on writing. An evaluation of GPT-3.5 vs GPT-4 on university student essays found that both models produced feedback that was more readable and consistent than human instructors’ comments
. GPT-4 in particular excelled at covering “effective feedback” components: it gave feed-forward suggestions, noted strengths/weaknesses, and addressed higher-level writing skills better than human tutors
. Perhaps surprisingly, GPT-4 also demonstrated higher reliability in correctly assessing student performance (aligning feedback with the actual quality of the work) compared to GPT-3.5
. These results suggest that with the right prompts, GPT-4 can act as an automated writing coach, providing detailed and pedagogically sound comments. In practice, educators have begun to experiment with using ChatGPT to give students grammar corrections, style improvements, and even grading rationales. One crucial practice is to supply the model with the grading criteria or rubrics so that its feedback is grounded in the expected standards
. For example, instructors can prompt: “You are an English teacher. Provide feedback on the essay below, addressing clarity, grammar, and coherence according to the following rubric: …”. By doing so, the LLM’s output is far more focused and consistent. Indeed, prompt engineering has emerged as key to reliable LLM feedback – e.g. using structured checklists or asking the model to explicitly reason before finalizing feedback can reduce hallucinations and ensure it catches important issues. Case Study – Ensuring Consistency: A research team in Chile systematically studied how to make ChatGPT’s essay grading stable and fair
. They found that instructing GPT-4 with a well-defined rubric (including sample answers for each score level) was critical. They also used chain-of-thought style prompting, asking the model to first list its reasoning (e.g. identify errors, evaluate structure) and then output a grade. Letting the model “think step-by-step” before a verdict improved reliability
. Additionally, they enforced a “decision table” normalization – essentially having GPT-4 map its judgments to a fixed grading table to avoid drifting criteria
. With these methods, the model’s once-random judgments became repeatable: identical answers received consistent scores across multiple runs
. The researchers even automated the prompt generation: they developed an algorithm to create effective rubrics and decision tables for new questions, making the approach scalable
. This case underlines a practical lesson: LLMs can grade essays accurately, but prompt guidelines, examples, and reasoning steps are essential. By investing effort in prompt design (just as one would design a good grading rubric for humans), one can harness LLMs to evaluate writing at scale with reliability approaching human graders.
LLMs for Spoken Language Assessment (Audio)
Using LLMs to evaluate spoken language quality is a newer frontier, but rapid progress is being made. Speaking assessment traditionally combines automatic speech recognition (ASR) (to get a transcript) and analysis of that text plus acoustic features (to judge pronunciation and fluency). In the past, engineered systems (like ETS’s SpeechRater) would extract prosody and grammar features, or end-to-end models would predict scores from audio. Now LLMs offer powerful new ways to assess speech – either by analyzing transcripts via text prompts or by directly processing audio with multi-modal models. Transcript-Based Evaluation: A straightforward approach is a hybrid pipeline: use an ASR model to transcribe the learner’s speech, then prompt an LLM to evaluate that transcript. Despite concerns about ASR errors, research indicates this approach can work remarkably well. A 2025 study on Finnish and Swedish language learners showed that GPT-4-based scoring on ASR transcripts was comparable or superior to a traditional ML scoring model, especially for proficiency levels that had little training data
. In other words, the LLM was better at generalizing to underrepresented skill levels, likely because it leverages broad linguistic knowledge rather than needing many examples of each level. The same study found that giving the LLM a few examples of human-graded responses (few-shot prompting) significantly improved its accuracy as a grader
. Multiple example demos > single demo > zero examples, in terms of performance gain
. This mirrors the benefit of examples seen in essay scoring. Importantly, they confirmed that using automatic transcripts in place of human-transcribed text “does not compromise assessment quality”
. So even if the ASR isn’t perfect, the GPT model can often see through minor transcription errors and still judge fluency and content effectively. This finding is encouraging: it means we can build speech assessment systems without expensive manual transcription – for instance, using an off-the-shelf ASR like Whisper, then an LLM to score. In practice, one might prompt GPT-4 with something like: “Here is a transcript of a learner’s speech response. Evaluate it on pronunciation, fluency, grammatical accuracy, and coherence on a scale from 1 (beginner) to 6 (advanced), and provide a brief rationale.” The LLM will then output an estimated level with an explanation, mimicking what a human examiner might do. Direct Multimodal LLMs: Even more exciting is the emergence of speech-capable LLMs that can take audio input natively, without a separate ASR step. For example, Google’s new Gemini model is multimodal and “can analyze and understand audio input and generate text responses”, handling tasks like transcription, translation, speaker diarization, and summarization from audio
. While primarily advertised for things like meeting summaries or voice commands, such an API could theoretically be prompted to evaluate a spoken response. A developer can feed an audio file plus a prompt like “Evaluate the speaker’s English proficiency and fluency, and point out any notable errors,” and the model will leverage its built-in speech recognition to respond. Another line of research has produced models like SALMONN (Speech Audio Language Music Open Neural Network), which integrates a Whisper speech encoder and a text LLM (Vicuna) to give the model “ears.” SALMONN can “perceive and understand all kinds of audio inputs”, demonstrating cognitive audio understanding beyond simple speech-to-text
. Essentially, it’s a large language model that directly listens to audio and responds with text. These multimodal LLMs are still under active development (often requiring large GPUs to run), but they have achieved impressive results on benchmarks – e.g. answering spoken questions, describing audio events, and yes, even scoring pronunciation. Researchers at Cambridge built a custom speech-LLM that outperformed all prior systems on two spoken English proficiency datasets
. Their model, based on a pre-trained speech encoder fused with an LLM, could assess holistic speaking proficiency (pronunciation, fluency, grammar, etc.) better than both traditional pipelines and prior end-to-end models
. This represents a state-of-the-art approach: the LLM “hears” the response and uses its internal knowledge of language patterns to judge quality. An example prompt they used was to list descriptions of proficiency levels (from the CEFR scale A1 through C2) and ask the model to choose the best fitting level for the audio
. By including detailed level descriptors (e.g. “Option A: can produce clear, smoothly flowing, well-structured discourse…” down to “Option F: can produce simple phrases about basic topics”), the LLM could map the spoken performance to a score reliably
. Notably, this speech-aware LLM retained sensitivity to acoustic features like pronunciation and speech rate (thanks to the audio encoder), while also evaluating content and grammar (thanks to the language model)
. This combined capability addresses a long-standing challenge: earlier systems often had to choose between focusing on audio (pronunciation) or content, but LLMs can potentially do both at once
. In summary, we now have proof-of-concept that LLMs can directly grade spoken language with high accuracy. As these models become more accessible, we expect to see practical tools for automated speech evaluation that simply take a student’s recording and return an immediate assessment. Spoken Feedback: Similar to writing feedback, LLMs can also give constructive feedback on speaking. For instance, an LLM could highlight that “the speaker’s pronunciation of ‘r’ sound was unclear” or “there were pauses indicating hesitation, affecting fluency”, and suggest improvements. There is emerging research on prompting GPT-4 to act as a speaking coach – e.g. by feeding it a transcript and asking for feedback on pronunciation and word choice. Initial reports are positive: one study limited to pronunciation scoring found a finetuned speech-transformer + GPT model was competitive in scoring how well words were pronounced
. Holistic feedback (covering coherence and content) is a harder task, but LLMs’ strength in generating text could be very handy. We might soon see language learning apps where you speak a few sentences, and the AI (powered by an LLM) responds with both a score and specific tips: “Try to speak a bit more slowly to improve clarity, and watch the tense in your sentences – I noticed ‘I go yesterday’ should be ‘I went yesterday’.” This kind of detailed, instant feedback on spoken language would be a game-changer for learners without access to human tutors.
Effective Prompting Strategies for Quality Evaluation
Designing the right prompts is vital to get useful and trustworthy evaluations from LLMs. Here are some proven prompting strategies from research and practice:
Provide Clear Rubrics and Criteria: Always instruct the LLM what aspects of quality to judge and how. For example, you might say: “Evaluate the answer for grammatical accuracy, vocabulary usage, and fluency on a 5-point scale. An ideal response has no grammar errors, uses varied vocabulary, and flows naturally.” Studies showed that including the instructor’s grading rubric in the prompt greatly reduced variability in GPT’s scoring
. The model then understands the standards it should apply, much like a human grader with a rubric.
Give Examples (Few-Shot Prompting): Supplying a few examples of student answers and the desired evaluation for each can calibrate the model. In one paper, showing GPT-4 multiple examples of spoken responses with their human scores significantly improved its grading accuracy
. These examples can be included in the prompt as: “Example 1: (Student response)… – this would score B2 (upper intermediate) because …; Example 2: …” followed by “Now evaluate the following new response: …”. The LLM will pattern-match and produce a similar evaluation for the new input.
Chain-of-Thought Reasoning: Instead of asking the model to directly output a score or decision, ask it to reason step-by-step first. For instance: “Analyze the text for grammar errors and fluency issues. List them, then decide on a score.” This was recommended by OpenAI for model-based grading – “First reason step by step, then answer yes or no” or give a score
. By having the LLM articulate its reasoning (which you can choose to show or keep hidden), you encourage a more systematic evaluation and can catch if it goes off-track. Researchers note that chain-of-thought prompting yields more reliable outcomes on complex tasks
. Some have even combined this with a self-consistency approach: run the chain-of-thought multiple times and take the most common result, smoothing out randomness
.
Structured Output Formats: To ensure the model covers all aspects and is easy to parse, you can request outputs in a structured form. For example, “Give your feedback in JSON: { \"grammar\": <score>, \"fluency\": <score>, \"comments\": \"...\" }.” Google’s Gemini API documentation shows how one can prompt for structured JSON output containing transcriptions, timestamps, and even emotion tags from audio
. Likewise, for scoring, a structured format can make the evaluation more consistent and machine-checkable. If the model knows it must fill in specific fields (grammar, vocabulary, etc.), it’s less likely to wander off-topic. This method was implicitly used in some research: e.g., asking GPT-4 to output exactly the letter A/B/C corresponding to proficiency levels
 or to produce a table of analytic scores
. The constraint of format guides the model to stick to the requested evaluation criteria.
Temperature and Determinism: In generation settings, temperature controls randomness. When using LLMs for assessment, it’s usually best to set a low temperature (e.g. 0 or 0.2) for deterministic output. This avoids the model giving different scores each time due to creative variance. Several studies explicitly fixed a low temperature to get stable results
. Additionally, using the latest, most capable model (e.g. GPT-4 rather than GPT-3.5) for grading is recommended, as research by OpenAI found “model grading works best with the most powerful models”
 and ideally use a separate instance/model from the one that generated the answer to avoid self-bias
.
By combining these strategies – clear rubrics, examples, reasoning steps, structured outputs, and stable settings – practitioners have devised effective prompting “recipes” for language analysis. In fact, Google Cloud’s documentation on Gemini provides prompting recipes for audio, including using a system message to set instructions and dividing the prompt into parts (user query vs. file content)
. This kind of prompt templating is becoming a standard: one part of the prompt might contain the criteria and format, and another part contains the student’s content to evaluate. With well-crafted prompts, LLMs can reliably perform complex evaluations – essentially following a script or checklist provided by the prompter.
Real-World Applications and Examples
The use of LLMs for language assessment is not just in research – it’s already finding its way into educational technology products:
Duolingo Max (AI-Powered Learning): The language-learning app Duolingo integrated GPT-4 to create two features: “Role Play,” where learners converse with an AI partner, and “Explain My Answer,” which gives users instant, personalized feedback on their answers
. When a learner makes a mistake in an exercise, they can tap “Explain My Answer” and GPT-4 will “break down the grammar rules” and explain why the mistake happened
. This feature essentially turns GPT-4 into an on-demand language tutor, analyzing a user’s sentence and providing a clear explanation of any errors. According to Duolingo’s engineers, GPT-4’s reliability in understanding the specific error and its cause finally gave them confidence to automate this feedback – something that wasn’t accurate enough with GPT-3
. “GPT-4 gives us far more confidence in the accuracy of AI responses in Explain My Answer,” noted Duolingo’s lead engineer
. In practice, this means millions of learners can get immediate, context-specific explanations (in simple terms) for their mistakes, rather than a generic “wrong” or a pre-written tip. It’s a prime example of using an LLM to analyze a learner’s language output and respond with helpful guidance. Early user feedback suggests these GPT-4 powered explanations feel personalized and clear, helping learners understand complex grammar in a conversational way. Duolingo’s use case highlights that LLMs can be deployed at scale to improve language learning outcomes – here the prompt engineering was handled by Duolingo (with safety nets to avoid misinformation), and learners benefit from high-quality automated feedback.
Automated Language Tests: The Duolingo English Test (DET), a standardized test of English proficiency, has also leveraged AI for scoring speaking and writing for years. While details of their scoring engine aren’t public, it’s known that AI enables quick, reliable scoring of test-taker responses. With the advent of GPT-4, it’s plausible that such testing platforms are experimenting with LLMs to enhance scoring explanations or check the consistency of scores. Similarly, educational companies are exploring GPT-4 for scoring open-ended assessment questions. For instance, platforms that assign speaking tasks (like describing a picture or answering an interview question) can use an ASR + GPT pipeline to instantly score and give feedback to the user. This provides immediate remediation: a test-taker could be told “Your response is a bit off-topic; try to address the question more directly,” or “To reach a higher score, you might use more advanced vocabulary or complex sentences.” Such targeted tips were difficult to generate with older rule-based systems, but come naturally to an LLM that can both grade and explain in fluent language.
Classroom Writing Assistants: Teachers have begun using LLMs like ChatGPT or Claude to assist in grading and providing feedback on student essays. For example, a teacher can copy a student’s essay into ChatGPT and prompt: “Grade this essay on a scale of 1–10 based on the attached rubric, and provide three points of feedback: one on content, one on organization, one on grammar.” The LLM will then output a tentative grade with the requested comments. Of course, teachers must review and calibrate this output, but it dramatically speeds up the grading process and ensures no major issue is overlooked (the AI might catch an error the teacher missed, and vice versa). There are reports of high consistency when the same essay is run through an LLM with a fixed prompt, which is promising for fairness (every student is judged by the same criteria without human fatigue or bias). However, as noted earlier, one must be careful to stabilize the prompt and settings – even the time of day or slight wording changes could alter an AI’s grading if not locked down. Some educators are creating a shared prompt template as a “grading assistant” and sticking to it for all papers, treating the AI’s output as a second opinion to complement their own judgment.
OpenAI’s Evaluation Framework: Even OpenAI uses LLMs to evaluate language outputs – in this case, to grade AI-generated answers. They released OpenAI Evals, which includes model-based graders where GPT-4 is asked to judge the correctness or quality of another model’s response
. These graders use prompts like “Here is a question, and here is the model’s answer. Evaluate if the answer is correct and complete. Think step by step and then output a single word: correct or incorrect.” This scenario is akin to scoring short answers or explanations, demonstrating that LLMs can reliably apply a rubric to complex content if instructed to “reason before judging”
. OpenAI found that grader prompts with an explicit reasoning step significantly improved accuracy in identifying flaws in answers
. This approach is very relevant to language learner outputs: the AI grader could be checking if an explanation is logically coherent, if a translation is accurate, or if a spoken response actually answered the question. It’s essentially using an LLM as a meta-evaluator of language.
Research Prototypes and Tools: The rapid progress in this field means new tools are emerging. For instance, an experimental system might combine Whisper (ASR) with GPT-4 to allow English learners to practice speaking: the learner speaks, Whisper transcribes it, GPT-4 evaluates and gives feedback – all in a matter of seconds. Similarly, start-ups are looking into AI-powered writing mentors that not only correct grammar (like Grammarly) but also score your writing on traits (clarity, tone, creativity) using LLM prompts. Open-source projects like the SALMONN model
 provide a foundation for developers to build custom speech-analysis LLMs that could be fine-tuned for specific evaluation tasks (say, assessing pronunciation for language learners or evaluating presentations for public speaking classes). In the table below, we highlight a few concrete examples of LLM-based prompting approaches for language analysis:
Application	LLM Approach & Prompting	Outcome / Findings	Source
Holistic Essay Scoring (English L2 writing)	GPT-4 prompted with holistic proficiency descriptors (zero-shot). Prompt: “Read the essay and give an overall CEFR level (A1–C2) based on fluency, coherence, accuracy.”	GPT-4’s holistic scores showed strong correlation with human ratings. Some studies report GPT scoring matching teachers for holistic levels
, though others saw gaps for non-native essays
. With rubric guidance, consistency approached human graders
.	Holistic correlation: 
;
Prompt engineering for consistency: 
.
Analytic Writing Assessment (specific skills)	GPT-4 used in zero-shot to predict multiple trait scores (e.g. grammar, vocab, organization) from one prompt. No fine-tuning, just instructing the model to “score 1–5 on each trait and justify briefly.”	Without training, GPT-4 could produce sensible analytic scores – these showed significant correlation with actual proficiency features for each category
. Indicates LLMs can evaluate distinct aspects of writing in one go, though absolute accuracy may be lower than holistic.	BEA 2024 study (Bannò et al.): GPT-4 analytic scores vs features
.
Writing Feedback Generation	GPT-4 (and 3.5) prompted as a “writing tutor,” given a student’s text and asked to provide feedback per a rubric (covering content, style, and suggestions). E.g. “Provide feedback mentioning at least one positive and one area to improve, focusing on argument strength and grammar.”	GPT-4’s feedback was more readable and comprehensive than human instructors’, covering key feedback dimensions (feed-forward tips, self-regulation advice) significantly better
. Both GPT-3.5 and 4 were also more consistent in tone. GPT-4’s feedback reliability (accuracy of critique) was higher than GPT-3.5’s
.	Study on AI feedback (Dai et al. 2024): GPT vs instructor feedback
.
Spoken Response Scoring (English speaking test)	GPT-4 API in a pipeline: audio → ASR (transcript) → GPT-4 prompt. Prompt included examples of answers at different scores (few-shot) and asked GPT-4 to score the new transcript on a proficiency scale with reasoning.	GPT-4 scoring on ASR transcripts was on par or better than a trained ML model for low-resource proficiency levels
. Using few-shot examples of graded responses significantly improved GPT’s grading accuracy
. Importantly, ASR errors did not ruin the assessment – performance using automatic vs human transcripts was equivalent
. This validates the ASR+LLM pipeline for speech.	Finnish/Swedish L2 study (Voskoboinik et al. 2025): LLM scoring vs ML model
; Few-shot improves accuracy
.
Multimodal LLM – Direct Speech Grader	Speech-LLMs (e.g. custom GPT-4 with audio input, SALMONN 13B). Model is given the raw audio and a prompt like “Transcribe and evaluate the speaker’s French proficiency (pronunciation, fluency, accuracy) on a 10-point scale.” The model internally processes audio+text.	Early results show state-of-the-art performance. A Cambridge model combining a speech encoder with an LLM outperformed prior systems on holistic speaking scores
. These models capture pronunciation and prosody from audio plus coherence from text. They can directly output a score or assessment text from audio. This approach, while computationally heavy, eliminates the separate ASR step and can leverage acoustic nuances (intonation, pace) in scoring.	Cambridge study (Rao et al. 2025): Speech-LLM vs baselines
. SALMONN model card: “LLM with hearing abilities”
.
Duolingo “Explain My Answer” (Grammar correction)	GPT-4 integrated via API with a custom prompt per exercise. When a learner’s answer is wrong, Duolingo sends GPT-4 the question, the user’s answer, and the correct answer, with a prompt to explain the mistake and relevant grammar rule in simple terms.	Delivered instant, personalized explanations to learners. GPT-4 can pinpoint the learner’s error and articulate the rule (e.g. “You used ‘estaba’ but needed ‘estuve’ because this is a completed action in the past.”). Duolingo reports that GPT-4’s accuracy and clarity in these explanations met their quality bar, whereas GPT-3 sometimes gave confusing or incorrect explanations
. This feature helps users learn from mistakes on the spot, filling a crucial gap in language apps (which often lacked deep grammar feedback).	OpenAI–Duolingo case study: GPT-4 for Roleplay & Explain
.
(Table: Examples of how LLM prompting is applied to evaluate or give feedback on language in various contexts, with key outcomes.)
Conclusion
Large language models have rapidly become powerful tools for language analysis – not just in understanding or generating language, but in evaluating it. In writing assessment, LLMs like GPT-4 have demonstrated they can score essays nearly as well as human experts and provide detailed feedback that outshines traditional automated graders. In speaking assessment, LLM-based approaches (whether via transcripts or direct speech-enabled models) are reaching new heights of accuracy, offering a scalable solution to evaluate spoken language skills for learners. The key to these successes lies in clever prompting and system design: by imbuing the model with our evaluation criteria (rubrics, examples, reasoning steps), we guide its vast linguistic knowledge toward making reliable judgments on quality and fluency. From academic research to real-world apps, the evidence is clear that LLMs can serve as effective “judges” of language proficiency. They can flag errors, rate fluency, assess coherence, and even suggest improvements – often in real time. This opens up exciting possibilities: imagine personalized language tutors that not only converse with learners but also continuously assess and coach them, or automated exam scoring that provides individualized feedback to each test-taker. We are already seeing the first steps, as in Duolingo’s GPT-4 features and other pilot programs. Of course, challenges remain in ensuring fairness (avoiding biases), maintaining consistency, and aligning AI’s judgments with pedagogical goals. Ongoing research into prompt engineering and model fine-tuning for evaluation tasks will further improve reliability. In summary, LLM prompting for language quality analysis is a burgeoning field blending NLP and education. It has yielded promising techniques and results for both written and spoken language assessment. By leveraging these advances, educators and developers can create tools that give learners instant, informative feedback – ultimately helping users to write and speak more fluently and accurately. The convergence of ASR technology with LLM intelligence, exemplified by systems like Gemini and SALMONN, suggests a future where an AI can listen to a student speaking, understand the response like a human teacher, and provide an evaluation or correction on the fly. The literature so far paints an optimistic picture that with the right approaches, large language models can greatly enhance how we measure and improve language proficiency
. The next few years will likely bring these research insights into widely available practical tools, making language learning more guided and personalized through AI.






Sources



No file chosenNo file chosen
ChatGPT can make mistakes. Check important info.

Large Language Models for Evaluating Language Quality in Speech and Writing
Introduction
Advances in large language models (LLMs) are transforming how we evaluate language quality and fluency for both written text and spoken audio. Traditionally, automated language assessment relied on statistical models or task-specific neural networks, but modern LLMs like GPT-4 can analyze grammar, coherence, pronunciation, and more in a holistic way. This deep dive explores current research and practical approaches using LLM prompting to judge the accuracy, fluency, and overall quality of language produced by learners. We summarize academic findings, industry use cases, and effective prompting strategies for leveraging LLMs as “AI judges” of language proficiency.
LLMs in Automated Writing Assessment
LLMs for Essay Scoring: Recent studies show that GPT-based models can perform on par with traditional essay scoring systems. For example, GPT-4 (zero-shot, with no special training) was used to assign holistic proficiency levels to second-language essays and achieved significant correlations with human scores
. Researchers have also probed GPT-4’s ability to provide analytic scoring (rating specific aspects like grammar, vocabulary, etc.) from a single holistic prompt. In one experiment, zero-shot GPT-4 outputs for nine analytic criteria showed meaningful correlation with actual proficiency features, hinting at its potential for detailed feedback
. However, consistency was an early concern – naive prompting led to variable results. A 2025 study found that “ChatGPT, when unprompted or using minimal guidance, produced volatile grades and shifting criteria”, i.e. inconsistent scores for the same essay
. Simply giving the model the instructor’s grading rubric improved stability but did not fully eliminate variability
. Only after rigorous prompt engineering – providing an example-rich rubric, a standardized output format, low-temperature settings (to reduce randomness), and even a post-processing normalization step – did GPT-4 achieve consistent, fair grading comparable to human reliability
. This highlights that LLMs can be stable essay evaluators, but they need well-crafted prompts and controls to align with human standards. Comparison to Human Raters: The literature presents a nuanced picture of LLM scoring quality. On one hand, researchers report GPT models agreeing impressively with human graders in some contexts. For instance, one team noted “substantial agreement between ChatGPT and secondary-level teachers on holistic essay scores,” suggesting GPT could be suitable for low-stakes formative assessment
. On the other hand, studies on English-as-a-foreign-language (EFL) writing found statistically significant divergences between ChatGPT and expert raters
. In particular, GPT sometimes over- or underestimates certain texts, underscoring lingering reliability concerns for high-stakes uses
. Experts generally caution that AI scoring shouldn’t fully replace human assessment yet, but can serve as a supportive tool (e.g. a “second reader”) to increase consistency
. It’s worth noting that fine-tuned models (trained on large graded essay corpora) still yield the strongest agreement with human scores, whereas GPT-based approaches are appealing for being “data-light” (no training needed) but are sensitive to prompt wording and model updates
. The takeaway is that with careful prompt design and validation, LLMs can achieve human-like scoring performance for writing – and they bring the benefit of generating rich feedback in addition to just a score. LLMs for Writing Feedback: Beyond scoring, LLMs have shown exceptional ability to generate formative feedback on writing. An evaluation of GPT-3.5 vs GPT-4 on university student essays found that both models produced feedback that was more readable and consistent than human instructors’ comments
. GPT-4 in particular excelled at covering “effective feedback” components: it gave feed-forward suggestions, noted strengths/weaknesses, and addressed higher-level writing skills better than human tutors
. Perhaps surprisingly, GPT-4 also demonstrated higher reliability in correctly assessing student performance (aligning feedback with the actual quality of the work) compared to GPT-3.5
. These results suggest that with the right prompts, GPT-4 can act as an automated writing coach, providing detailed and pedagogically sound comments. In practice, educators have begun to experiment with using ChatGPT to give students grammar corrections, style improvements, and even grading rationales. One crucial practice is to supply the model with the grading criteria or rubrics so that its feedback is grounded in the expected standards
. For example, instructors can prompt: “You are an English teacher. Provide feedback on the essay below, addressing clarity, grammar, and coherence according to the following rubric: …”. By doing so, the LLM’s output is far more focused and consistent. Indeed, prompt engineering has emerged as key to reliable LLM feedback – e.g. using structured checklists or asking the model to explicitly reason before finalizing feedback can reduce hallucinations and ensure it catches important issues. Case Study – Ensuring Consistency: A research team in Chile systematically studied how to make ChatGPT’s essay grading stable and fair
. They found that instructing GPT-4 with a well-defined rubric (including sample answers for each score level) was critical. They also used chain-of-thought style prompting, asking the model to first list its reasoning (e.g. identify errors, evaluate structure) and then output a grade. Letting the model “think step-by-step” before a verdict improved reliability
. Additionally, they enforced a “decision table” normalization – essentially having GPT-4 map its judgments to a fixed grading table to avoid drifting criteria
. With these methods, the model’s once-random judgments became repeatable: identical answers received consistent scores across multiple runs
. The researchers even automated the prompt generation: they developed an algorithm to create effective rubrics and decision tables for new questions, making the approach scalable
. This case underlines a practical lesson: LLMs can grade essays accurately, but prompt guidelines, examples, and reasoning steps are essential. By investing effort in prompt design (just as one would design a good grading rubric for humans), one can harness LLMs to evaluate writing at scale with reliability approaching human graders.
LLMs for Spoken Language Assessment (Audio)
Using LLMs to evaluate spoken language quality is a newer frontier, but rapid progress is being made. Speaking assessment traditionally combines automatic speech recognition (ASR) (to get a transcript) and analysis of that text plus acoustic features (to judge pronunciation and fluency). In the past, engineered systems (like ETS’s SpeechRater) would extract prosody and grammar features, or end-to-end models would predict scores from audio. Now LLMs offer powerful new ways to assess speech – either by analyzing transcripts via text prompts or by directly processing audio with multi-modal models. Transcript-Based Evaluation: A straightforward approach is a hybrid pipeline: use an ASR model to transcribe the learner’s speech, then prompt an LLM to evaluate that transcript. Despite concerns about ASR errors, research indicates this approach can work remarkably well. A 2025 study on Finnish and Swedish language learners showed that GPT-4-based scoring on ASR transcripts was comparable or superior to a traditional ML scoring model, especially for proficiency levels that had little training data
. In other words, the LLM was better at generalizing to underrepresented skill levels, likely because it leverages broad linguistic knowledge rather than needing many examples of each level. The same study found that giving the LLM a few examples of human-graded responses (few-shot prompting) significantly improved its accuracy as a grader
. Multiple example demos > single demo > zero examples, in terms of performance gain
. This mirrors the benefit of examples seen in essay scoring. Importantly, they confirmed that using automatic transcripts in place of human-transcribed text “does not compromise assessment quality”
. So even if the ASR isn’t perfect, the GPT model can often see through minor transcription errors and still judge fluency and content effectively. This finding is encouraging: it means we can build speech assessment systems without expensive manual transcription – for instance, using an off-the-shelf ASR like Whisper, then an LLM to score. In practice, one might prompt GPT-4 with something like: “Here is a transcript of a learner’s speech response. Evaluate it on pronunciation, fluency, grammatical accuracy, and coherence on a scale from 1 (beginner) to 6 (advanced), and provide a brief rationale.” The LLM will then output an estimated level with an explanation, mimicking what a human examiner might do. Direct Multimodal LLMs: Even more exciting is the emergence of speech-capable LLMs that can take audio input natively, without a separate ASR step. For example, Google’s new Gemini model is multimodal and “can analyze and understand audio input and generate text responses”, handling tasks like transcription, translation, speaker diarization, and summarization from audio
. While primarily advertised for things like meeting summaries or voice commands, such an API could theoretically be prompted to evaluate a spoken response. A developer can feed an audio file plus a prompt like “Evaluate the speaker’s English proficiency and fluency, and point out any notable errors,” and the model will leverage its built-in speech recognition to respond. Another line of research has produced models like SALMONN (Speech Audio Language Music Open Neural Network), which integrates a Whisper speech encoder and a text LLM (Vicuna) to give the model “ears.” SALMONN can “perceive and understand all kinds of audio inputs”, demonstrating cognitive audio understanding beyond simple speech-to-text
. Essentially, it’s a large language model that directly listens to audio and responds with text. These multimodal LLMs are still under active development (often requiring large GPUs to run), but they have achieved impressive results on benchmarks – e.g. answering spoken questions, describing audio events, and yes, even scoring pronunciation. Researchers at Cambridge built a custom speech-LLM that outperformed all prior systems on two spoken English proficiency datasets
. Their model, based on a pre-trained speech encoder fused with an LLM, could assess holistic speaking proficiency (pronunciation, fluency, grammar, etc.) better than both traditional pipelines and prior end-to-end models
. This represents a state-of-the-art approach: the LLM “hears” the response and uses its internal knowledge of language patterns to judge quality. An example prompt they used was to list descriptions of proficiency levels (from the CEFR scale A1 through C2) and ask the model to choose the best fitting level for the audio
. By including detailed level descriptors (e.g. “Option A: can produce clear, smoothly flowing, well-structured discourse…” down to “Option F: can produce simple phrases about basic topics”), the LLM could map the spoken performance to a score reliably
. Notably, this speech-aware LLM retained sensitivity to acoustic features like pronunciation and speech rate (thanks to the audio encoder), while also evaluating content and grammar (thanks to the language model)
. This combined capability addresses a long-standing challenge: earlier systems often had to choose between focusing on audio (pronunciation) or content, but LLMs can potentially do both at once
. In summary, we now have proof-of-concept that LLMs can directly grade spoken language with high accuracy. As these models become more accessible, we expect to see practical tools for automated speech evaluation that simply take a student’s recording and return an immediate assessment. Spoken Feedback: Similar to writing feedback, LLMs can also give constructive feedback on speaking. For instance, an LLM could highlight that “the speaker’s pronunciation of ‘r’ sound was unclear” or “there were pauses indicating hesitation, affecting fluency”, and suggest improvements. There is emerging research on prompting GPT-4 to act as a speaking coach – e.g. by feeding it a transcript and asking for feedback on pronunciation and word choice. Initial reports are positive: one study limited to pronunciation scoring found a finetuned speech-transformer + GPT model was competitive in scoring how well words were pronounced
. Holistic feedback (covering coherence and content) is a harder task, but LLMs’ strength in generating text could be very handy. We might soon see language learning apps where you speak a few sentences, and the AI (powered by an LLM) responds with both a score and specific tips: “Try to speak a bit more slowly to improve clarity, and watch the tense in your sentences – I noticed ‘I go yesterday’ should be ‘I went yesterday’.” This kind of detailed, instant feedback on spoken language would be a game-changer for learners without access to human tutors.
Effective Prompting Strategies for Quality Evaluation
Designing the right prompts is vital to get useful and trustworthy evaluations from LLMs. Here are some proven prompting strategies from research and practice:
Provide Clear Rubrics and Criteria: Always instruct the LLM what aspects of quality to judge and how. For example, you might say: “Evaluate the answer for grammatical accuracy, vocabulary usage, and fluency on a 5-point scale. An ideal response has no grammar errors, uses varied vocabulary, and flows naturally.” Studies showed that including the instructor’s grading rubric in the prompt greatly reduced variability in GPT’s scoring
. The model then understands the standards it should apply, much like a human grader with a rubric.
Give Examples (Few-Shot Prompting): Supplying a few examples of student answers and the desired evaluation for each can calibrate the model. In one paper, showing GPT-4 multiple examples of spoken responses with their human scores significantly improved its grading accuracy
. These examples can be included in the prompt as: “Example 1: (Student response)… – this would score B2 (upper intermediate) because …; Example 2: …” followed by “Now evaluate the following new response: …”. The LLM will pattern-match and produce a similar evaluation for the new input.
Chain-of-Thought Reasoning: Instead of asking the model to directly output a score or decision, ask it to reason step-by-step first. For instance: “Analyze the text for grammar errors and fluency issues. List them, then decide on a score.” This was recommended by OpenAI for model-based grading – “First reason step by step, then answer yes or no” or give a score
. By having the LLM articulate its reasoning (which you can choose to show or keep hidden), you encourage a more systematic evaluation and can catch if it goes off-track. Researchers note that chain-of-thought prompting yields more reliable outcomes on complex tasks
. Some have even combined this with a self-consistency approach: run the chain-of-thought multiple times and take the most common result, smoothing out randomness
.
Structured Output Formats: To ensure the model covers all aspects and is easy to parse, you can request outputs in a structured form. For example, “Give your feedback in JSON: { \"grammar\": <score>, \"fluency\": <score>, \"comments\": \"...\" }.” Google’s Gemini API documentation shows how one can prompt for structured JSON output containing transcriptions, timestamps, and even emotion tags from audio
. Likewise, for scoring, a structured format can make the evaluation more consistent and machine-checkable. If the model knows it must fill in specific fields (grammar, vocabulary, etc.), it’s less likely to wander off-topic. This method was implicitly used in some research: e.g., asking GPT-4 to output exactly the letter A/B/C corresponding to proficiency levels
 or to produce a table of analytic scores
. The constraint of format guides the model to stick to the requested evaluation criteria.
Temperature and Determinism: In generation settings, temperature controls randomness. When using LLMs for assessment, it’s usually best to set a low temperature (e.g. 0 or 0.2) for deterministic output. This avoids the model giving different scores each time due to creative variance. Several studies explicitly fixed a low temperature to get stable results
. Additionally, using the latest, most capable model (e.g. GPT-4 rather than GPT-3.5) for grading is recommended, as research by OpenAI found “model grading works best with the most powerful models”
 and ideally use a separate instance/model from the one that generated the answer to avoid self-bias
.
By combining these strategies – clear rubrics, examples, reasoning steps, structured outputs, and stable settings – practitioners have devised effective prompting “recipes” for language analysis. In fact, Google Cloud’s documentation on Gemini provides prompting recipes for audio, including using a system message to set instructions and dividing the prompt into parts (user query vs. file content)
. This kind of prompt templating is becoming a standard: one part of the prompt might contain the criteria and format, and another part contains the student’s content to evaluate. With well-crafted prompts, LLMs can reliably perform complex evaluations – essentially following a script or checklist provided by the prompter.
Real-World Applications and Examples
The use of LLMs for language assessment is not just in research – it’s already finding its way into educational technology products:
Duolingo Max (AI-Powered Learning): The language-learning app Duolingo integrated GPT-4 to create two features: “Role Play,” where learners converse with an AI partner, and “Explain My Answer,” which gives users instant, personalized feedback on their answers
. When a learner makes a mistake in an exercise, they can tap “Explain My Answer” and GPT-4 will “break down the grammar rules” and explain why the mistake happened
. This feature essentially turns GPT-4 into an on-demand language tutor, analyzing a user’s sentence and providing a clear explanation of any errors. According to Duolingo’s engineers, GPT-4’s reliability in understanding the specific error and its cause finally gave them confidence to automate this feedback – something that wasn’t accurate enough with GPT-3
. “GPT-4 gives us far more confidence in the accuracy of AI responses in Explain My Answer,” noted Duolingo’s lead engineer
. In practice, this means millions of learners can get immediate, context-specific explanations (in simple terms) for their mistakes, rather than a generic “wrong” or a pre-written tip. It’s a prime example of using an LLM to analyze a learner’s language output and respond with helpful guidance. Early user feedback suggests these GPT-4 powered explanations feel personalized and clear, helping learners understand complex grammar in a conversational way. Duolingo’s use case highlights that LLMs can be deployed at scale to improve language learning outcomes – here the prompt engineering was handled by Duolingo (with safety nets to avoid misinformation), and learners benefit from high-quality automated feedback.
Automated Language Tests: The Duolingo English Test (DET), a standardized test of English proficiency, has also leveraged AI for scoring speaking and writing for years. While details of their scoring engine aren’t public, it’s known that AI enables quick, reliable scoring of test-taker responses. With the advent of GPT-4, it’s plausible that such testing platforms are experimenting with LLMs to enhance scoring explanations or check the consistency of scores. Similarly, educational companies are exploring GPT-4 for scoring open-ended assessment questions. For instance, platforms that assign speaking tasks (like describing a picture or answering an interview question) can use an ASR + GPT pipeline to instantly score and give feedback to the user. This provides immediate remediation: a test-taker could be told “Your response is a bit off-topic; try to address the question more directly,” or “To reach a higher score, you might use more advanced vocabulary or complex sentences.” Such targeted tips were difficult to generate with older rule-based systems, but come naturally to an LLM that can both grade and explain in fluent language.
Classroom Writing Assistants: Teachers have begun using LLMs like ChatGPT or Claude to assist in grading and providing feedback on student essays. For example, a teacher can copy a student’s essay into ChatGPT and prompt: “Grade this essay on a scale of 1–10 based on the attached rubric, and provide three points of feedback: one on content, one on organization, one on grammar.” The LLM will then output a tentative grade with the requested comments. Of course, teachers must review and calibrate this output, but it dramatically speeds up the grading process and ensures no major issue is overlooked (the AI might catch an error the teacher missed, and vice versa). There are reports of high consistency when the same essay is run through an LLM with a fixed prompt, which is promising for fairness (every student is judged by the same criteria without human fatigue or bias). However, as noted earlier, one must be careful to stabilize the prompt and settings – even the time of day or slight wording changes could alter an AI’s grading if not locked down. Some educators are creating a shared prompt template as a “grading assistant” and sticking to it for all papers, treating the AI’s output as a second opinion to complement their own judgment.
OpenAI’s Evaluation Framework: Even OpenAI uses LLMs to evaluate language outputs – in this case, to grade AI-generated answers. They released OpenAI Evals, which includes model-based graders where GPT-4 is asked to judge the correctness or quality of another model’s response
. These graders use prompts like “Here is a question, and here is the model’s answer. Evaluate if the answer is correct and complete. Think step by step and then output a single word: correct or incorrect.” This scenario is akin to scoring short answers or explanations, demonstrating that LLMs can reliably apply a rubric to complex content if instructed to “reason before judging”
. OpenAI found that grader prompts with an explicit reasoning step significantly improved accuracy in identifying flaws in answers
. This approach is very relevant to language learner outputs: the AI grader could be checking if an explanation is logically coherent, if a translation is accurate, or if a spoken response actually answered the question. It’s essentially using an LLM as a meta-evaluator of language.
Research Prototypes and Tools: The rapid progress in this field means new tools are emerging. For instance, an experimental system might combine Whisper (ASR) with GPT-4 to allow English learners to practice speaking: the learner speaks, Whisper transcribes it, GPT-4 evaluates and gives feedback – all in a matter of seconds. Similarly, start-ups are looking into AI-powered writing mentors that not only correct grammar (like Grammarly) but also score your writing on traits (clarity, tone, creativity) using LLM prompts. Open-source projects like the SALMONN model
 provide a foundation for developers to build custom speech-analysis LLMs that could be fine-tuned for specific evaluation tasks (say, assessing pronunciation for language learners or evaluating presentations for public speaking classes). In the table below, we highlight a few concrete examples of LLM-based prompting approaches for language analysis:
Application	LLM Approach & Prompting	Outcome / Findings	Source
Holistic Essay Scoring (English L2 writing)	GPT-4 prompted with holistic proficiency descriptors (zero-shot). Prompt: “Read the essay and give an overall CEFR level (A1–C2) based on fluency, coherence, accuracy.”	GPT-4’s holistic scores showed strong correlation with human ratings. Some studies report GPT scoring matching teachers for holistic levels
, though others saw gaps for non-native essays
. With rubric guidance, consistency approached human graders
.	Holistic correlation: 
;
Prompt engineering for consistency: 
.
Analytic Writing Assessment (specific skills)	GPT-4 used in zero-shot to predict multiple trait scores (e.g. grammar, vocab, organization) from one prompt. No fine-tuning, just instructing the model to “score 1–5 on each trait and justify briefly.”	Without training, GPT-4 could produce sensible analytic scores – these showed significant correlation with actual proficiency features for each category
. Indicates LLMs can evaluate distinct aspects of writing in one go, though absolute accuracy may be lower than holistic.	BEA 2024 study (Bannò et al.): GPT-4 analytic scores vs features
.
Writing Feedback Generation	GPT-4 (and 3.5) prompted as a “writing tutor,” given a student’s text and asked to provide feedback per a rubric (covering content, style, and suggestions). E.g. “Provide feedback mentioning at least one positive and one area to improve, focusing on argument strength and grammar.”	GPT-4’s feedback was more readable and comprehensive than human instructors’, covering key feedback dimensions (feed-forward tips, self-regulation advice) significantly better
. Both GPT-3.5 and 4 were also more consistent in tone. GPT-4’s feedback reliability (accuracy of critique) was higher than GPT-3.5’s
.	Study on AI feedback (Dai et al. 2024): GPT vs instructor feedback
.
Spoken Response Scoring (English speaking test)	GPT-4 API in a pipeline: audio → ASR (transcript) → GPT-4 prompt. Prompt included examples of answers at different scores (few-shot) and asked GPT-4 to score the new transcript on a proficiency scale with reasoning.	GPT-4 scoring on ASR transcripts was on par or better than a trained ML model for low-resource proficiency levels
. Using few-shot examples of graded responses significantly improved GPT’s grading accuracy
. Importantly, ASR errors did not ruin the assessment – performance using automatic vs human transcripts was equivalent
. This validates the ASR+LLM pipeline for speech.	Finnish/Swedish L2 study (Voskoboinik et al. 2025): LLM scoring vs ML model
; Few-shot improves accuracy
.
Multimodal LLM – Direct Speech Grader	Speech-LLMs (e.g. custom GPT-4 with audio input, SALMONN 13B). Model is given the raw audio and a prompt like “Transcribe and evaluate the speaker’s French proficiency (pronunciation, fluency, accuracy) on a 10-point scale.” The model internally processes audio+text.	Early results show state-of-the-art performance. A Cambridge model combining a speech encoder with an LLM outperformed prior systems on holistic speaking scores
. These models capture pronunciation and prosody from audio plus coherence from text. They can directly output a score or assessment text from audio. This approach, while computationally heavy, eliminates the separate ASR step and can leverage acoustic nuances (intonation, pace) in scoring.	Cambridge study (Rao et al. 2025): Speech-LLM vs baselines
. SALMONN model card: “LLM with hearing abilities”
.
Duolingo “Explain My Answer” (Grammar correction)	GPT-4 integrated via API with a custom prompt per exercise. When a learner’s answer is wrong, Duolingo sends GPT-4 the question, the user’s answer, and the correct answer, with a prompt to explain the mistake and relevant grammar rule in simple terms.	Delivered instant, personalized explanations to learners. GPT-4 can pinpoint the learner’s error and articulate the rule (e.g. “You used ‘estaba’ but needed ‘estuve’ because this is a completed action in the past.”). Duolingo reports that GPT-4’s accuracy and clarity in these explanations met their quality bar, whereas GPT-3 sometimes gave confusing or incorrect explanations
. This feature helps users learn from mistakes on the spot, filling a crucial gap in language apps (which often lacked deep grammar feedback).	OpenAI–Duolingo case study: GPT-4 for Roleplay & Explain
.
(Table: Examples of how LLM prompting is applied to evaluate or give feedback on language in various contexts, with key outcomes.)
Conclusion
Large language models have rapidly become powerful tools for language analysis – not just in understanding or generating language, but in evaluating it. In writing assessment, LLMs like GPT-4 have demonstrated they can score essays nearly as well as human experts and provide detailed feedback that outshines traditional automated graders. In speaking assessment, LLM-based approaches (whether via transcripts or direct speech-enabled models) are reaching new heights of accuracy, offering a scalable solution to evaluate spoken language skills for learners. The key to these successes lies in clever prompting and system design: by imbuing the model with our evaluation criteria (rubrics, examples, reasoning steps), we guide its vast linguistic knowledge toward making reliable judgments on quality and fluency. From academic research to real-world apps, the evidence is clear that LLMs can serve as effective “judges” of language proficiency. They can flag errors, rate fluency, assess coherence, and even suggest improvements – often in real time. This opens up exciting possibilities: imagine personalized language tutors that not only converse with learners but also continuously assess and coach them, or automated exam scoring that provides individualized feedback to each test-taker. We are already seeing the first steps, as in Duolingo’s GPT-4 features and other pilot programs. Of course, challenges remain in ensuring fairness (avoiding biases), maintaining consistency, and aligning AI’s judgments with pedagogical goals. Ongoing research into prompt engineering and model fine-tuning for evaluation tasks will further improve reliability. In summary, LLM prompting for language quality analysis is a burgeoning field blending NLP and education. It has yielded promising techniques and results for both written and spoken language assessment. By leveraging these advances, educators and developers can create tools that give learners instant, informative feedback – ultimately helping users to write and speak more fluently and accurately. The convergence of ASR technology with LLM intelligence, exemplified by systems like Gemini and SALMONN, suggests a future where an AI can listen to a student speaking, understand the response like a human teacher, and provide an evaluation or correction on the fly. The literature so far paints an optimistic picture that with the right approaches, large language models can greatly enhance how we measure and improve language proficiency
. The next few years will likely bring these research insights into widely available practical tools, making language learning more guided and personalized through AI.
Citations

Can GPT-4 do L2 analytic assessment? - ACL Anthology

https://aclanthology.org/2024.bea-1.14/

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

Assessing the proficiency of large language models in automatic feedback generation: An evaluation study - ScienceDirect

https://www.sciencedirect.com/science/article/pii/S2666920X24001024

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

ERIC - EJ1486523 - Enhancing Second Language Speaking Assessment: Integrating Large Language Models for Finnish and Finland Swedish Proficiency Scoring, Language Testing, 2025-Oct

https://eric.ed.gov/?q=example&ff1=dtyIn_2025&pg=10&id=EJ1486523

ERIC - EJ1486523 - Enhancing Second Language Speaking Assessment: Integrating Large Language Models for Finnish and Finland Swedish Proficiency Scoring, Language Testing, 2025-Oct

https://eric.ed.gov/?q=example&ff1=dtyIn_2025&pg=10&id=EJ1486523

ERIC - EJ1486523 - Enhancing Second Language Speaking Assessment: Integrating Large Language Models for Finnish and Finland Swedish Proficiency Scoring, Language Testing, 2025-Oct

https://eric.ed.gov/?q=example&ff1=dtyIn_2025&pg=10&id=EJ1486523

ERIC - EJ1486523 - Enhancing Second Language Speaking Assessment: Integrating Large Language Models for Finnish and Finland Swedish Proficiency Scoring, Language Testing, 2025-Oct

https://eric.ed.gov/?q=example&ff1=dtyIn_2025&pg=10&id=EJ1486523

Audio understanding  |  Gemini API  |  Google AI for Developers

https://ai.google.dev/gemini-api/docs/audio

tsinghua-ee/SALMONN · Hugging Face

https://huggingface.co/tsinghua-ee/SALMONN

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Getting Started with OpenAI Evals

https://cookbook.openai.com/examples/evaluation/getting_started_with_openai_evals

ChatGPT as a Stable and Fair Tool for Automated Essay Scoring | MDPI

https://www.mdpi.com/2227-7102/15/8/946

Audio understanding  |  Gemini API  |  Google AI for Developers

https://ai.google.dev/gemini-api/docs/audio

Audio understanding  |  Gemini API  |  Google AI for Developers

https://ai.google.dev/gemini-api/docs/audio

Assessment of L2 Oral Proficiency using Speech Large Language Models

https://arxiv.org/html/2505.21148v1

Can GPT-4 do L2 analytic assessment? - ACL Anthology

https://aclanthology.org/2024.bea-1.14/

Getting Started with OpenAI Evals

https://cookbook.openai.com/examples/evaluation/getting_started_with_openai_evals

Getting Started with OpenAI Evals

https://cookbook.openai.com/examples/evaluation/getting_started_with_openai_evals

Filling crucial language learning gaps | OpenAI

https://openai.com/index/duolingo/

Filling crucial language learning gaps | OpenAI

https://openai.com/index/duolingo/

Filling crucial language learning gaps | OpenAI

https://openai.com/index/duolingo/

Filling crucial language learning gaps | OpenAI

https://openai.com/index/duolingo/

Filling crucial language learning gaps | OpenAI

https://openai.com/index/duolingo/

Getting Started with OpenAI Evals

https://cookbook.openai.com/examples/evaluation/getting_started_with_openai_evals
All Sources

aclanthology

mdpi

sciencedirect

eric.ed

ai.google

huggingface

arxiv

cookbook.openai

openai