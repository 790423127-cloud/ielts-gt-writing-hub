const ALLOWED_ORIGINS = new Set([
  "https://790423127-cloud.github.io",
  "https://ielts-gt-writing-hub.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DISCLAIMER = "This is an AI-generated estimated score, not an official IELTS score.";
const REQUEST_TIMEOUT_MS = Math.max(45000, Math.min(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 160000, 240000));
const VALID_BANDS = [0, ...Array.from({ length: 17 }, (_, i) => 1 + i * 0.5)];
const SCORE_SYSTEM_VERSION = "score-core-v8-5-10-midband-core-cleanup";

const TASK1_BAND_ANCHORS_0_TO_9 = [
  { band: 0, profile: "No assessable GT letter: blank, fully copied, non-English, or wholly unrelated to the task.", zh: "没有可评分书信：空白、完全照抄、非英文或完全跑题。" },
  { band: 1, profile: "Only isolated words or memorised fragments; the purpose of the letter is almost impossible to identify.", zh: "只有零散单词或背诵片段，几乎看不出写信目的。" },
  { band: 2, profile: "Very little relevant message; not recognisably a complete letter; bullet points are largely missing.", zh: "相关信息极少，不像完整书信，题目要点基本缺失。" },
  { band: 3, profile: "Weak or unclear purpose; only minimal bullet coverage; very short or confused message; frequent errors block clarity.", zh: "目的很弱或不清楚，只覆盖极少要点，内容短或混乱，错误严重影响理解。" },
  { band: 4, profile: "Basically related but limited: bullet points may be attempted, but details are thin, tone/format are unstable, and frequent basic errors or unnatural phrasing reduce clarity.", zh: "基本相关但能力有限：可能尝试回应要点，但细节薄，语气/格式不稳，基础错误或不自然表达频繁影响清晰度。" },
  { band: 5, profile: "Purpose is generally clear and most or all bullet points are addressed; development may be simple and language may be limited, but the reader can understand and act on the message. Corrected low-band letters with clear purpose, basic details, appropriate informal/formal tone, and mostly understandable grammar/spelling normally fit here rather than Band 4.", zh: "写信目的基本清楚，大部分或全部要点有回应；展开可以简单、语言可以有限，但读者能理解并采取行动。语法拼写已基本修正、目的清楚、有基本细节且语气合适的低分修正版，通常属于此档而不是4分。" },
  { band: 6, profile: "Clear purpose and all bullet points covered with useful detail; tone and organisation are generally appropriate; language is understandable and reasonably controlled, though still limited or uneven.", zh: "目的清楚，所有要点都有有用细节，语气和结构大体合适，语言可理解且控制较稳定，但仍有限或不均衡。" },
  { band: 7, profile: "All bullet points are developed well; tone/register is natural; information is logically organised; vocabulary and grammar are flexible with only some errors.", zh: "所有要点展开较充分，语气自然，信息组织清楚，词汇和语法较灵活，错误较少。" },
  { band: 8, profile: "Task requirements are fulfilled fully and naturally; tone, format, and information selection are very appropriate; language is flexible and accurate with rare minor slips.", zh: "任务要求完成充分自然，语气、格式和信息选择很合适，语言灵活准确，只有少量小错。" },
  { band: 9, profile: "A fully natural, mature, precise GT letter; all bullet points are completely and appropriately developed; register is exact and errors are negligible.", zh: "完全自然成熟精准的书信，所有要点充分且得体，语气精准，错误极少。" }
];

const TASK2_BAND_ANCHORS_0_TO_9 = [
  { band: 0, profile: "No assessable essay: blank, fully copied, non-English, or wholly unrelated to the prompt.", zh: "没有可评分作文：空白、完全照抄、非英文或完全跑题。" },
  { band: 1, profile: "Only isolated words or memorised fragments; almost no position, development, or organisation.", zh: "只有零散词语或背诵片段，几乎没有立场、展开或结构。" },
  { band: 2, profile: "A few relevant sentences may appear, but the response does not form a coherent answer to the task.", zh: "可能有少量相关句子，但不能形成完整任务回应。" },
  { band: 3, profile: "Very limited position and content; weak or confused organisation; frequent errors make meaning difficult.", zh: "观点和内容极少，结构弱或混乱，错误频繁导致理解困难。" },
  { band: 4, profile: "Basically related but very limited: ideas are simple, repetitive, or barely developed; organisation is weak or mechanical; frequent basic errors restrict control.", zh: "基本相关但很有限：观点简单、重复或几乎没有展开；结构弱或机械；基础错误频繁限制表达控制。" },
  { band: 5, profile: "Clear position and basic structure, but ideas are general, examples are brief, reasoning is shallow, and language is simple, repetitive, awkward, or error-prone.", zh: "有明确立场和基本结构，但观点笼统、例子短、论证浅，语言简单、重复、不自然或错误较多。" },
  { band: 6, profile: "Clear response with basic but real development; examples or explanations are relevant; progression is generally clear; errors do not seriously reduce clarity.", zh: "回应清楚，有基本但真实的展开，例子或解释相关，结构基本清楚，错误不严重影响理解。" },
  { band: 7, profile: "Well-organised essay with clear position, developed ideas, logical progression, flexible vocabulary, varied grammar, and relatively few errors.", zh: "结构清楚，立场明确，观点发展充分，逻辑推进明显，词汇灵活，语法有变化，错误较少。" },
  { band: 8, profile: "Fully developed response with mature reasoning, natural cohesion, precise flexible vocabulary, strong grammatical control, and rare minor errors.", zh: "回应充分，论证成熟，衔接自然，词汇精准灵活，语法控制强，错误很少。" },
  { band: 9, profile: "A fully responsive, sophisticated essay with natural, fluent argumentation, precise language, and negligible errors.", zh: "完全回应题目，论证自然深入，语言精准流畅，错误极少。" }
];

const TASK1_CORRECTED_LOWBAND_BAND5_ANCHOR = [
  "Corrected low-band Task 1 calibration: if a previously weak letter has been corrected so that the reader can clearly understand the purpose, all three bullet points are covered, the tone matches the recipient, and spelling/grammar no longer frequently strain meaning, it should normally be considered around Band 5.0-5.5 rather than remaining in Band 4.",
  "Band 5 Task 1 is allowed for simple but functional letters: vocabulary can be basic, development can be limited, and sentences can be mostly simple, provided the message is clear and the reader can act on it.",
  "Do not keep Lexical Resource or Grammar at Band 4 solely because the vocabulary is ordinary or sentence structures are simple. Band 4 language requires frequent errors, awkward word choice, spelling problems, or sentence-boundary issues that still noticeably strain communication.",
  "For informal letters to friends, a conversational greeting and friendly sign-off can be appropriate. Do not penalise it as insufficiently formal when the task asks for a friend."
];

function task1CorrectedBand5AnchorText() {
  return TASK1_CORRECTED_LOWBAND_BAND5_ANCHOR.map((rule, index) => `${index + 1}. ${rule}`).join("\n");
}

const TASK1_GATE_RULES = [
  "Bullet Coverage Gate: identify each bullet as covered, partly_covered, or missing. Missing two bullets normally keeps Task Achievement at Band 4.0 or below; missing one bullet normally keeps it at Band 5.0 or below; three mentioned but thinly developed is usually 5.0-5.5; clear development of all bullets unlocks 6.0+.",
  "Purpose Clarity Gate: unclear purpose limits TA; clear but simple purpose supports 5.0-6.0; clear natural purpose supports 6.0+.",
  "Tone/Register Gate: formal, semi-formal, or informal tone must match the recipient and task. A clearly wrong tone limits TA and LR.",
  "Letter Completeness Gate: check greeting/opening purpose/body/closing/request or thanks/sign-off. If it does not read like a letter, TA and CC cannot be high.",
  "Task 1 Word Count Guard: below 80 words is usually severely limited; 80-120 often falls around 3.5-5.0 if bullets are thin; 120-150 is rateable but must be checked for missing detail; 150-190 is normal; 220+ is not penalised automatically but check repetition or irrelevance.",
  "High-band Unlock Gate: if all bullets are fully and naturally developed, tone is precise, organisation is natural, and language is accurate/flexible, actively consider 7.5/8.0/8.5/9.0 rather than capping at 7.0."
];

const TASK2_GATE_RULES = [
  "Task Response Depth Gate: check all prompt parts, clear position when required, relevant reasons, examples, explanation, and avoidance of generic unsupported claims.",
  "Band 6 Access Rule: Band 6 needs real development, not just a position plus paragraphs. The essay needs clear response, basic explanation, some specific support, clear progression, and errors that do not often block clarity.",
  "Low-band Guard: short or weak essays must not be lifted because they have paragraph labels. Under 100 words is often 0-3.5; 100-150 with minimal development often 3.5-4.5; 150-220 can enter 4.5-5.5 depending on development and language.",
  "Mid-band Check: visible structure, Firstly/Secondly/In conclusion, or a stated opinion is not by itself enough for 5.5/6.0+.",
  "High-band Unlock Gate: if the essay is fully responsive, mature, logically developed, cohesive, lexically precise, and grammatically controlled, actively consider 7.5/8.0/8.5/9.0 instead of defaulting to 7.0.",
  "Score-profile Check: challenge all-equal criterion bands and large gaps between task/organisation and LR/GRA; explain why each criterion is where it is."
];


const TASK1_BAND_BOUNDARY_PROTOCOL = [
  "Task 1 low-band 0-3: no assessable letter, extremely short message, unclear purpose, 0-1 bullet addressed, or errors blocking communication. Do not reward letter-looking layout if communicative purpose is missing.",
  "Task 1 Band 4: basically related but bullet coverage is incomplete or details are very thin; tone/register or letter completeness may be unstable; frequent errors reduce clarity.",
  "Task 1 Band 5/5.5: purpose is generally clear and most or all bullets are addressed; details can be simple or one bullet may be thin; tone may be basic/uneven; language remains limited but the message is usually clear.",
  "Corrected low-band Task 1: if grammar/spelling are mostly corrected, all bullets are covered, and the informal/formal tone matches the prompt, do not keep TA/CC/LR/GRA at Band 4 merely because the style is simple. Consider Band 5.0-5.5.",
  "Task 1 Band 6/6.5: all bullets are covered with useful detail; purpose and tone are generally appropriate; organisation is clear; language errors do not seriously reduce understanding.",
  "Task 1 high-band 7-9: all bullets are developed naturally and proportionately; register is precise; the letter reads like a real response to the reader; vocabulary and grammar are flexible, accurate, and mostly error-free. Consider 7.5/8/8.5/9 when this evidence is present.",
  "Task 1 hard checks: if a bullet is missing, Task Achievement normally cannot exceed 5.0; if two bullets are missing, TA normally cannot exceed 4.0; if tone/register is clearly wrong, TA and LR must be reviewed."
];

const TASK2_BAND_BOUNDARY_PROTOCOL = [
  "Task 2 low-band 0-3: blank/irrelevant/non-English/very short, or only a few relevant sentences with no developed answer. Do not lift because of paragraph labels.",
  "Task 2 Band 4: related but very limited response; ideas are simple and barely developed; organisation is weak; language errors are frequent.",
  "Task 2 Band 5/5.5: clear position and basic structure, but ideas are general, examples are brief, reasoning is shallow, and LR/GRA are limited or error-prone. This is the normal range for complete but weak essays.",
  "Task 2 Band 6/6.5: clear response with real development, relevant explanations/examples, generally clear progression, and errors that do not often block clarity. Paragraphing alone is not Band 6 evidence.",
  "Task 2 high-band 7-9: developed or mature reasoning, natural cohesion, precise/flexible vocabulary, varied grammar, and few/rare errors. If the essay is fully responsive and controlled, consider 7.5/8/8.5/9 and do not default to 7.0.",
  "Task 2 hard checks: 80-119 words usually 3.0-4.0; 120-149 usually 3.5-4.5; 150-179 usually 4.0-5.0; 180-229 needs strong development to justify 5.5/6.0+. High spelling/grammar density must constrain LR/GRA."
];

const SCORE_SCALE_CALIBRATION_V8_5_5 = {
  "Task 1": [
    "Scale correction: completion is not the same as quality. A letter can mention all three bullets and still be Band 4/5 if the message is thin, awkward, repetitive, or full of basic errors.",
    "Low-band correction: for Task 1 Band 3/4 samples, do not lift to Band 5.5/6.5 merely because there is a greeting, closing, paragraphs, and some relevant content. Frequent grammar/word-choice problems and weak control must keep LR/GRA low.",
    "Band 4 letter profile: related and understandable in places, but basic, uneven, thin, and error-prone. If this profile fits, TA may be 4/4.5 and LR/GRA often 3.5/4 even if all bullets are attempted.",
    "Band 5/5.5 letter profile: purpose is clear and the task is mostly handled, but expression is simple, formulaic or noticeably limited; it should not automatically become Band 7.",
    "Band 6/6.5 letter profile: all bullets are covered with useful detail and the tone is generally appropriate, but the response still lacks the natural flexibility and accuracy of Band 7+.",
    "High-band correction: Band 8/9 Task 1 is concise but highly natural, precise, controlled and reader-focused. If that evidence is present, do not hold the score at 7 just because the letter is short or straightforward."
  ],
  "Task 2": [
    "Scale correction: a full-length essay with paragraphs and a clear opinion is not automatically Band 6/7. The quality of reasoning, support, cohesion, lexis, and grammar must justify the band.",
    "Low-band correction: Band 3/4 essays can be above 250 words if they are repetitive, simplistic, poorly controlled, and only weakly developed. Do not lift them because they are long.",
    "Band 4 essay profile: related but basic and repetitive, with limited reasoning and frequent basic language limitations. If this fits, TR/CC may be 4/4.5 and LR/GRA often 3.5/4.",
    "Band 5/5.5 essay profile: position and structure are clear, but ideas are general, explanation is shallow, and language is limited. This is the normal score for complete but weak essays.",
    "Band 6/6.5 essay profile: there is real development and mostly clear progression, but maturity, precision and flexibility are still limited.",
    "High-band correction: Band 8/9 Task 2 requires mature, well-extended reasoning, precise lexis, natural cohesion, and strong grammatical control. If that evidence is present, do not default to 7."
  ],
  "global": [
    "Use the whole scale. Avoid central compression: do not pull weak 3/4 writing up to 5.5/6, and do not push polished 8/9 writing down to 7 by default.",
    "Criterion order: assign TA/TR first from task fulfilment and development, CC from progression and cohesion, LR from range/precision/naturalness, and GRA from range/accuracy. Do not infer criteria from overall.",
    "Language-control rule: frequent basic grammar errors, awkward collocations, repeated simple vocabulary, or unnatural phrasing should visibly constrain LR and GRA even when the answer is relevant.",
    "High-band unlock rule: rare errors, natural collocation, precise topic vocabulary, controlled complex sentences, and mature progression are sufficient to consider 8/8.5/9; do not require literary style."
  ]
};

function scoreScaleCalibrationText(task) {
  const taskRules = SCORE_SCALE_CALIBRATION_V8_5_5[task === "Task 1" ? "Task 1" : "Task 2"] || [];
  return [...SCORE_SCALE_CALIBRATION_V8_5_5.global, ...taskRules].map((rule, index) => `${index + 1}. ${rule}`).join("\n");
}

const EXTREME_BAND_ANCHOR_CONTRAST_V8_5_5 = {
  "Task 1": [
    "B3/B3.5 anchor: a real letter attempt may still be low if it says things like 'I am write', 'time now is very problem', repeated simple ideas, weak purpose/detail, and frequent basic errors. Do not lift this to 5.5+ just because it has Dear/Thank you and 150+ words.",
    "B4/B4.5 anchor: understandable complaint/request with most bullets attempted, but simple wording, frequent grammar errors, thin detail, and awkward phrasing. TA may be 4/4.5 but LR/GRA often 3.5/4.5; overall is usually around 4-5, not 6.5/7.",
    "B5/B5.5 anchor: purpose clear and bullets mostly covered, but expression is formulaic, development basic, and errors/limited range remain noticeable. This is not Band 7 unless language and tone are naturally controlled.",
    "B7 anchor: complete, naturally organised letter with clear purpose, appropriate tone, relevant details and mostly accurate language, but not exceptional precision or flexibility.",
    "B8/B8.5 anchor: fully effective and reader-focused; tone is precise, paragraphing natural, details are selected well, lexis is flexible and grammar is strongly controlled with only rare slips. This should not be held at 7 if evidence is present.",
    "B9 anchor: concise but fully natural, exact register, all bullet points proportionately developed, negligible errors, and no awkwardness. If the response fits this, Band 8.5/9 is allowed even if the letter is short."
  ],
  "Task 2": [
    "B3/B3.5 anchor: 250+ words can still be low if the essay repeats 'good and bad', gives very simple assertions, weak progression, limited reasoning, and frequent grammar/collocation errors. Length alone must not lift it to 5+.",
    "B4/B4.5 anchor: relevant and paragraph-shaped but basic, repetitive, mechanical, weakly developed and error-prone. TR/CC may be 4/4.5 and LR/GRA around 3.5/4.5; do not score this as Band 6 solely because it has an introduction/body/conclusion.",
    "B5/B5.5 anchor: clear opinion and basic structure, but generic reasons, short examples, limited explanation, simple vocabulary, and uneven grammar. This is the normal range for complete but weak essays.",
    "B7 anchor: clear position, developed relevant ideas, logical progression, flexible vocabulary and generally accurate grammar; good but not consistently mature or highly precise.",
    "B8/B8.5 anchor: mature reasoning, well-extended support, natural cohesion, precise flexible vocabulary and strong grammar with rare slips. This should not default to all-four-7.",
    "B9 anchor: fully responsive, sophisticated, fluent argumentation with exact wording, unobtrusive cohesion, and negligible errors. If the response fits this, Band 8.5/9 is allowed; do not require literary style."
  ]
};


const MIDBAND_4_TO_6_CALIBRATION_RULES = {
  "Task 1": [
    "Midband scope: this scorer is the primary production scorer for ordinary IELTS GT Task 1 letters around Band 4.0-6.5. Do not outsource ordinary Band 5 writing to lowband logic.",
    "Priority rule for this midband scorer: these 4.0-6.5 anchors override older low-band protection notes unless the writing is truly not rateable or has hard lowband evidence. Do not let generic 'protect Band 4' language outweigh a clear functional Band 5 response.",
    "Functional Band 5 rule: if a Task 1 letter has a recognisable greeting/closing, a clear purpose, all or most bullets communicated, and the reader can act on the message, it normally belongs at 5.0 or 5.5 even when the wording is basic and some errors remain.",
    "Band 4.0 Task 1: related attempt but communication is unstable; bullet coverage may be partial/thin; frequent basic grammar, spelling, word-form or sentence-control errors make reading effortful.",
    "Band 4.5 Task 1: the main situation is understandable and perhaps all bullets are touched, but language errors remain frequent, vocabulary is narrow/error-prone, progression is mechanical, and the reader still works to understand details.",
    "Band 5.0 Task 1: purpose is clear enough and the main bullet points are addressed. Vocabulary may be basic and grammar may still contain noticeable mistakes, but the reader can understand the main message without serious difficulty. Band 5 does not mean error-free.",
    "Band 5.5 Task 1: bullets are covered more clearly, paragraphing and sequencing are stable, and language is easier to read than Band 5.0, though detail may still be limited and phrasing may remain simple or occasionally awkward.",
    "Band 6.0 Task 1: all bullets are clear with useful detail, tone and format are suitable, and language is reasonably controlled. Errors may remain, but they do not regularly interrupt the reader.",
    "Band 6.5 Task 1: clearly complete and fairly natural with better detail, lexical range and sentence control, but not yet consistently flexible/natural enough for Band 7.",
    "Do not keep Lexical Resource or Grammatical Range and Accuracy below 5.0 solely because the vocabulary is ordinary or sentence structures are simple. LR/GRA 4.5 requires concrete evidence that errors, spelling, word choice, sentence boundaries, or verb forms still make reading effortful.",
    "For a mostly corrected Task 1 letter with low local spelling/grammar error signals, LR 5.0 and GRA 5.0 are normal unless the AI can point to non-blocking but still frequent language problems. Simple but sufficient = Band 5, not Band 4.5.",
    "For informal letters to friends, simple conversational warmth is appropriate. Do not penalise a friend letter for not sounding formal or professional.",
    "A corrected low-band letter that now covers all bullets, has recognisable format and tone, and is mostly readable should normally move into Band 5.0-5.5 rather than staying at 4.0-4.5."
  ],
  "Task 2": [
    "Midband scope: this scorer is the primary production scorer for ordinary IELTS GT Task 2 essays around Band 4.0-6.5. Do not treat length and paragraphing as high quality, but also do not keep a complete understandable answer at lowband solely for simple language.",
    "Priority rule for this midband scorer: these 4.0-6.5 anchors override older low-band protection notes unless the writing is truly not rateable or has hard lowband evidence. Do not let generic 'protect Band 4' language outweigh a clear basic Band 5 response.",
    "Band 4.0 Task 2: a related attempt with weak or repetitive ideas, poor control, and frequent language errors that make reading effortful; the position or prompt coverage may be unstable.",
    "Band 4.5 Task 2: basic response is understandable, but development remains thin/general, cohesion is mechanical, and LR/GRA are limited with frequent errors.",
    "Band 5.0 Task 2: a clear basic position and the main question parts are addressed. Ideas may be simple and language may have noticeable errors, but the reader can follow the argument. Band 5 can contain many non-blocking errors. Band 5 may still contain many non-blocking errors.",
    "Band 5.5 Task 2: relevant ideas are more consistently explained, progression is clearer, and language is easier to read than Band 5.0, though examples may still be general and grammar/lexis remain limited.",
    "Band 6.0 Task 2: the task is answered clearly with relevant support and logical progression. Vocabulary and grammar are adequate and reasonably controlled, though still not highly flexible.",
    "Band 6.5 Task 2: relevant, developed and coherent with some flexibility, but not consistently precise, mature or accurate enough for Band 7.",
    "A simple but complete answer to a two-question Task 2 prompt should usually be considered in the 5.0-6.0 range, not lowband, unless language or development seriously restricts communication.",
    "For sophisticated but partially off-task essays, do not flatten all criteria: TR may be lower while CC/LR/GRA can remain higher if the language and organisation are genuinely stronger."
  ]
};

function midbandCalibrationRulesForTask(task) {
  return (MIDBAND_4_TO_6_CALIBRATION_RULES[task === "Task 1" ? "Task 1" : "Task 2"] || [])
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join("\n");
}


function extremeBandAnchorContrastText(task) {
  const rules = EXTREME_BAND_ANCHOR_CONTRAST_V8_5_5[task === "Task 1" ? "Task 1" : "Task 2"] || [];
  return rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n");
}

function v855ExtremeBandDecisionProtocol(task) {
  return [
    "v8.5.5 extreme-band decision protocol:",
    "1. First decide whether the response resembles a low, middle, or high anchor from the writing itself, not from length or layout.",
    "2. For low-band candidates, frequent basic errors and repetitive/simple development must constrain LR/GRA and may constrain TA/TR/CC. Do not reward format alone.",
    "3. For high-band candidates, do not punish concision or non-literary style. If fulfilment, cohesion, lexis and grammar are mature/precise/controlled, allow Band 8+.",
    "4. If the first-pass score is 5.5+ for a weak/error-prone sample, explicitly justify why it is not Band 4/4.5; otherwise revise down.",
    "5. If the first-pass score is 7/7.5 for a polished near-error-free sample, explicitly justify why it is not Band 8/8.5; otherwise revise up.",
    `6. Task-specific anchor contrast:\n${extremeBandAnchorContrastText(task)}`
  ].join("\n");
}


const FORCED_ANCHOR_COMPARISON_V8_5_6 = {
  "Task 1": [
    "Forced Task 1 low-band comparison: if the response contains frequent basic errors, awkward phrases, weak or unclear purpose, thin detail, unstable register, or merely mentions bullets without effective development, compare first to Band 3/4/4.5 before considering Band 5.5+.",
    "Task 1 Band 3/4 can be 150+ words. Word count, greeting, closing, and three paragraphs do not lift a weak letter above Band 4/4.5 unless the message is clear, controlled and sufficiently developed.",
    "Task 1 Band 5/5.5 is the normal range for complete but basic letters with simple content, repetitive wording, limited sentence control, or some unnatural phrasing. It is also the expected range for corrected low-band letters that clearly cover the task and are no longer error-dense.",
    "If a Task 1 informal letter answers all three bullets, has a recognisable greeting/closing, and grammar/spelling are mostly corrected so the message is clear, do not hold it at Band 4 for ordinary vocabulary or simple sentences alone.",
    "Task 1 Band 7 requires more than task completion: it needs natural reader-focused development, appropriate register, controlled organisation and flexible language.",
    "Task 1 Band 8/9 should be used for a concise but fully effective letter when tone is exact, detail is well selected, cohesion is unobtrusive, vocabulary is precise, and grammar errors are rare or negligible."
  ],
  "Task 2": [
    "Forced Task 2 low-band comparison: if reasoning is repetitive, generic, circular, weakly connected, or language control is poor, compare first to Band 3/4/4.5 before considering Band 5.5+.",
    "Task 2 Band 3/4 can be 250+ words. Length, four paragraphs, an introduction and conclusion do not lift a weak essay above Band 4/4.5 unless ideas are developed and language is controlled.",
    "Task 2 Band 5/5.5 is the normal range for a complete but weak essay with basic opinion, simple reasons, shallow explanation, repetitive vocabulary and frequent grammar limits.",
    "Task 2 Band 7 requires clear relevant development, logical progression, generally flexible lexis and grammar, and relatively few errors.",
    "Task 2 Band 8/9 should be used when the argument is mature and well-extended, cohesion is natural, vocabulary is precise/flexible, grammar is strongly controlled, and errors are rare or negligible. Do not cap such writing at 7 because it is not literary."
  ]
};

function v856ForcedAnchorComparisonProtocol(task) {
  const rules = FORCED_ANCHOR_COMPARISON_V8_5_6[task === "Task 1" ? "Task 1" : "Task 2"] || [];
  return [
    "v8.5.6 forced anchor-comparison calibration:",
    "1. Do not choose a safe middle band first. Compare the script to low, mid and high anchors before selecting criteria.",
    "2. Low anchor protection: if the script is weak but long, do not lift it. Length and layout are not quality.",
    "3. High anchor unlock: if the script is controlled, precise and mature, do not trap it at Band 7.",
    "4. Criterion rule: LR and GRA must reflect language control, not task completion. TA/TR and CC must reflect development and progression, not just paragraph presence.",
    ...rules.map((rule, index) => `${index + 5}. ${rule}`)
  ].join("\n");
}


const EXAM_REALISM_CALIBRATION_RULES = {
  "Task 1": [
    "Task 1 Band 4 is possible even when a letter has greeting/body/closing if coverage is thin, tone is unstable, and language is basic, awkward, or frequently wrong.",
    "Task 1 Band 5/5.5 is for a generally understandable but limited letter: most or all bullets may be addressed, detail may be simple, and vocabulary/grammar may be basic, but the reader can follow the message.",
    "Corrected low-band letter rule: after obvious grammar/spelling errors are fixed, a simple letter that covers all bullets and uses an appropriate tone should usually rise from 4.0-4.5 to about 5.0-5.5, unless content is still missing or language still frequently strains meaning.",
    "Task 1 Band 6/6.5 is for a clear, complete letter with all bullets covered and generally appropriate tone, but still with limited flexibility, some awkwardness, or noticeable non-blocking errors.",
    "Task 1 Band 7/7.5 is for a natural GT letter that clearly covers all three bullets with relevant detail, appropriate register, logical organisation, and mostly accurate language.",
    "Task 1 Band 8+ requires full, reader-focused completion plus natural organisation, precise register, flexible vocabulary and strong grammatical control with rare slips.",
    "Do not over-reward structure alone. Completion plus weak language is usually mid-band, not Band 7. Completion plus natural accurate control can be Band 7+."
  ],
  "Task 2": [
    "Task 2 Band 4 is possible in a full-length essay if the response is repetitive, simplistic, weakly developed and language control is poor.",
    "Task 2 Band 5/5.5 is for a complete but weak essay: clear position/basic structure but shallow development, generic examples, frequent language issues, or limited progression.",
    "Task 2 Band 6/6.5 is for a clear answer with real explanation and relevant support, even if ideas are not sophisticated and some language errors remain.",
    "Task 2 Band 7/7.5 is for a fully relevant, well-organised essay with developed ideas, clear progression, flexible vocabulary, and generally accurate grammar.",
    "Task 2 Band 8+ requires mature, well-developed reasoning, precise lexis, natural cohesion, and strong grammatical control with rare errors.",
    "Do not over-reward length and paragraphing. A long but repetitive essay with weak grammar is still low or mid-band. Do not under-reward polished, mature writing by defaulting to Band 7."
  ]
};

function examRealismCalibrationRulesForTask(task) {
  return (EXAM_REALISM_CALIBRATION_RULES[task === "Task 1" ? "Task 1" : "Task 2"] || []).map((rule, index) => `${index + 1}. ${rule}`).join("\n");
}


const IELTS_CRITERION_BAND_MATRIX = {
  "Task 1": {
    "Task Achievement": {
      "0": "Blank, non-English, explicit no-answer, copied-only, or no assessable GT letter.",
      "1": "Only isolated words or memorised fragments; the communicative purpose cannot be identified.",
      "2": "Very little relevant message; not recognisably a complete letter; bullet points are mostly absent.",
      "3": "Weak or unclear purpose; only one requirement may be faintly touched; severe communication problems.",
      "4": "Basically related but incomplete; one or more bullets are missing or very thin; tone/format may be unstable.",
      "5": "Purpose is generally clear and most or all bullets are addressed; details may be simple or thin, and tone may be basic/uneven, but the reader can understand the message and act on it.",
      "6": "Clear purpose; all bullets are covered with useful detail; tone is generally appropriate and there is enough development for the reader to act comfortably.",
      "7": "All bullets are clearly and relevantly developed; tone/register is natural; the letter reads as a complete answer to the reader.",
      "8": "Requirements are fulfilled fully and naturally; information selection is effective; tone/register is very well controlled.",
      "9": "Fully natural, mature, precise GT letter; all requirements are completely fulfilled with exact register and negligible weakness."
    },
    "Coherence and Cohesion": {
      "0": "No assessable organisation.",
      "1": "Fragments without logical order.",
      "2": "Minimal sequencing; message is very hard to follow.",
      "3": "Some order may exist, but progression is weak or confusing.",
      "4": "Basic paragraphing or sequence exists, but links are mechanical/inaccurate and progression is unstable.",
      "5": "Overall letter structure is visible; ideas are generally sequenced and understandable, though progression may be repetitive, abrupt, or under-linked.",
      "6": "Clear letter structure; paragraphs serve a purpose; linking generally works.",
      "7": "Logical, smooth organisation; paragraphing, referencing, and progression help the reader.",
      "8": "Natural flow; cohesion is flexible and unobtrusive.",
      "9": "Effortless organisation; cohesion is precise and fully natural."
    },
    "Lexical Resource": {
      "0": "No assessable vocabulary.",
      "1": "Only isolated words.",
      "2": "Very limited basic words; meaning is rarely clear.",
      "3": "Very limited range; frequent word choice/spelling errors often block meaning.",
      "4": "Basic vocabulary; frequent errors and awkward collocations; meaning is often strained.",
      "5": "Vocabulary is sufficient for the task but limited/repetitive; errors are noticeable but meaning is usually clear.",
      "6": "Adequate topic vocabulary; some flexibility; occasional awkward word choice, spelling, or word-form errors.",
      "7": "Good range and precision for the task; some less common vocabulary; few errors.",
      "8": "Flexible, precise vocabulary; natural collocation and register; rare minor slips.",
      "9": "Full, natural, precise lexical control."
    },
    "Grammatical Range and Accuracy": {
      "0": "No assessable grammar.",
      "1": "Isolated words only.",
      "2": "Very few correct sentence forms.",
      "3": "Frequent errors; sentence control is very weak; meaning is often difficult.",
      "4": "Basic sentence forms attempted; errors are frequent; punctuation and sentence boundaries are unstable.",
      "5": "Simple forms are mostly understandable and some complex forms may appear; errors may remain, but the message is usually clear and grammar does not frequently strain reading.",
      "6": "Mix of simple and complex structures; errors occur but rarely block understanding.",
      "7": "Variety of structures with generally good control; only some errors remain.",
      "8": "Wide range with strong control; rare non-systematic errors.",
      "9": "Fully flexible and accurate grammar."
    }
  },
  "Task 2": {
    "Task Response": {
      "0": "Blank, non-English, explicit no-answer, copied-only, or wholly unrelated response.",
      "1": "Isolated fragments with no real position or answer.",
      "2": "A few relevant sentences may appear, but there is no coherent response to the task.",
      "3": "Very limited answer; position is unclear or minimal; development is almost absent.",
      "4": "Related but limited; ideas are simple and barely developed; parts of the task may be missed.",
      "5": "Clear position/basic structure, but ideas are general, examples are brief, and reasoning is shallow.",
      "6": "Clear response with real but basic development; relevant reasons/examples; all main parts mostly addressed.",
      "7": "Fully relevant answer; clear position; ideas are developed logically and sufficiently.",
      "8": "Well-developed mature response; clear judgement; strong reasoning and support.",
      "9": "Sophisticated, fully responsive, precise argument with negligible limitations."
    },
    "Coherence and Cohesion": {
      "0": "No assessable organisation.",
      "1": "No logical sequence.",
      "2": "Very little organisation; meaning is hard to follow.",
      "3": "Weak sequence; paragraphing is unclear; links are minimal or inaccurate.",
      "4": "Basic structure exists but progression is weak; linking is repetitive or faulty.",
      "5": "Introduction/body/conclusion are visible; ideas are generally sequenced but development may be abrupt.",
      "6": "Clear overall progression; paragraphing works; cohesive devices are mostly appropriate.",
      "7": "Logical progression throughout; cohesion and referencing are effective.",
      "8": "Smooth, natural flow; paragraphs are well managed.",
      "9": "Seamless organisation and cohesion."
    },
    "Lexical Resource": {
      "0": "No assessable vocabulary.",
      "1": "Isolated words only.",
      "2": "Very limited vocabulary.",
      "3": "Very basic range; frequent errors obscure meaning.",
      "4": "Limited topic vocabulary; frequent word choice, word form, or spelling problems.",
      "5": "Vocabulary is adequate for a basic argument but repetitive/general; noticeable errors remain.",
      "6": "Sufficient range for the topic; some flexibility; errors do not often impede meaning.",
      "7": "Good range and precision; some less common items; few errors.",
      "8": "Flexible, precise, natural vocabulary; rare slips.",
      "9": "Sophisticated and fully natural lexical control."
    },
    "Grammatical Range and Accuracy": {
      "0": "No assessable grammar.",
      "1": "Isolated words only.",
      "2": "Very few controlled sentence forms.",
      "3": "Frequent sentence-level errors; meaning is often difficult.",
      "4": "Basic structures attempted; errors are frequent and sometimes impede meaning.",
      "5": "Simple forms and limited complex forms; errors are noticeable but the message is usually clear.",
      "6": "Mix of sentence forms; grammar errors are present but rarely reduce clarity.",
      "7": "Variety and generally good control; some errors remain.",
      "8": "Wide range with strong control; rare minor errors.",
      "9": "Fully flexible, accurate, and natural grammar."
    }
  }
};

function criterionBandMatrixForTask(task) {
  return IELTS_CRITERION_BAND_MATRIX[task === "Task 1" ? "Task 1" : "Task 2"];
}

function criterionBandMatrixText(task) {
  const matrix = criterionBandMatrixForTask(task);
  return Object.entries(matrix).map(([criterion, bands]) => {
    const rows = Object.entries(bands).map(([band, desc]) => `Band ${band}: ${desc}`).join("\n");
    return `${criterion}\n${rows}`;
  }).join("\n\n");
}

function halfBandDecisionProtocol() {
  return [
    "Half-band decision protocol:",
    "- Use 0.5 increments whenever performance sits between two adjacent full bands.",
    "- Band X.5 means clearly stronger than Band X.0, but not consistently meeting Band X+1.0.",
    "- For every criterion, compare the adjacent lower, exact, and adjacent higher half/full bands.",
    "- Do not prefer whole bands by default; use the evidence.",
    "- Do not use local word-count/spelling/grammar signals as automatic caps or floors; they are only non-scoring risk notes."
  ].join("\n");
}

function bandBoundaryProtocolForTask(task) {
  return (task === "Task 1" ? TASK1_BAND_BOUNDARY_PROTOCOL : TASK2_BAND_BOUNDARY_PROTOCOL).map((rule, index) => `${index + 1}. ${rule}`).join("\n");
}

const DETAILED_SCORING_STEPS = [
  { stage: "score-precheck", title: "本地文本信号检查", description: "统计词数、段落、句子、英文比例、拼写/语法风险和可评分性；本地不打分。" },
  { stage: "score-task-router", title: "Task 1 / Task 2 分流", description: "确定使用 GT Task 1 书信规则还是 Task 2 作文规则，并生成任务画像。" },
  { stage: "score-anchor", title: "AI 独立 0–9 锚点判断", description: "AI 单独判断最接近的 0–9 分锚点；这个结果会传入四项评分，不能由最终分数反推。" },
  { stage: "score-criteria", title: "AI 四项初评与半分判断", description: "AI 返回四项分、half-band 理由、原文证据、anchor comparison 和任务专属 gate。" },
  { stage: "score-boundary-audit", title: "本地 hard boundary audit", description: "本地强制检查低分边界、高分天花板、四项同分、anchor 冲突和 Band 6 准入风险。" },
  { stage: "score-boundary-review", title: "AI 二次边界复核", description: "如果本地 audit 触发风险，AI 必须二次复核并重新确认或修正四项分；无风险则跳过。" },
  { stage: "score-differentiation-review", title: "AI 四项独立区分复核", description: "如果四项分完全相同，AI 必须重新检查四项证据；可以保留同分，但必须证明不是复制 Overall。" },
  { stage: "score-finalize", title: "最终验证并冻结分数", description: "验证结构完整后，机械平均 AI 返回的四项最终分并冻结；本地不直接改分。" }
];
const VISIBLE_SCORING_STEPS = [
  { stage: "local-precheck", title: "本地预检与任务分流", description: "检查词数、任务类型、可评分性、语言风险和 Task 1 / Task 2 评分边界。" },
  { stage: "score-kernel", title: "AI 核心评分", description: "AI 只返回 anchor、四项分和 reason codes，不生成中文、长解释、原文引用或详细反馈。" },
  { stage: "boundary-audit", title: "本地边界审计", description: "检查低分抬高、高分卡 7、弱语言高分、四项同分和 anchor 冲突。" },
  { stage: "boundary-review", title: "AI 边界复核", description: "AI 复核低/中/高分边界，并防止首轮评分压缩。" },
  { stage: "criterion-differentiation", title: "AI 四项区分复核", description: "四项完全同分时，AI 再次独立检查 TA/TR、CC、LR、GRA 是否真的应相同。" },
  { stage: "final-score-freeze", title: "冻结最终分数", description: "只冻结 AI 返回的四项分和 Overall；详细反馈由独立接口生成，不在打分接口内运行。" }
];

function visibleStepMessage(stage, result = {}) {
  const signals = result.localSignals || {};
  const anchor = result.anchorComparison || {};
  const audit = result.boundaryAudit || {};
  const meta = result.scoreCoreMeta || {};
  if (stage === "local-precheck") {
    return `本地预检完成：${signals.wordCount ?? "-"} words，任务 ${signals.task || result.task || "-"}，可评分性 ${signals.rateabilityStatus || "-"}。`;
  }
  if (stage === "score-kernel") {
    return `AI 核心评分完成：anchor Band ${anchor.closestAnchorBand ?? result.scoreKernel?.anchorBand ?? "-"}，四项分已返回为短 JSON。`;
  }
  if (stage === "boundary-audit") {
    const reasons = Array.isArray(audit.reviewReasons) ? audit.reviewReasons : [];
    return audit.reviewRequired
      ? `本地边界审计触发 ${reasons.length || 1} 项复核：${reasons.slice(0, 3).join("；")}${reasons.length > 3 ? "..." : ""}`
      : "本地边界审计通过：没有发现必须二次复核的低分、高分、锚点或分数组合冲突。";
  }
  if (stage === "boundary-review") {
    if (audit.boundaryReview?.triggered || meta.boundaryReviewApplied) {
      return `AI 边界复核完成：${audit.boundaryReview?.decision || "reviewed"}。`;
    }
    return "AI 边界复核跳过：本地边界审计未触发强制复核。";
  }
  if (stage === "criterion-differentiation") {
    const diff = audit.criterionDifferentiationReview || {};
    if (diff.triggered) {
      return `AI 四项区分复核完成：${diff.decision || "reviewed"}。`;
    }
    return "AI 四项区分复核跳过：四项并非需要复核的同分组合。";
  }
  if (stage === "final-score-freeze") {
    const finalBand = result.overallBand ?? result.scoreCalculation?.finalBand;
    return `最终分数已冻结：Overall Band ${Number.isFinite(Number(finalBand)) ? Number(finalBand).toFixed(1) : "-"}；四项详细反馈将由 /api/criterion-feedback 独立生成。`;
  }
  return "阶段状态已更新。";
}

function buildVisibleProgress(result = {}, status = "done") {
  return {
    version: SCORE_SYSTEM_VERSION,
    totalSteps: VISIBLE_SCORING_STEPS.length,
    currentStep: status === "done" ? VISIBLE_SCORING_STEPS.length : 2,
    currentStage: status === "done" ? "score-final-output" : "score-ai-anchor-review",
    status,
    updatedAt: new Date().toISOString(),
    steps: VISIBLE_SCORING_STEPS.map((step, index) => ({
      ...step,
      index: index + 1,
      status: status === "done" ? "done" : (index === 1 ? "running" : index === 0 ? "done" : "waiting"),
      message: status === "done" ? visibleStepMessage(step.stage, result) : step.description,
      detail: step.stage === "score-ai-anchor-review" ? { anchorComparison: result.anchorComparison || null, boundaryAudit: result.boundaryAudit || null } : null
    }))
  };
}


function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.includes("ielts-gt-writing-hub") && url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://790423127-cloud.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin"
  };
}

function sendJson(req, res, statusCode, payload) {
  Object.entries(corsHeaders(req)).forEach(([key, value]) => res.setHeader(key, value));
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}
function normalizeRequestedTask(body = {}) {
  const raw = String(
    body.task ||
    body.taskType ||
    body.scoringTask ||
    body.requestedTask ||
    body.selectedTask ||
    body.writingTask ||
    body.moduleTask ||
    ""
  ).toLowerCase();

  if (/task\s*1|task1|gt\s*task\s*1|letter|gt\s*letter|writing\s*1/.test(raw)) return "Task 1";
  if (/task\s*2|task2|gt\s*task\s*2|essay|gt\s*essay|writing\s*2/.test(raw)) return "Task 2";

  return "Task 2";
}

function normalizeIncomingBody(rawBody = {}) {
  const body = rawBody && typeof rawBody === "object" ? { ...rawBody } : {};
  const lockedTask = normalizeRequestedTask(body);
  body.task = lockedTask;
  body.taskType = lockedTask === "Task 1" ? "task1" : "task2";
  body.scoringTask = lockedTask;
  body.requestedTask = lockedTask;
  body.selectedTask = lockedTask;
  body.essay = String(body.essay || "");
  body.questionPrompt = String(body.questionPrompt || body.promptText || body.prompt || "");
  body.promptText = String(body.promptText || body.questionPrompt || body.prompt || "");
  body.wordCount = Number.isFinite(Number(body.wordCount)) ? Number(body.wordCount) : countWords(body.essay);
  return body;
}

function resolveScoringSignals(body = {}, current = {}) {
  const lockedTask = normalizeRequestedTask(body);
  const existing = current && typeof current === "object" ? current.localSignals : null;
  if (existing && typeof existing === "object" && existing.task === lockedTask) {
    return existing;
  }
  return localSignals({
    ...body,
    task: lockedTask,
    taskType: lockedTask === "Task 1" ? "task1" : "task2",
    scoringTask: lockedTask,
    requestedTask: lockedTask,
    selectedTask: lockedTask
  });
}

function taskValueFromCurrent(current = {}) {
  if (!current || typeof current !== "object") return "";
  return current.localSignals?.task || current.task || current.scoringTask || current.requestedTask || current.selectedTask || "";
}

function safeCurrentForTask(body = {}, current = {}) {
  const lockedTask = normalizeRequestedTask(body);
  const currentTask = taskValueFromCurrent(current);
  if (currentTask && currentTask !== lockedTask) {
    return {
      staleCurrentResultRejected: true,
      staleCurrentResultRejectedReason: `Ignored stale currentResult for ${currentTask}; locked request task is ${lockedTask}.`
    };
  }
  return current && typeof current === "object" ? current : {};
}

function isMidbandPrimaryScoringRequest(body = {}) {
  const value = String(
    body.scoringSystem ||
    body.targetSystem ||
    body.requestedScoringSystem ||
    body.scoreSystem ||
    body.system ||
    ""
  ).toLowerCase();
  return body.midbandPrimary === true ||
    body.midbandOnly === true ||
    body.skipMandatoryBoundaryReview === true ||
    body.disableMandatoryBoundaryReview === true ||
    /midband/.test(value);
}

function bypassBoundaryReviewForMidband(body = {}, firstResult = {}) {
  const signals = resolveScoringSignals(body, firstResult);
  const initialAudit = firstResult.boundaryAudit || buildHardBoundaryAudit(firstResult.finalCriteria || firstResult.criteria, signals, firstResult.anchorComparison || {}, firstResult.criterionCalibration || {}, { skipFeedbackQualityAudit: true });
  return {
    ...firstResult,
    boundaryAudit: {
      ...initialAudit,
      status: "skipped_midband_primary",
      reviewRequired: false,
      freezeBlocked: false,
      reviewReasons: [],
      boundaryReview: {
        triggered: false,
        decision: "skipped_midband_primary",
        reviewReasons: [],
        whyFinalCriteriaAreSafe: "Production midband scorer freezes the first AI score after local hard-boundary audit; mandatory boundary adjudicator is not allowed to override ordinary 4.0-6.5 writing.",
        whyFinalCriteriaAreSafeZh: "生产中分系统只在本地硬边界审计后冻结首轮 AI 分数；普通 4.0-6.5 作文不再由边界复核系统抢最终分。"
      }
    },
    stabilityWarnings: [...new Set([...(firstResult.stabilityWarnings || []), "Mandatory boundary review skipped for production midband primary route."])],
    scoreCoreMeta: {
      ...(firstResult.scoreCoreMeta || {}),
      boundaryReviewed: false,
      boundaryReviewApplied: false,
      mandatoryBoundaryReviewSkipped: true,
      midbandPrimaryMode: true,
      scoreFrozen: false
    }
  };
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function countParagraphs(text) {
  return String(text || "").split(/\n\s*\n|\r?\n/).map((x) => x.trim()).filter(Boolean).length;
}

function sentenceUnits(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return (cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
}

function distinctWordRatio(text) {
  const words = String(text || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
  if (!words.length) return 0;
  return new Set(words).size / words.length;
}

function copiedPromptOverlapRatio(essay, prompt) {
  const stop = new Set(["the","a","an","to","of","and","or","in","on","for","with","is","are","was","were","be","been","being","you","your","write","letter","essay","some","people","this","that","it","as","at","by","from"]);
  const ew = new Set((String(essay || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || []).filter((w) => !stop.has(w) && w.length > 2));
  const pw = new Set((String(prompt || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || []).filter((w) => !stop.has(w) && w.length > 2));
  if (!ew.size) return 0;
  let shared = 0;
  ew.forEach((w) => { if (pw.has(w)) shared += 1; });
  return shared / ew.size;
}

function detectHardZeroResponse(body = {}, signals = null) {
  const essay = String(body.essay || "").trim();
  const prompt = String(body.questionPrompt || body.promptText || "");
  const task = normalizeRequestedTask(body);
  const words = signals?.wordCount ?? countWords(essay);
  const sentences = sentenceUnits(essay);
  const totalTokens = (essay.match(/\S+/g) || []).length;
  const englishTokens = (essay.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
  const englishRatio = totalTokens ? englishTokens / totalTokens : 0;
  const lowered = essay.toLowerCase();
  const noAnswerPattern = /\b(no answer|no letter|cannot write|can't write|i cannot write|i can not write|copied prompt only)\b/i.test(essay);
  const nonEnglishShort = Boolean(essay && englishTokens === 0 && words === 0);
  const finiteClause = /\b(i|we|they|he|she|it|people|children|students|parents|government|governments|company|manager|friend|council|residents|customers|someone|somebody|this|that)\s+(am|is|are|was|were|have|has|had|can|could|will|would|should|may|might|must|think|believe|want|need|buy|use|live|spend|write|ask|suggest|apologise|apologize|explain|prefer|choose|help|make|give|take|work|study|play|close|arrive|damage|move|meet)\b/i.test(lowered);
  const task1MicroAttempt = task === "Task 1" && words >= 4 && words <= 12 && /\b(dear|hi|hello|sorry|please|thank|thanks|refund|money\s+back|meet|watch|lamp|park|house|advice|move|city|product|bad|broken|send)\b/i.test(lowered);
  const task2HasOpinionSignal = /\b(i\s+think|i\s+agree|i\s+disagree|because|should|must|can|could|is|are)\b/i.test(lowered);
  const task2MicroAttempt = task === "Task 2" && words >= 4 && words <= 12 && task2HasOpinionSignal && /\b(good|bad|people|school|online|shopping|transport|pollution|living|alone|ageing|society|government|children)\b/i.test(lowered);
  const rateableMicroAttempt = task1MicroAttempt || task2MicroAttempt || finiteClause;
  const onlyKeywords = words > 0 && words <= 10 && distinctWordRatio(essay) <= 0.9 && !rateableMicroAttempt;
  const repeatedKeywordFragment = words > 0 && words <= 10 && !finiteClause && /([a-z]+(?:\s+[a-z]+)?)[.!?]?\s+\1/i.test(lowered);
  const ultraShortNoSentence = words > 0 && words <= 2 && sentences.length <= 1;
  const copiedLike = words <= 14 && copiedPromptOverlapRatio(essay, prompt) >= 0.75;
  const meaninglessFragments = words <= 10 && /^(?:[a-z]+[.!?]?\s*){1,10}$/i.test(essay.replace(/\s+/g, " ").trim()) && !rateableMicroAttempt;
  if (!essay) return { triggered: true, reason: "blank_response", task, words };
  if (noAnswerPattern) return { triggered: true, reason: "explicit_no_answer_or_copied_prompt_marker", task, words };
  if (nonEnglishShort || englishRatio < 0.2) return { triggered: true, reason: "non_english_or_no_assessable_english", task, words, englishRatio: Number(englishRatio.toFixed(2)) };
  if (copiedLike && !rateableMicroAttempt) return { triggered: true, reason: "copied_prompt_or_prompt_keyword_recycling", task, words, overlapRatio: Number(copiedPromptOverlapRatio(essay, prompt).toFixed(2)) };
  if ((ultraShortNoSentence || onlyKeywords || repeatedKeywordFragment || meaninglessFragments) && !rateableMicroAttempt) return { triggered: true, reason: "keyword_fragments_without_assessable_response", task, words };
  return { triggered: false, reason: rateableMicroAttempt && words <= 12 ? "minimal_but_rateable_micro_attempt" : "assessable_or_rateable", task, words, rateableMicroAttempt };
}

const STRICT_HARD_ZERO_REASONS = new Set([
  "blank_response",
  "non_english_or_no_assessable_english",
  "explicit_no_answer_or_copied_prompt_marker"
]);

function isStrictHardZeroGate(gate = {}) {
  return Boolean(gate?.triggered && STRICT_HARD_ZERO_REASONS.has(String(gate.reason || "")));
}

function downgradeSoftHardZeroGate(gate = {}) {
  if (!gate?.triggered || isStrictHardZeroGate(gate)) return gate;
  return {
    ...gate,
    triggered: false,
    originalTriggered: true,
    originalReason: gate.reason,
    reason: "soft_hard_zero_blocked_for_ai_scoring",
    note: "Soft local hard-zero signal was not allowed to assign Band 0. The response must go to AI scoring unless it is blank, non-English, or an explicit no-answer."
  };
}

function zeroBandCriterionNames(criteria = {}) {
  return Object.entries(criteria || {})
    .filter(([, band]) => Number(band) === 0)
    .map(([criterion]) => criterion);
}

function assertNoImpossibleZeroBand(criteria = {}, signals = {}) {
  const zeroCriteria = zeroBandCriterionNames(criteria);
  if (!zeroCriteria.length) return;
  if (isStrictHardZeroGate(signals.hardZeroGate)) return;
  const error = new Error(`AI returned Band 0 for a rateable/non-hard-zero response: ${zeroCriteria.join(", ")}. Retry scoring instead of freezing a false zero.`);
  error.status = 502;
  error.aiStage = "score-kernel";
  error.code = "IMPOSSIBLE_ZERO_BAND";
  error.zeroCriteria = zeroCriteria;
  throw error;
}

function makeCriteriaWithBand(task, band) {
  const out = {};
  criterionNames(task).forEach((name) => { out[name] = band; });
  return out;
}

function buildHardZeroScore(body = {}, signals = null, gate = null) {
  const local = signals || localSignals(body);
  const hardZero = gate || detectHardZeroResponse(body, local);
  const criteria = makeCriteriaWithBand(local.task, 0);
  const anchorComparison = normalizeAnchorComparison({
    anchorSystem: `${taskRuleLabel(local.task)} local hard-zero gate`,
    closestAnchorBand: 0,
    lowerAnchorBand: 0,
    higherAnchorBand: 1,
    candidateRange: "0",
    closestAnchorProfile: local.task === "Task 1" ? TASK1_BAND_ANCHORS_0_TO_9[0].profile : TASK2_BAND_ANCHORS_0_TO_9[0].profile,
    closestAnchorProfileZh: local.task === "Task 1" ? TASK1_BAND_ANCHORS_0_TO_9[0].zh : TASK2_BAND_ANCHORS_0_TO_9[0].zh,
    whyCloserToThisBand: `Hard-zero gate: ${hardZero.reason}.`,
    whyNotLowerAnchor: "Band 0 is the lowest possible IELTS band.",
    whyNotHigherAnchor: "There is no assessable response beyond blank/copied/non-English/keyword fragments."
  }, local.task, criteria, local);
  const boundaryAudit = {
    version: "strict-boundary-audit-v7-4-hard-zero",
    localScoringApplied: true,
    localParticipation: "Hard-zero only: the server assigns Band 0 only for blank, non-English, copied-prompt, no-answer, or keyword-fragment responses before AI scoring.",
    status: "passed",
    reviewRequired: false,
    reviewReasons: [],
    wordCountBoundary: getWordCountBoundaryProfile(local.task, local.wordCount),
    lowBandBoundary: { status: "hard_zero", suggestedRange: "Band 0", scoreTooHigh: false, reason: hardZero.reason },
    highBandBoundary: { status: "not_applicable", allFourSeven: false, highCandidate: false, reason: "Hard-zero response." },
    anchorAudit: { status: "passed", anchorMissing: false, anchorConflict: false, closestAnchorBand: 0, finalBand: 0 },
    scoreProfileAudit: { status: "passed", allCriteriaSame: true, warnings: [] },
    hardZeroGate: hardZero,
    rawAverage: 0,
    finalBand: 0
  };
  const result = {
    ok: true,
    aiStage: "score-core",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task: local.task,
    criteria,
    finalCriteria: criteria,
    rawAverage: 0,
    overallBand: 0,
    localSignals: { ...local, hardZeroGate: hardZero, rateabilityStatus: "not_rateable_or_severely_limited" },
    taskProfile: buildTaskProfile(body, local),
    anchorComparison,
    criterionCalibration: compactCriterionCalibration({ reasonCodes: {} }, criteria, local.task),
    scoreProfile: {},
    taskSpecificGate: normalizeTaskSpecificGate({}, local, criteria, anchorComparison, {}),
    boundaryAudit,
    stabilityWarnings: [],
    scoreCalculation: {
      mode: local.task === "Task 1" ? "task1_gt_letter_hard_zero_v7_4" : "task2_essay_hard_zero_v7_4",
      formula: "Hard-zero gate before AI scoring for blank, copied, non-English, no-answer or keyword-fragment responses.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage: 0,
      finalBand: 0,
      localScoreChanged: false,
      localScoreChangeExplanation: `Hard invalid gate triggered before AI scoring: ${hardZero.reason}.`
    },
    scoreCoreMeta: { scoreFirst: true, scoreFrozen: true, hardZeroGate: true, feedbackAfterFreeze: false, generatedAt: new Date().toISOString(), stage: "hard-zero" },
    feedbackStatus: { status: "skipped_hard_zero", scoreChanged: false, note: "No detailed AI feedback generated for a non-assessable hard-zero response." },
    criterionDifferentiationAudit: buildCriterionDifferentiationAudit(criteria, "fallback-template"),
    localLogicAudit: {
      ...buildLocalLogicAudit(),
      hardInvalidGateApplied: true,
      notes: "Local logic only handled hard invalid detection for a non-assessable response; no rateable essay score was locally estimated."
    },
    scoreFrozen: true,
    feedbackCanChangeScore: false,
    localScoreChanged: false
  };
  return attachSinglePassProgress(result, "done");
}


function cleanRequirement(value) {
  return String(value || "")
    .replace(/^[-*•·]\s+/, "")
    .replace(/^(\d+)[.)]\s+/, "")
    .replace(/^and\s+/i, "")
    .replace(/[.;:,\s]+$/g, "")
    .trim();
}

function extractTask1Bullets(promptText) {
  const source = String(promptText || "");
  const lines = source.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const direct = lines.filter((line) => /^[-*•·]\s+/.test(line) || /^(\d+)[.)]\s+/.test(line)).map(cleanRequirement).filter(Boolean);
  if (direct.length) return direct.slice(0, 5);
  const after = source.split(/In your letter[:,]?/i)[1] || source.split(/You should/i)[1] || source;
  const candidates = after.split(/\r?\n|;/).map(cleanRequirement).filter((part) => /^(give|explain|describe|say|tell|ask|suggest|apologise|apologize|thank|invite|offer|request|remind|include|state|mention|why|what|how)/i.test(part));
  return candidates.slice(0, 5);
}

function inferTask2Profile(promptText) {
  const prompt = String(promptText || "");
  const requiredParts = [];
  const add = (item) => { if (item && !requiredParts.includes(item)) requiredParts.push(item); };
  const directQuestions = (prompt.match(/[^?]+\?/g) || []).map((x) => x.trim()).filter(Boolean);
  const questionCount = directQuestions.length;
  const asksOpinion = /\b(your opinion|what is your opinion|give your opinion|to what extent do you agree|agree or disagree|do you agree|disagree)\b/i.test(prompt);
  const asksBothViews = /\b(discuss both views|discuss both these views|both views)\b/i.test(prompt);
  const asksAdvantage = /\b(advantage|advantages|benefit|benefits)\b/i.test(prompt);
  const asksDisadvantage = /\b(disadvantage|disadvantages|drawback|drawbacks)\b/i.test(prompt);
  const asksOutweigh = /\boutweigh\b/i.test(prompt);
  const asksCause = /\b(cause|causes|reason|reasons|why)\b/i.test(prompt);
  const asksProblem = /\b(problem|problems|issue|issues)\b/i.test(prompt);
  const asksSolution = /\b(solution|solutions|solve|measures|what can be done|how can this be)\b/i.test(prompt);
  const asksPositiveNegative = /\b(positive or negative|positive development|negative development|good thing or bad thing|is this a positive|is this a negative)\b/i.test(prompt);
  let questionType = "general_essay";
  const hasTwoDirectQuestions = questionCount >= 2;
  if (asksBothViews) {
    questionType = "discuss_both_views_with_opinion";
    add("discuss view 1"); add("discuss view 2"); if (asksOpinion) add("give your own opinion");
  } else if (asksOutweigh || (asksAdvantage && asksDisadvantage)) {
    questionType = asksOutweigh ? "advantages_disadvantages_outweigh" : "advantages_and_disadvantages";
    if (asksAdvantage) add("advantages"); if (asksDisadvantage) add("disadvantages"); if (asksOutweigh) add("state whether advantages outweigh disadvantages");
  } else if (asksCause && asksSolution) {
    questionType = "causes_and_solutions"; add("causes or reasons"); add("solutions or measures");
  } else if (asksProblem && asksSolution) {
    questionType = "problems_and_solutions"; add("problems"); add("solutions");
  } else if (asksPositiveNegative) {
    questionType = "positive_negative_development"; add("state whether it is mainly positive or negative"); add("support the judgement with reasons");
  } else if (hasTwoDirectQuestions) {
    questionType = asksOpinion ? "two_part_question_with_opinion" : "two_part_question";
    directQuestions.forEach((q, index) => add(`answer question ${index + 1}: ${q}`));
  } else if (asksOpinion) {
    questionType = "opinion_agree_disagree"; add("clear position"); add("reasons supporting the position");
  }
  if (hasTwoDirectQuestions && !requiredParts.length) directQuestions.forEach((q, index) => add(`answer question ${index + 1}: ${q}`));
  if (!requiredParts.length) add("answer all parts of the prompt");
  return {
    questionType,
    requiredParts,
    questionCount,
    directQuestions,
    twoPartQuestion: hasTwoDirectQuestions,
    positionRequired: asksOpinion || asksOutweigh || asksPositiveNegative || (hasTwoDirectQuestions && asksOpinion),
    bothSidesRequired: asksBothViews,
    causeRequired: asksCause,
    problemRequired: asksProblem,
    solutionRequired: asksSolution,
    advantageRequired: asksAdvantage,
    disadvantageRequired: asksDisadvantage,
    outweighRequired: asksOutweigh,
    positiveNegativeRequired: asksPositiveNegative
  };
}

function compactLowerText(text = "") {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function firstMatchingSentence(text = "", regex = null) {
  const sentences = sentenceUnits(text);
  const found = sentences.find((sentence) => regex ? regex.test(sentence) : sentence.trim());
  if (!found) return "";
  return found.length > 180 ? `${found.slice(0, 177)}...` : found;
}

function contentWords(text = "") {
  const stop = new Set(["the","a","an","to","of","and","or","in","on","for","with","is","are","was","were","be","been","being","you","your","i","we","they","he","she","it","this","that","these","those","my","our","their","me","him","her","them","do","does","did","can","could","would","should","will","may","might","must","have","has","had","want","like","say","tell","write","letter"]);
  return (String(text || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || []).filter((word) => word.length > 2 && !stop.has(word));
}

function overlapCount(requirement = "", essay = "") {
  const words = new Set(contentWords(requirement));
  const essayWords = new Set(contentWords(essay));
  let count = 0;
  words.forEach((word) => { if (essayWords.has(word)) count += 1; });
  return count;
}

function hasDesiredWorkSchedule(text = "") {
  const source = compactLowerText(text);
  return /\b(i|we)\s+(would\s+like|want|hope|prefer|can|could|am\s+able|will\s+be\s+able)\s+[^.!?]{0,80}\b(work|working|shift|hours)\b[^.!?]{0,80}\b(morning|afternoon|evening|day\s+shift|weekends?|weekdays?|before\s+\d{1,2}|after\s+\d{1,2}|from\s+\d{1,2}|\d{1,2}\s*(?:am|pm))/i.test(source)
    || /\b(work|working)\s+(?:from\s+\d{1,2}\s*(?:am|pm)?\s+to\s+\d{1,2}\s*(?:am|pm)?|before\s+\d{1,2}\s*(?:am|pm)?|after\s+\d{1,2}\s*(?:am|pm)?|in\s+the\s+morning|during\s+the\s+day|on\s+weekends?|on\s+weekdays?)\b/i.test(source)
    || /\b(morning|afternoon|evening|day)\s+shift\b/i.test(source);
}

function hasPartialWorkSchedule(text = "") {
  const source = compactLowerText(text);
  return hasSpecificWorkHoursOrShift(source) || /\b(change|reduce|cut|avoid|stop)\s+[^.!?]{0,40}\b(night\s+shift|evening\s+shift|working\s+hours|hours)\b/i.test(source) || /\bclass\s+(?:at|from)\s+\d{1,2}\s*(?:am|pm)?\b/i.test(source);
}

function classifyTask1Requirement(requirement = "", essay = "") {
  const req = compactLowerText(requirement);
  const source = compactLowerText(essay);
  const overlap = overlapCount(req, source);
  const evidenceFrom = (regex) => firstMatchingSentence(essay, regex) || "No clear direct evidence found.";
  let status = "missing";
  let issue = "This bullet point is not clearly answered.";
  let evidence = "No clear direct evidence found.";

  if (/\b((which|what)\s+hours|which\s+hours|what\s+hours|say\s+which\s+hours|hours\s+you\s+would\s+like\s+to\s+work|work\s+schedule|preferred\s+hours|preferred\s+shift)\b/i.test(req)) {
    if (hasDesiredWorkSchedule(source)) {
      status = "covered";
      issue = "A preferred working time, shift, or schedule is stated clearly enough.";
      evidence = evidenceFrom(/\b(work|working|shift|hours|morning|afternoon|evening|weekend|weekday|before|after|from|to)\b/i);
    } else if (hasPartialWorkSchedule(source)) {
      status = "partly_covered";
      issue = "The answer mentions class time or a shift problem, but it does not clearly state the exact hours or schedule the candidate wants to work.";
      evidence = evidenceFrom(/\b(class|shift|hours|work|working|morning|night|evening|6\s*pm|9\s*pm)\b/i);
    }
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(why|reason|explain why|want to|would like to|reduce)\b/i.test(req)) {
    const hasReason = /\b(because|as|since|so that|in order to|due to|reason|study|course|class|campus|college|family|health|exam|part[- ]time)\b/i.test(source);
    if (hasReason && overlap >= 1) { status = "covered"; issue = "A relevant reason is given."; }
    else if (hasReason || overlap >= 2) { status = "partly_covered"; issue = "A reason is visible, but it is not developed or clearly connected to the bullet point."; }
    evidence = evidenceFrom(/\b(because|as|since|so that|in order to|study|course|class|campus|college|family|health|exam|part[- ]time)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(benefit|benefits|employer|company|boss|manager|workplace|restaurant|business|customer)\b/i.test(req)) {
    const hasBenefit = /\b(benefit|help|improve|increase|bring|useful|skill|skills|knowledge|menu|dish|dishes|customer|customers|restaurant|business|performance|profit|service|quality)\b/i.test(source);
    if (hasBenefit && overlap >= 1) { status = "covered"; issue = "A relevant benefit to the employer is stated."; }
    else if (hasBenefit) { status = "partly_covered"; issue = "The employer benefit is mentioned, but it is thin or not clearly explained."; }
    evidence = evidenceFrom(/\b(benefit|help|improve|bring|skill|menu|dish|customer|restaurant|business|performance|service)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(apologise|apologize|sorry|apology)\b/i.test(req)) {
    const ok = /\b(sorry|apologise|apologize|apology|regret)\b/i.test(source);
    status = ok ? "covered" : "missing";
    issue = ok ? "An apology is clearly included." : "The required apology is missing.";
    evidence = evidenceFrom(/\b(sorry|apologise|apologize|apology|regret)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: ok ? null : 5.0 };
  }

  if (/\b(complain|complaint|problem|issue|broken|damage|wrong|refund|replace|repair)\b/i.test(req)) {
    const ok = /\b(problem|issue|broken|damage|damaged|wrong|refund|replace|repair|complain|complaint|not\s+work|poor|late|delay)\b/i.test(source);
    status = ok ? "covered" : (overlap >= 2 ? "partly_covered" : "missing");
    issue = ok ? "The problem or complaint is described." : "The complaint/problem is not clearly described.";
    evidence = evidenceFrom(/\b(problem|issue|broken|damage|wrong|refund|replace|repair|complain|poor|late|delay)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (/\b(ask|request|could|would|please|arrange|suggest|recommend|invite|thank|describe|explain|tell|give|state|mention)\b/i.test(req)) {
    const actionWords = /\b(please|could|would|ask|request|hope|suggest|recommend|invite|thank|thanks|grateful|describe|explain|tell|give|state|mention|arrange|meet)\b/i.test(source);
    if (actionWords && overlap >= 2) { status = "covered"; issue = "The requested communicative function is present."; }
    else if (actionWords || overlap >= 2) { status = "partly_covered"; issue = "The required function is visible but not sufficiently clear or developed."; }
    evidence = evidenceFrom(/\b(please|could|would|ask|request|hope|suggest|recommend|invite|thank|describe|explain|tell|give|state|mention|arrange|meet)\b/i);
    return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
  }

  if (overlap >= 3) { status = "covered"; issue = "This bullet is answered with relevant content."; evidence = firstMatchingSentence(essay, null); }
  else if (overlap >= 1) { status = "partly_covered"; issue = "This bullet is only partly addressed; the link to the requirement is weak or thin."; evidence = firstMatchingSentence(essay, null); }
  return { requirement, status, evidence, issue, capIfProblem: status === "covered" ? null : 5.5 };
}

function auditTask1Requirements(body = {}, signals = {}) {
  const essay = String(body.essay || "");
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || "");
  const bullets = Array.isArray(signals.task1BulletPoints) && signals.task1BulletPoints.length ? signals.task1BulletPoints : extractTask1Bullets(prompt);
  const items = bullets.map((requirement, index) => ({ index: index + 1, ...classifyTask1Requirement(requirement, essay) }));
  const missingCount = items.filter((item) => item.status === "missing").length;
  const partlyCount = items.filter((item) => item.status === "partly_covered").length;
  const midbandPrimary = isMidbandPrimaryScoringRequest(body);
  let advisoryTaskAchievementCap = null;
  if (missingCount >= 2) advisoryTaskAchievementCap = 4.0;
  else if (missingCount === 1) advisoryTaskAchievementCap = 5.0;
  else if (partlyCount >= 1) advisoryTaskAchievementCap = 5.5;
  else if (items.length >= 3 && items.every((item) => item.status === "covered") && Number(signals.wordCount) < 120) advisoryTaskAchievementCap = 6.0;

  // In production midband mode this audit must never act as a local scoring ceiling.
  // It is only a checklist passed to the AI examiner so simple but functional Band 5 letters
  // are not pulled back to Band 4 merely because the local keyword classifier is conservative.
  const taskAchievementCap = midbandPrimary ? null : advisoryTaskAchievementCap;
  return {
    version: "task1-requirement-audit-v8-2-advisory-midband",
    task: "Task 1",
    extractedRequirements: bullets,
    items,
    missingCount,
    partlyCount,
    taskAchievementCap,
    advisoryTaskAchievementCap,
    midbandAdvisoryOnly: midbandPrimary,
    triggered: !midbandPrimary && Number.isFinite(taskAchievementCap),
    summary: Number.isFinite(advisoryTaskAchievementCap)
      ? (midbandPrimary
        ? `Task 1 requirement audit is advisory only in midband mode: ${missingCount} bullet(s) appear missing and ${partlyCount} bullet(s) appear partly covered by local keyword audit. AI must judge coverage from the actual prompt and response; this is not a cap.`
        : `Task 1 requirement audit capped Task Achievement at Band ${advisoryTaskAchievementCap.toFixed(1)} because ${missingCount} bullet(s) are missing and ${partlyCount} bullet(s) are only partly covered.`)
      : "All extracted Task 1 bullet requirements appear covered by local requirement audit."
  };
}

function detectTask2RequirementSignals(essay = "") {
  const source = compactLowerText(essay);
  return {
    clearOpinion: /\b(i\s+(strongly\s+)?(agree|disagree|believe|think)|in\s+my\s+opinion|from\s+my\s+perspective|my\s+view\s+is|i\s+would\s+argue|this\s+is\s+(?:a\s+)?(positive|negative)|i\s+support|i\s+oppose)\b/i.test(source),
    implicitJudgement: /\b(can\s+be\s+good|can\s+be\s+useful|can\s+help|can\s+make|are\s+good|is\s+good|should\s+be\s+watched|watched\s+sensibly|if\s+watched\s+sensibly|not\s+suitable|too\s+much\s+.*\s+may\s+not\s+be\s+good|best\s+to\s+|prefer|preferable)\b/i.test(source),
    viewOne: /\b(some\s+people|one\s+view|on\s+the\s+one\s+hand|supporters|those\s+who\s+support|people\s+who\s+believe|one\s+argument)\b/i.test(source),
    viewTwo: /\b(other\s+people|others|another\s+view|on\s+the\s+other\s+hand|opponents|however|whereas|while\s+others|critics)\b/i.test(source),
    advantage: /\b(advantage|benefit|beneficial|positive|good\s+point|improve|save|helpful|useful|opportunity|convenient)\b/i.test(source),
    disadvantage: /\b(disadvantage|drawback|negative|problem|harmful|risk|cost|waste|damage|pressure|difficult|bad\s+point)\b/i.test(source),
    cause: /\b(cause|reason|because|due\s+to|as\s+a\s+result\s+of|result\s+from|lead\s+to|is\s+caused\s+by)\b/i.test(source),
    problem: /\b(problem|issue|challenge|difficulty|risk|concern|negative\s+effect|harmful\s+effect)\b/i.test(source),
    solution: /\b(solution|solve|measure|should|need\s+to|must|can\s+be\s+done|government\s+should|people\s+should|schools\s+should|companies\s+should)\b/i.test(source),
    positiveNegativeJudgement: /\b(positive|negative|beneficial|harmful|good\s+development|bad\s+development|overall\s+it\s+is|mainly\s+positive|mainly\s+negative)\b/i.test(source),
    outweighJudgement: /\b(outweigh|more\s+important\s+than|greater\s+than|more\s+benefits?|more\s+drawbacks?|advantages\s+are\s+greater|disadvantages\s+are\s+greater)\b/i.test(source),
    exampleSupport: /\b(for\s+example|for\s+instance|such\s+as|a\s+good\s+example|to\s+illustrate)\b/i.test(source),
    explanationMarkers: countPattern(source, /\b(because|therefore|as\s+a\s+result|this\s+means|this\s+can|this\s+will|so\s+that|which\s+means|for\s+this\s+reason)\b/gi)
  };
}

function auditTask2Requirements(body = {}, signals = {}) {
  const essay = String(body.essay || "");
  const profile = signals.task2QuestionProfile || inferTask2Profile(body.questionPrompt || body.promptText || body.prompt || "");
  const markers = detectTask2RequirementSignals(essay);
  const items = [];
  const addItem = (requirement, status, evidence, issue, capIfProblem = 5.5) => {
    items.push({ index: items.length + 1, requirement, status, evidence: evidence || "No clear direct evidence found.", issue, capIfProblem: status === "covered" ? null : capIfProblem });
  };
  const evidence = (regex) => firstMatchingSentence(essay, regex) || "No clear direct evidence found.";
  const questionCount = Number(profile.questionCount) || (Array.isArray(profile.directQuestions) ? profile.directQuestions.length : 0);
  const directQuestions = Array.isArray(profile.directQuestions) ? profile.directQuestions : [];

  if (profile.bothSidesRequired) {
    addItem("discuss both views", markers.viewOne && markers.viewTwo ? "covered" : (markers.viewOne || markers.viewTwo ? "partly_covered" : "missing"), evidence(/\b(some people|other people|others|on the one hand|on the other hand|however|whereas|while)\b/i), "Discuss-both-views essays must clearly cover both sides, not only one side.", 5.0);
  }
  if (profile.positionRequired) {
    addItem("state a clear position or judgement", markers.clearOpinion || markers.outweighJudgement || markers.positiveNegativeJudgement || markers.implicitJudgement ? "covered" : "missing", evidence(/\b(i agree|i disagree|i believe|i think|in my opinion|positive|negative|outweigh|overall|good entertainment|help people relax|not suitable|watched sensibly)\b/i), "This question type requires a clear position or judgement.", 5.5);
  }
  if (profile.advantageRequired) {
    addItem("cover advantages/benefits", markers.advantage ? "covered" : "missing", evidence(/\b(advantage|benefit|positive|improve|save|helpful|opportunity|convenient)\b/i), "The advantages/benefits side is required by this prompt.", 5.0);
  }
  if (profile.disadvantageRequired) {
    addItem("cover disadvantages/drawbacks", markers.disadvantage ? "covered" : "missing", evidence(/\b(disadvantage|drawback|negative|problem|harmful|risk|cost|waste|damage)\b/i), "The disadvantages/drawbacks side is required by this prompt.", 5.0);
  }
  if (profile.outweighRequired) {
    addItem("state whether one side outweighs the other", markers.outweighJudgement ? "covered" : "missing", evidence(/\b(outweigh|more important|greater|more benefits|more drawbacks|advantages are greater|disadvantages are greater)\b/i), "Outweigh questions require a comparative judgement, not only a list of pros and cons.", 5.5);
  }
  if (profile.causeRequired) {
    addItem("explain causes/reasons", markers.cause ? "covered" : "missing", evidence(/\b(cause|reason|because|due to|result from|lead to)\b/i), "Cause/reason discussion is required by this prompt.", 5.0);
  }
  if (profile.problemRequired) {
    addItem("explain problems/issues", markers.problem ? "covered" : "missing", evidence(/\b(problem|issue|challenge|difficulty|risk|concern)\b/i), "Problem/issue discussion is required by this prompt.", 5.0);
  }
  if (profile.solutionRequired) {
    addItem("suggest solutions/measures", markers.solution ? "covered" : "missing", evidence(/\b(solution|solve|measure|should|need to|must|government should|people should|companies should)\b/i), "Solutions/measures are required by this prompt.", 5.0);
  }
  if (profile.positiveNegativeRequired) {
    addItem("judge whether the development is positive or negative", markers.positiveNegativeJudgement ? "covered" : "missing", evidence(/\b(positive|negative|beneficial|harmful|good development|bad development|mainly positive|mainly negative)\b/i), "Positive/negative development questions require a clear judgement.", 5.5);
  }

  const questions = directQuestions.length ? directQuestions : (String(body.questionPrompt || body.promptText || body.prompt || "").match(/[^?]+\?/g) || []).map((x) => x.trim()).filter(Boolean);
  if (questionCount >= 2 || questions.length >= 2 || profile.twoPartQuestion) {
    const paraCount = Number(signals.paragraphCount) || countParagraphs(essay);
    const basicCoverage = (markers.explanationMarkers >= 1 || markers.exampleSupport || markers.implicitJudgement || markers.clearOpinion || markers.positiveNegativeJudgement || markers.outweighJudgement) && (Number(signals.wordCount) >= 120 || paraCount >= 2 || Number(signals.sentenceCount) >= 4);
    const enoughSeparateTreatment = paraCount >= Math.min((questionCount || questions.length) + 1, 4) || markers.explanationMarkers >= Math.max(1, questionCount || questions.length) || basicCoverage;
    addItem("answer all direct question parts", enoughSeparateTreatment ? "covered" : (basicCoverage ? "partly_covered" : "missing"), evidence(/\b(because|therefore|for example|firstly|secondly|in conclusion|good entertainment|help people relax|not suitable|watched sensibly)\b/i), "Two-part questions must answer each direct question, but a basic complete response should not be treated as off-topic just because the development is simple.", 5.5);
  }

  const words = Number(signals.wordCount) || countWords(essay);
  const sentenceCount = Number(signals.sentenceCount) || sentenceUnits(essay).length;
  const paragraphCount = Number(signals.paragraphCount) || countParagraphs(essay);
  const realDevelopment = words >= (profile.twoPartQuestion ? 150 : 230) && paragraphCount >= 3 && sentenceCount >= (profile.twoPartQuestion ? 5 : 8) && (markers.exampleSupport || markers.explanationMarkers >= (profile.twoPartQuestion ? 2 : 3) || markers.implicitJudgement);
  if (!realDevelopment) {
    const basicDevelopment = words >= (profile.twoPartQuestion ? 100 : 180) && sentenceCount >= (profile.twoPartQuestion ? 4 : 6) && (markers.explanationMarkers >= 1 || markers.exampleSupport || markers.implicitJudgement || markers.clearOpinion || markers.positiveNegativeJudgement || markers.outweighJudgement);
    addItem("develop ideas with explanation and support", basicDevelopment ? "partly_covered" : "missing", evidence(/\b(for example|such as|because|therefore|this means|as a result|good entertainment|help people relax|not suitable|watched sensibly)\b/i), "Band 6+ Task Response needs real development, but a basic complete answer should not be treated as missing task response merely because the ideas are simple.", words < (profile.twoPartQuestion ? 160 : 180) ? 5.0 : 5.5);
  }

  const missingCount = items.filter((item) => item.status === "missing").length;
  const partlyCount = items.filter((item) => item.status === "partly_covered").length;
  const severeMissing = items.filter((item) => item.status === "missing" && item.capIfProblem <= 5.0).length;
  let taskResponseCap = null;
  if (severeMissing >= 1) taskResponseCap = 5.0;
  else if (missingCount >= 1 || partlyCount >= 2) taskResponseCap = 5.5;
  else if (partlyCount === 1) taskResponseCap = 6.0;
  return {
    version: "task2-question-type-audit-v8-1",
    task: "Task 2",
    questionType: profile.questionType,
    requiredParts: profile.requiredParts || [],
    questionCount: questionCount || questions.length || 0,
    directQuestions: questions,
    twoPartQuestion: Boolean(profile.twoPartQuestion || (questionCount >= 2) || questions.length >= 2),
    markers,
    items,
    missingCount,
    partlyCount,
    taskResponseCap,
    triggered: Number.isFinite(taskResponseCap),
    summary: Number.isFinite(taskResponseCap)
      ? `Task 2 question-type audit capped Task Response at Band ${taskResponseCap.toFixed(1)} because ${missingCount} required part(s) are missing and ${partlyCount} are only partly covered.`
      : "All detected Task 2 question-type requirements appear covered by local audit."
  };
}

function buildTaskRequirementAudit(body = {}, signals = {}) {
  return signals.task === "Task 1" ? auditTask1Requirements(body, signals) : auditTask2Requirements(body, signals);
}

function countPattern(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function localSignals(body) {
  const essay = String(body.essay || "");
  const task = normalizeRequestedTask(body);
  const words = Number(body.wordCount) || countWords(essay);
  const paragraphs = countParagraphs(essay);
  const sentences = sentenceUnits(essay);
  const totalTokens = (essay.match(/\S+/g) || []).length;
  const englishTokens = (essay.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
  const englishRatio = totalTokens ? englishTokens / totalTokens : 0;

  const spellingList = ["nowdays", "nowdays", "posiible", "improtant", "furture", "proformence", "deepends", "themslves", "caryfully", "recieve", "recived", "becuase", "becasue", "wich", "enviroment", "goverment", "seperate", "definately", "untill", "frist", "seondly", "wirting", "perpare", "complet", "homewrok", "crouse", "resterants", "restraunts", "resturant", "meun", "performence", "perfomance", "costumer", "costumers", "oppertunity", "responsiblity", "convinient", "developement", "benifit", "benifits", "neccessary", "sucess", "sucessful"];
  const spellingHits = spellingList.map((word) => ({ item: word, count: countPattern(essay, new RegExp(`\\b${word}\\b`, "gi")) })).filter((x) => x.count);
  const spellingIssueCount = spellingHits.reduce((sum, x) => sum + x.count, 0);

  const grammarPatterns = [
    { label: "verb form after subordinator", regex: /\b(when|if|because|although)\s+[a-z]+\s+(using|doing|having|going|looking|paying)\b/gi },
    { label: "incorrect infinitive pattern", regex: /\bneed\s+to\s+[a-z]+ing\b/gi },
    { label: "missing subject after clause", regex: /\bif\s+[^.!?]{0,80},\s*(may|can|will|should|would)\b/gi },
    { label: "comparative error", regex: /\bmuch\s+comfortable\b/gi },
    { label: "missing be / comparison control", regex: /\b\w+\s+never\s+(important|better|worse|good|bad)\s+than\b/gi },
    { label: "gerund/parallel pattern", regex: /\busing\s+[^.!?]{0,60}\s+or\s+pay\s+for\b/gi },
    { label: "article/plural/control phrase", regex: /\b(some of beauty products|using beauty product|facing customer|at working days|at now)\b/gi },
    { label: "awkward request structure", regex: /\b(to want to ask you for if|ask you for if|wish you can|waiting for you feedback)\b/gi },
    { label: "missing infinitive after tell/ask", regex: /\b(told me attend|tell me attend|ask me attend|told me go|tell me go)\b/gi },
    { label: "incorrect preposition/control", regex: /\b(attend to class|at morning|at night shift|benefit for our|bring some benefit for|benefit for my employer)\b/gi },
    { label: "sentence boundary / run-on signal", regex: /\b(it can'?t affect my work at morning|after i finish[^.!?]{0,100}and also|after that,?\s+it[^.!?]{0,80}i can)\b/gi }
  ];
  const grammarHits = grammarPatterns.map((item) => ({ label: item.label, count: countPattern(essay, item.regex) })).filter((x) => x.count);
  const grammarIssueCount = grammarHits.reduce((sum, x) => sum + x.count, 0);
  const weakPhraseHits = [
    { label: "vague good/bad phrasing", regex: /\b(good thing|bad thing)\b/gi },
    { label: "awkward collocation", regex: /\b(pay treatments|using products or pay treatments|have they own judgement)\b/gi },
    { label: "unnatural time/place phrase", regex: /\b(at now|at working days|looking younger at future|look beautiful at now)\b/gi }
  ].map((item) => ({ label: item.label, count: countPattern(essay, item.regex) })).filter((x) => x.count);
  const weakPhraseCount = weakPhraseHits.reduce((sum, x) => sum + x.count, 0);
  const per100 = words ? 100 / words : 0;
  const spellingDensity = words ? Number((spellingIssueCount * per100).toFixed(2)) : 0;
  const grammarDensity = words ? Number((grammarIssueCount * per100).toFixed(2)) : 0;
  const spellingErrorDensity = spellingIssueCount >= 6 || spellingDensity >= 2.2 ? "high" : spellingIssueCount >= 3 ? "moderate" : spellingIssueCount > 0 ? "low" : "none";
  const grammarErrorDensity = grammarIssueCount >= 5 || grammarDensity >= 1.7 ? "high" : grammarIssueCount >= 2 ? "moderate" : grammarIssueCount > 0 ? "low" : "none";
  const lexicalNaturalnessRisk = weakPhraseCount >= 3 ? "high" : weakPhraseCount >= 1 ? "moderate" : "low";
  const sentenceControl = grammarErrorDensity === "high" ? "weak" : grammarErrorDensity === "moderate" ? "basic" : "adequate_or_better";
  const lexicalControl = spellingErrorDensity === "high" || lexicalNaturalnessRisk === "high" ? "weak" : spellingErrorDensity === "moderate" || lexicalNaturalnessRisk === "moderate" ? "basic" : "adequate_or_better";

  const rawHardZeroGate = detectHardZeroResponse(body, { task, wordCount: words });
  const hardZeroGate = downgradeSoftHardZeroGate(rawHardZeroGate);
  let rateabilityStatus = "weak_but_rateable";
  if (isStrictHardZeroGate(hardZeroGate) || !essay.trim() || (task === "Task 1" ? words < 50 : words < 80) || englishRatio < 0.35 || sentences.length === 0) rateabilityStatus = "not_rateable_or_severely_limited";
  else if (words >= (task === "Task 1" ? 120 : 180) && paragraphs >= 2 && sentences.length >= 5) rateabilityStatus = "clearly_rateable";

  const task1BulletPoints = task === "Task 1" ? extractTask1Bullets(body.questionPrompt || body.promptText || "") : [];
  const task2QuestionProfile = task === "Task 2" ? inferTask2Profile(body.questionPrompt || body.promptText || "") : null;
  const baseSignals = {
    task, wordCount: words, paragraphCount: paragraphs, sentenceCount: sentences.length, englishRatio: Number(englishRatio.toFixed(2)), rateabilityStatus, hardZeroGate,
    recommendedMinimum: task === "Task 1" ? 150 : 250,
    spellingIssueCount, spellingDensityPer100Words: spellingDensity, spellingErrorDensity, spellingExamples: spellingHits.slice(0, 10),
    grammarIssueSignalCount: grammarIssueCount, grammarDensityPer100Words: grammarDensity, grammarErrorDensity, grammarIssueSignals: grammarHits.slice(0, 10),
    weakPhraseCount, lexicalNaturalnessRisk, weakPhraseSignals: weakPhraseHits.slice(0, 10), sentenceControl, lexicalControl,
    task1BulletPoints,
    task2QuestionProfile
  };
  return { ...baseSignals, taskRequirementAudit: buildTaskRequirementAudit(body, baseSignals) };
}

function criterionNames(task) {
  return task === "Task 1"
    ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
}

function bandNumber(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 2) / 2;
  if (rounded < 0 || rounded > 9) return null;
  return rounded;
}

function roundHalf(value) {
  return Math.round(Number(value) * 2) / 2;
}

function averageBand(criteria) {
  const values = Object.values(criteria || {}).map(bandNumber).filter((n) => Number.isFinite(n));
  if (values.length !== 4) return { rawAverage: null, finalBand: null };
  const rawAverage = values.reduce((a, b) => a + b, 0) / 4;
  return { rawAverage, finalBand: roundHalf(rawAverage) };
}

function hasTask1WorkingHoursRequirement(body = {}) {
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || "");
  return /\b(which hours|what hours|hours you would like to work|working hours|reduce your working hours|work schedule|shift)\b/i.test(prompt);
}

function hasSpecificWorkHoursOrShift(text = "") {
  const source = String(text || "").toLowerCase();
  return /\b(\d{1,2}\s*(?:am|pm)|\d{1,2}\s*[-–]\s*\d{1,2}|from\s+\d{1,2}\s*(?:am|pm)?\s+to\s+\d{1,2}\s*(?:am|pm)?|before\s+\d{1,2}|after\s+\d{1,2}|morning shift|afternoon shift|evening shift|night shift|day shift|weekends?|weekdays?|three days a week|part[- ]time hours)\b/i.test(source);
}

function sub7RunOnSignal(text = "") {
  const sentences = sentenceUnits(text);
  const longSentences = sentences.filter((s) => countWords(s) >= 34).length;
  const boundaryBreaks = countPattern(text, /\b(After that|Because|So)\b[^.!?]{35,}\b(i|I|we|they|he|she|it|this|that)\b/gi);
  const gluedClauses = countPattern(text, /\b(at morning|after class|after that)[^.!?]{0,120}\b(i can|I can|it can|It can|we can)\b/gi);
  return { longSentences, boundaryBreaks, gluedClauses, total: longSentences + boundaryBreaks + gluedClauses };
}

function applyLocalRegressionCalibration(criteria = {}, signals = {}, anchorComparison = {}, body = {}) {
  return {
    criteria: { ...(criteria || {}) },
    changed: false,
    notes: [{
      type: "ai_only_local_regression_calibration_disabled",
      reason: "v8.5.0 AI-only core: all local cap/floor/regression calibration is disabled. Final bands must come only from AI core scoring or AI boundary review."
    }]
  };
}

function stableJsonParse(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("AI did not return valid JSON.");
}

async function callDeepSeekContent(messages, maxTokens = 5000, temperature = 0) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY environment variable.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: DEFAULT_MODEL, temperature, max_tokens: maxTokens, response_format: { type: "json_object" }, messages }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek HTTP ${response.status}`);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek returned an empty response.");
    return content;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("DeepSeek request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildJsonRepairPrompt(rawContent, parseError) {
  return [
    "You are a JSON repair engine. Return JSON only.",
    "The previous IELTS scoring model returned malformed JSON. Repair the JSON syntax only.",
    "Do not change any scores, bands, explanations, evidence, anchor decisions, boundary decisions, or meanings.",
    "If a string contains quote marks from the essay, use single quotes inside the string or escape double quotes correctly.",
    "Remove trailing prose, markdown fences, comments, invalid control characters, and dangling commas.",
    `Parse error: ${String(parseError?.message || parseError || "unknown parse error")}`,
    `Malformed content:\n${String(rawContent || "").slice(0, 60000)}`
  ].join("\n\n");
}

async function callDeepSeek(messages, maxTokens = 5000, temperature = 0) {
  const content = await callDeepSeekContent(messages, maxTokens, temperature);
  try {
    return stableJsonParse(content);
  } catch (firstError) {
    try {
      const repairedContent = await callDeepSeekContent([
        { role: "system", content: "You repair malformed JSON. Return valid JSON only and never alter the scoring meaning." },
        { role: "user", content: buildJsonRepairPrompt(content, firstError) }
      ], Math.min(5000, Math.max(1800, Math.floor(maxTokens * 0.65))), 0);
      const repaired = stableJsonParse(repairedContent);
      repaired.__jsonRepairApplied = true;
      return repaired;
    } catch (repairError) {
      const error = new Error(`AI returned malformed JSON and repair failed. Original parse error: ${firstError.message}; repair error: ${repairError.message}`);
      error.name = "MalformedAiJsonError";
      throw error;
    }
  }
}


function anchorSetForTask(task) {
  return task === "Task 1" ? TASK1_BAND_ANCHORS_0_TO_9 : TASK2_BAND_ANCHORS_0_TO_9;
}

function gateRulesForTask(task) {
  return task === "Task 1" ? TASK1_GATE_RULES : TASK2_GATE_RULES;
}

function taskRuleLabel(task) {
  return task === "Task 1" ? "GT Task 1 Letter anchor-calibrated rules" : "GT Task 2 Essay anchor-calibrated rules";
}

function independentFallbackAnchorBand(task, signals = {}) {
  const words = Number(signals.wordCount) || 0;
  if (signals.rateabilityStatus === "not_rateable_or_severely_limited") {
    if (words === 0) return 0;
    if (words < 50) return 2;
    if (words < 80) return 3;
  }
  if (task === "Task 1") {
    if (words < 50) return 2;
    if (words < 80) return 3;
    if (words < 120) return 4;
    if (words < 150) return 5;
    return 6;
  }
  if (words < 50) return 2;
  if (words < 80) return 3;
  if (words < 120) return 4;
  if (words < 150) return 4;
  if (words < 180) return 5;
  return 6;
}

function defaultAnchorComparison(task, criteria = {}, signals = {}) {
  const closest = independentFallbackAnchorBand(task, signals);
  const lower = Math.max(0, closest - 1);
  const higher = Math.min(9, closest + 1);
  const anchor = anchorSetForTask(task).find((item) => item.band === closest) || anchorSetForTask(task)[0];
  return {
    task,
    anchorSystem: `${taskRuleLabel(task)} (local fallback only; AI independent anchor required)`,
    closestAnchorBand: closest,
    lowerAnchorBand: lower,
    higherAnchorBand: higher,
    closestAnchorProfile: anchor?.profile || "",
    closestAnchorProfileZh: anchor?.zh || "",
    anchorSource: "local_fallback_missing_ai_anchor",
    anchorMissing: true,
    whyCloserToThisBand: `AI did not return an independent anchor comparison. The server used only local task/length/rateability signals as a fallback and requires boundary review before freezing if this conflicts with criterion bands.`,
    whyCloserToThisBandZh: `AI 没有返回独立锚点对比。本地仅根据任务类型、字数和可评分性做兜底判断；如果与四项分数冲突，必须进入边界复核后才能冻结。`,
    whyNotLowerAnchor: `No lower-anchor decision was returned by AI; this must be supplied by the scoring/review model, not inferred from the final score.`,
    whyNotLowerAnchorZh: `AI 没有返回低一档解释；这一项应由评分/复核模型给出，不能由最终分数反推。`,
    whyNotHigherAnchor: `No higher-anchor decision was returned by AI; this must be supplied by the scoring/review model, not inferred from the final score.`,
    whyNotHigherAnchorZh: `AI 没有返回高一档解释；这一项应由评分/复核模型给出，不能由最终分数反推。`
  };
}

function hasUsableAnchorComparison(raw) {
  if (!raw || typeof raw !== "object") return false;
  const closest = Number(raw.closestAnchorBand ?? raw.closestAnchor);
  return Number.isFinite(closest) && String(raw.whyCloserToThisBand || raw.anchorComparison || raw.whyNotHigherAnchor || raw.whyNotLowerAnchor || "").trim().length > 0;
}

function normalizeAnchorComparison(raw, task, criteria, signals) {
  const fallback = defaultAnchorComparison(task, criteria, signals);
  const source = raw && typeof raw === "object" ? raw : {};
  const provided = hasUsableAnchorComparison(source);
  const sourceClosest = Number(source.closestAnchorBand ?? source.closestAnchor);
  const closest = provided && Number.isFinite(sourceClosest) ? Math.max(0, Math.min(9, Math.round(sourceClosest))) : fallback.closestAnchorBand;
  const lower = Number.isFinite(Number(source.lowerAnchorBand ?? source.lowerAnchor)) ? Math.max(0, Math.min(9, Math.round(Number(source.lowerAnchorBand ?? source.lowerAnchor)))) : Math.max(0, closest - 1);
  const higher = Number.isFinite(Number(source.higherAnchorBand ?? source.higherAnchor)) ? Math.max(0, Math.min(9, Math.round(Number(source.higherAnchorBand ?? source.higherAnchor)))) : Math.min(9, closest + 1);
  const anchor = anchorSetForTask(task).find((item) => item.band === closest) || {};
  return {
    ...fallback,
    ...source,
    task,
    anchorSystem: source.anchorSystem || (provided ? taskRuleLabel(task) : fallback.anchorSystem),
    closestAnchorBand: closest,
    lowerAnchorBand: lower,
    higherAnchorBand: higher,
    anchorSource: provided ? "ai_independent_anchor" : "local_fallback_missing_ai_anchor",
    anchorMissing: !provided,
    closestAnchorProfile: String(source.closestAnchorProfile || anchor.profile || fallback.closestAnchorProfile || "").trim(),
    closestAnchorProfileZh: String(source.closestAnchorProfileZh || anchor.zh || fallback.closestAnchorProfileZh || "").trim(),
    whyCloserToThisBand: String(source.whyCloserToThisBand || source.anchorComparison || fallback.whyCloserToThisBand).trim(),
    whyCloserToThisBandZh: String(source.whyCloserToThisBandZh || fallback.whyCloserToThisBandZh || "").trim(),
    whyNotLowerAnchor: String(source.whyNotLowerAnchor || fallback.whyNotLowerAnchor).trim(),
    whyNotLowerAnchorZh: String(source.whyNotLowerAnchorZh || fallback.whyNotLowerAnchorZh || "").trim(),
    whyNotHigherAnchor: String(source.whyNotHigherAnchor || fallback.whyNotHigherAnchor).trim(),
    whyNotHigherAnchorZh: String(source.whyNotHigherAnchorZh || fallback.whyNotHigherAnchorZh || "").trim()
  };
}

function normalizeGate(raw, fallbackReason, triggered = false) {
  const source = raw && typeof raw === "object" ? raw : {};
  const localTriggered = Boolean(triggered);
  const aiStatus = source.status || source.result;
  return {
    status: localTriggered ? "triggered" : (aiStatus || "passed"),
    localTriggered,
    aiStatus: aiStatus || "",
    reason: String(source.reason || source.explanation || source.note || fallbackReason || "Gate checked.").trim(),
    reasonZh: String(source.reasonZh || source.explanationZh || source.noteZh || "").trim(),
    evidence: Array.isArray(source.evidence) ? source.evidence : []
  };
}


function getWordCountBoundaryProfile(task, words) {
  const w = Number(words) || 0;
  if (task === "Task 1") {
    if (w === 0) return { triggered: true, category: "blank", suggestedRange: "Band 0", lower: 0, upper: 0, severity: "extreme", reason: "Task 1 is blank or has no countable words." };
    if (w < 20) return { triggered: true, category: "minimal_letter", suggestedRange: "Band 0-2.0", lower: 0, upper: 2, severity: "extreme", reason: `Task 1 has only ${w} words; only isolated words/fragments can normally be assessed.` };
    if (w < 50) return { triggered: true, category: "very_short_letter", suggestedRange: "Band 1.5-3.5", lower: 1.5, upper: 3.5, severity: "severe", reason: `Task 1 has ${w} words; letter purpose and bullet coverage are likely severely limited.` };
    if (w < 80) return { triggered: true, category: "short_letter_limited_detail", suggestedRange: "Band 3.0-4.5, or 5.0 only if most bullets are clear", lower: 3, upper: 5, severity: "high", reason: `Task 1 has ${w} words; it is short, but a concise letter may still be rateable if bullets are clear.` };
    if (w < 120) return { triggered: true, category: "below_recommended_letter_length", suggestedRange: "Band 4.0-6.0 depending on bullet detail", lower: 4, upper: 6, severity: "moderate", reason: `Task 1 has ${w} words, below 150; check bullet development, not word count alone.` };
    if (w < 150) return { triggered: true, category: "slightly_below_recommended_letter_length", suggestedRange: "Band 5.0-7.0 depending on task fulfilment", lower: 5, upper: 7, severity: "watch", reason: `Task 1 has ${w} words; it can still score well if all bullets are naturally covered.` };
    return { triggered: false, category: "normal_letter_length", suggestedRange: "No word-count low-band boundary", lower: 0, upper: 9, severity: "none", reason: `Task 1 word count ${w} is in or above the normal range.` };
  }
  if (w === 0) return { triggered: true, category: "blank", suggestedRange: "Band 0", lower: 0, upper: 0, severity: "extreme", reason: "Task 2 is blank or has no countable words." };
  if (w < 20) return { triggered: true, category: "minimal_response", suggestedRange: "Band 0-2.0", lower: 0, upper: 2, severity: "extreme", reason: `Task 2 has only ${w} words; only fragments can normally be assessed.` };
  if (w < 50) return { triggered: true, category: "very_short_rateable", suggestedRange: "Band 1.5-3.0", lower: 1.5, upper: 3, severity: "severe", reason: `Task 2 has ${w} words; it is too short for developed essay response.` };
  if (w < 80) return { triggered: true, category: "severe_underlength_but_rateable", suggestedRange: "Band 2.5-3.5", lower: 2.5, upper: 3.5, severity: "high", reason: `Task 2 has ${w} words; development evidence is severely limited.` };
  if (w < 120) return { triggered: true, category: "underlength_limited_development", suggestedRange: "Band 3.0-4.0, or 4.5 only with unusually clear relevance", lower: 3, upper: 4.5, severity: "high", reason: `Task 2 has ${w} words; task response and development are likely limited.` };
  if (w < 150) return { triggered: true, category: "short_response", suggestedRange: "Band 3.5-5.0 depending on development", lower: 3.5, upper: 5, severity: "moderate", reason: `Task 2 has ${w} words; 5.0+ needs clear development evidence.` };
  if (w < 180) return { triggered: true, category: "below_recommended_essay_length", suggestedRange: "Band 4.0-5.5 depending on development", lower: 4, upper: 5.5, severity: "moderate", reason: `Task 2 has ${w} words; it is short, but a coherent answer can still be mid-band.` };
  if (w < 230) return { triggered: true, category: "development_risk", suggestedRange: "Band 4.5-6.5 depending on response depth", lower: 4.5, upper: 6.5, severity: "watch", reason: `Task 2 has ${w} words; check development depth before 6.0+, but do not cap by word count alone.` };
  return { triggered: false, category: "normal_essay_length", suggestedRange: "No word-count low-band boundary", lower: 0, upper: 9, severity: "none", reason: `Task 2 word count ${w} is in or near the normal IELTS range.` };
}


function getLocalBandBoundaryProfile(signals = {}) {
  const task = signals.task === "Task 1" ? "Task 1" : "Task 2";
  const wordBoundary = getWordCountBoundaryProfile(task, signals.wordCount);
  const languageWeak = signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high" || signals.lexicalControl === "weak" || signals.sentenceControl === "weak";
  const languageModerate = signals.grammarErrorDensity === "moderate" || signals.spellingErrorDensity === "moderate" || signals.lexicalControl === "basic" || signals.sentenceControl === "basic";
  const highBandEligible = !wordBoundary.triggered && !languageWeak && signals.rateabilityStatus === "clearly_rateable";
  const lowBandRisk = wordBoundary.triggered || signals.rateabilityStatus === "not_rateable_or_severely_limited";
  const midBandRisk = !lowBandRisk && (languageWeak || languageModerate || signals.rateabilityStatus !== "clearly_rateable");
  const likelyZone = lowBandRisk
    ? (task === "Task 1" ? "Task 1 low-band or low-mid boundary; bullet/purpose/tone detail must justify any score above the suggested range." : "Task 2 low-band or low-mid boundary; development and language evidence must justify any score above the suggested range.")
    : highBandEligible
      ? (task === "Task 1" ? "Task 1 high-band can be considered if all bullets are fully developed and register is precise." : "Task 2 high-band can be considered if reasoning is mature, cohesive and language control is strong.")
      : "Mid-band boundary: complete but limited writing needs criterion-specific evidence before 5.5/6.0+.";
  return {
    task,
    wordBoundary,
    languageWeak,
    languageModerate,
    highBandEligible,
    lowBandRisk,
    midBandRisk,
    likelyZone,
    languageProfile: {
      spellingErrorDensity: signals.spellingErrorDensity,
      grammarErrorDensity: signals.grammarErrorDensity,
      lexicalControl: signals.lexicalControl,
      sentenceControl: signals.sentenceControl,
      weakPhraseCount: signals.weakPhraseCount
    }
  };
}

function scoreValues(criteria) {
  return Object.values(criteria || {}).map(Number).filter(Number.isFinite);
}

function allCriteriaSame(criteria) {
  const values = scoreValues(criteria);
  return values.length === 4 && values.every((x) => x === values[0]);
}

function buildLocalLogicAudit() {
  return {
    usedForScoring: false,
    usedForRoutingOnly: true,
    adjustedOverallBand: false,
    adjustedCriterionScores: false,
    appliedLocalFloor: false,
    appliedLocalCap: false,
    copiedOverallToCriteria: false,
    notes: "Local logic only handled routing, hard invalid detection, hard lowband gate, JSON validation and audit."
  };
}

function buildCriterionDifferentiationAudit(criteria = {}, feedbackSource = "ai-specific-feedback") {
  const same = allCriteriaSame(criteria);
  return {
    criteriaAllEqual: same,
    overallCopiedToCriteria: false,
    criterionScoresSource: "ai",
    criterionFeedbackSource: feedbackSource,
    reason: same
      ? "The AI returned identical criterion bands; local code did not copy overallBand to criteria."
      : "Criterion scores and comments were generated independently by AI."
  };
}

function noWeakLocalLanguage(signals = {}) {
  return signals.grammarErrorDensity !== "high" && signals.spellingErrorDensity !== "high" && signals.lexicalControl !== "weak" && signals.sentenceControl !== "weak";
}

function detectHighBandCandidate(criteria, signals = {}, anchor = {}, calibration = {}) {
  const values = scoreValues(criteria);
  const avg = averageBand(criteria).finalBand;
  const allSeven = values.length === 4 && values.every((x) => x === 7);
  const allAtLeastSeven = values.length === 4 && values.every((x) => x >= 7);
  const anchorBand = Number(anchor.closestAnchorBand);
  const calibrationText = JSON.stringify(calibration || {});
  const highSignalText = /fully|mature|natural|precise|flexible|rare errors|negligible errors|strong grammatical control|sophisticated|fluent/i.test(calibrationText);
  const normalLength = signals.task === "Task 1" ? Number(signals.wordCount) >= 150 : Number(signals.wordCount) >= 230;
  const triggered = Boolean((allSeven || (allAtLeastSeven && avg <= 7.5) || anchorBand >= 8 || highSignalText) && normalLength && noWeakLocalLanguage(signals));
  return {
    triggered,
    allSeven,
    allAtLeastSeven,
    anchorBand,
    highSignalText,
    normalLength,
    reason: triggered
      ? "High-band boundary review required: the score profile may be capped around Band 7 despite high-band signals or all-four-7 pattern."
      : "No forced high-band boundary review from local signals."
  };
}

function normalizeTaskSpecificGate(raw, signals, criteria = {}, anchor = {}, calibration = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const task = signals.task;
  const words = Number(signals.wordCount) || 0;
  const wordBoundary = getWordCountBoundaryProfile(task, words);
  const highCandidate = detectHighBandCandidate(criteria, signals, anchor, calibration);
  if (task === "Task 1") {
    const bullets = Array.isArray(signals.task1BulletPoints) ? signals.task1BulletPoints : [];
    const firstName = criterionNames(task)[0];
    const ta = Number(criteria[firstName]);
    return {
      bulletCoverageGate: normalizeGate(source.bulletCoverageGate || source.bulletCoverage, `Task 1 bullet coverage must be explicit. Extracted bullets: ${bullets.length ? bullets.join(" | ") : "no explicit bullets extracted"}. Missing one or more bullets must constrain Task Achievement.`, Boolean(bullets.length && ta >= 6 && words < 150)),
      purposeClarityGate: normalizeGate(source.purposeClarityGate || source.purposeClarity, "Task 1 purpose clarity checked; unclear purpose normally prevents a high Task Achievement score.", false),
      toneRegisterGate: normalizeGate(source.toneRegisterGate || source.toneRegister, "Task 1 tone/register checked against recipient relationship and letter purpose; wrong tone constrains TA and LR.", false),
      letterCompletenessGate: normalizeGate(source.letterCompletenessGate || source.letterCompleteness, "Letter completeness checked: greeting/opening purpose/body details/closing/request or thanks/sign-off.", false),
      wordCountGuard: normalizeGate(source.wordCountGuard, `${wordBoundary.reason} Suggested range: ${wordBoundary.suggestedRange}.`, wordBoundary.triggered),
      highBandUnlockGate: normalizeGate(source.highBandUnlockGate || source.highBandUnlock, highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => Number(x) >= 7.5)),
      taskRequirementAuditGate: normalizeGate(source.taskRequirementAuditGate, signals.taskRequirementAudit?.summary || "Task 1 bullet-specific requirement audit completed.", Boolean(signals.taskRequirementAudit?.triggered && !signals.taskRequirementAudit?.midbandAdvisoryOnly))
    };
  }
  return {
    taskResponseDepthGate: normalizeGate(source.taskResponseDepthGate || source.taskResponseDepth, "Task 2 response depth checked: all prompt parts, position, reasons, examples and explanations must be present.", false),
    band6AccessGate: normalizeGate(source.band6AccessGate || source.band6Access, "Band 6 access checked: real development is required; visible structure alone is not enough.", Boolean(words < 230 && Object.values(criteria).some((x) => Number(x) >= 6))),
    lowBandGuard: normalizeGate(source.lowBandGuard, `${wordBoundary.reason} Suggested range: ${wordBoundary.suggestedRange}.`, wordBoundary.triggered || signals.rateabilityStatus === "not_rateable_or_severely_limited"),
    midBandCheck: normalizeGate(source.midBandCheck || source.midBandGate, "Mid-band check applied: do not over-reward paragraphs, basic connectors, or a stated opinion without development.", false),
    highBandUnlockGate: normalizeGate(source.highBandUnlockGate || source.highBandUnlock, highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => Number(x) >= 7.5)),
    scoreProfileCheck: normalizeGate(source.scoreProfileCheck || source.scoreProfileGate, "Score-profile check applied to challenge all-equal bands and TR/CC versus LR/GRA gaps.", allCriteriaSame(criteria)),
    taskRequirementAuditGate: normalizeGate(source.taskRequirementAuditGate, signals.taskRequirementAudit?.summary || "Task 2 question-type requirement audit completed.", Boolean(signals.taskRequirementAudit?.triggered))
  };
}

function stringifyAnchorTable(task) {
  return anchorSetForTask(task).map((item) => `Band ${item.band}: ${item.profile}`).join("\n");
}

function buildIndependentAnchorPrompt(body, signals) {
  const task = signals.task;
  const anchorTable = stringifyAnchorTable(task);
  const taskSpecific = task === "Task 1"
    ? `GT Task 1 letter: judge purpose clarity, bullet coverage, tone/register, letter completeness and language control. Extracted bullets: ${JSON.stringify(signals.task1BulletPoints)}.`
    : `GT Task 2 essay: judge prompt coverage, position, development, examples/reasons, logical progression and language control. Question profile: ${JSON.stringify(signals.task2QuestionProfile)}. If the prompt has two direct questions, each is a required part and a basic complete answer should not be treated as missing task response just because development is simple.`;
  const localBoundaryProfile = getLocalBandBoundaryProfile(signals);
  return [
    "You are an IELTS GT Writing anchor-classification examiner. Return JSON only. Do not assign criterion bands in this stage.",
    `Score system: ${SCORE_SYSTEM_VERSION}. Task: ${task}.`,
    "The selected task is locked by the request. Do not switch Task 1 and Task 2 inside this stage.",
    taskSpecific,
    task === "Task 1" ? `Corrected Task 1 Band 5 anchor:\n${task1CorrectedBand5AnchorText()}` : "",
    `Primary 4.0-6.5 midband calibration for ${task}:\n${midbandCalibrationRulesForTask(task)}`,
    "Your only job is to classify the response against the 0-9 anchor benchmarks before criterion scoring.",
    "This anchor must be independent from final criterion bands; do not infer it from a score because no criterion score exists yet.",
    "High-band rule: if the response is mature, fully developed, naturally cohesive, precise and mostly error-free, you must consider Band 8 or Band 9 anchors. Do not default to Band 7 for safety.",
    "Low-band rule: weak language and shallow development can make a full-length response Band 3/4. Do not lift low-band writing just because it has paragraphs, greeting/closing, or enough words.",
    `v8.5.5 full-scale calibration for ${task}:\n${scoreScaleCalibrationText(task)}`,
    `0-9 anchor benchmarks:\n${anchorTable}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly: {\"ok\":true,\"aiStage\":\"score-anchor\",\"anchorComparison\":{\"anchorSystem\":\"Task-aware independent 0-9 anchor classification\",\"closestAnchorBand\":number,\"lowerAnchorBand\":number,\"higherAnchorBand\":number,\"candidateRange\":\"e.g. 7.5-8.5\",\"closestAnchorProfile\":\".\",\"closestAnchorProfileZh\":\"中文\",\"whyCloserToThisBand\":\".\",\"whyCloserToThisBandZh\":\"中文\",\"whyNotLowerAnchor\":\".\",\"whyNotLowerAnchorZh\":\"中文\",\"whyNotHigherAnchor\":\".\",\"whyNotHigherAnchorZh\":\"中文\",\"highBandCandidate\":boolean,\"lowBandCandidate\":boolean,\"evidence\":[\"short essay quote or feature\"]}}"
  ].join("\n\n");
}

// Removed legacy full score+feedback prompt. Core scoring now uses buildScoreKernelPrompt only.

function criterionKeyAliases(name, task = "Task 2") {
  const normalized = String(name || "").trim();
  const aliases = new Set([normalized, normalized.replace(" and ", " & ")]);
  if (normalized === "Task Achievement") {
    aliases.add("TA");
    aliases.add("taskAchievement");
    aliases.add("task_achievement");
  }
  if (normalized === "Task Response") {
    aliases.add("TR");
    aliases.add("taskResponse");
    aliases.add("task_response");
  }
  if (normalized === "Coherence and Cohesion") {
    aliases.add("CC");
    aliases.add("coherenceCohesion");
    aliases.add("coherence_and_cohesion");
    aliases.add("Coherence & Cohesion");
  }
  if (normalized === "Lexical Resource") {
    aliases.add("LR");
    aliases.add("lexicalResource");
    aliases.add("lexical_resource");
  }
  if (normalized === "Grammatical Range and Accuracy") {
    aliases.add("GRA");
    aliases.add("grammar");
    aliases.add("grammaticalRangeAccuracy");
    aliases.add("grammatical_range_and_accuracy");
  }
  // Important: do not alias Task Achievement to Task Response or vice versa.
  // If the model returns the wrong task criterion, the locked-task scorer must retry instead of silently accepting a cross-task key.
  return [...aliases];
}

function normalizeCriteria(rawCriteria, task) {
  const names = criterionNames(task);
  const source = rawCriteria && typeof rawCriteria === "object" ? rawCriteria : {};
  const out = {};
  names.forEach((name) => {
    const aliases = criterionKeyAliases(name, task);
    const raw = aliases.map((key) => source[key]).find((v) => v !== undefined && v !== null);
    const band = bandNumber(raw);
    if (!Number.isFinite(band)) throw new Error(`AI did not return a valid half-band for ${name}.`);
    if (!VALID_BANDS.includes(band)) throw new Error(`Invalid IELTS band ${band} for ${name}.`);
    out[name] = band;
  });
  return out;
}

function collectScoreWarnings(criteria, signals) {
  const warnings = [];
  const names = criterionNames(signals.task);
  const first = criteria[names[0]];
  const cc = criteria["Coherence and Cohesion"];
  const lr = criteria["Lexical Resource"];
  const gra = criteria["Grammatical Range and Accuracy"];
  const { finalBand } = averageBand(criteria);
  const allSame = Object.values(criteria).every((x) => x === Object.values(criteria)[0]);
  if (allSame) warnings.push("All four criterion bands are identical; examiner evidence must justify this equality.");
  if (signals.task === "Task 1" && signals.task1BulletPoints?.length && first >= 6 && signals.wordCount < 120) warnings.push("Task 1 TA is 6.0+ with low word count; bullet detail and letter completeness must justify this.");
  if (signals.task === "Task 2" && first >= 6 && signals.wordCount < 220) warnings.push("Task 2 TR is 6.0+ with relatively low word count; real development must justify this.");
  if (Object.values(criteria).some((x) => x === 0) && signals.rateabilityStatus !== "not_rateable_or_severely_limited") warnings.push("Band 0 criterion returned for a rateable response; this requires extreme evidence.");
  if (signals.rateabilityStatus === "clearly_rateable" && Object.values(criteria).some((x) => x <= 2)) warnings.push("Clearly rateable response received a Band 1/2 criterion; this would require unusually strong evidence.");
  if (signals.grammarErrorDensity === "high" && gra >= 5) warnings.push("GRA is 5.0+ while grammar error density is high; the examiner must justify this carefully.");
  if ((signals.spellingErrorDensity === "high" || signals.lexicalControl === "weak") && lr >= 5.5) warnings.push("LR is 5.5+ while lexical/spelling signals are weak; the examiner must justify this carefully.");
  if (finalBand >= 5.5 && (signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high") && (lr <= 5 || gra <= 5)) warnings.push("Overall 5.5+ with weak LR/GRA signals can be overgenerous; score-profile gate should be checked.");
  if (first >= 5.5 && cc >= 5.5 && lr <= 4.5 && gra <= 4.5) warnings.push("TR/TA and CC are 5.5 while LR/GRA are weak; confirm that task development and cohesion evidence justify this gap.");
  return warnings;
}


function defaultImproveForCriterion(criterion) {
  if (/Task Response|Task Achievement/i.test(criterion)) return "Develop each main point with a clearer reason and one specific example that directly answers the task.";
  if (/Coherence/i.test(criterion)) return "Improve paragraph-internal progression and make sentence links clearer, not just using basic linking words.";
  if (/Lexical/i.test(criterion)) return "Reduce spelling and word-form errors and use more accurate topic vocabulary and collocations.";
  if (/Grammatical/i.test(criterion)) return "Control basic verb forms, articles, plurals, punctuation, and sentence boundaries before adding more complex structures.";
  return "Strengthen the limiting evidence for this criterion to move 0.5 band higher.";
}

function clampCriterionBand(value) {
  const band = roundHalf(value);
  if (!Number.isFinite(band)) return null;
  return Math.max(1, Math.min(9, band));
}

function criterionBandDelta(baseBand, delta) {
  const next = clampCriterionBand(Number(baseBand) + Number(delta || 0));
  return Number.isFinite(next) ? next : clampCriterionBand(baseBand);
}

function countCueMatches(text, patterns = []) {
  const source = String(text || "");
  return patterns.reduce((total, pattern) => total + countPattern(source, pattern), 0);
}

function buildCriterionAudit(task, criteria = {}, signals = {}, body = {}) {
  const essay = String(body.essay || body.answer || body.response || body.text || "");
  const prompt = String(body.questionPrompt || body.promptText || body.prompt || body.question || "");
  const names = criterionNames(task);
  const taskRequirementAudit = signals.taskRequirementAudit || buildTaskRequirementAudit(body, signals) || null;
  const items = Array.isArray(taskRequirementAudit?.items) ? taskRequirementAudit.items : [];
  const covered = items.filter((item) => item.status === "covered").length;
  const partly = items.filter((item) => item.status === "partly_covered").length;
  const missing = items.filter((item) => item.status === "missing").length;
  const bullets = Array.isArray(signals.task1BulletPoints) ? signals.task1BulletPoints : extractTask1Bullets(prompt);
  const task2Profile = signals.task2QuestionProfile || inferTask2Profile(prompt);
  const questionCount = Number(task2Profile?.questionCount) || (Array.isArray(task2Profile?.directQuestions) ? task2Profile.directQuestions.length : 0);
  const answeredParts = items.filter((item) => item.status === "covered" || item.status === "partly_covered").length;
  const paragraphCount = Number(signals.paragraphCount) || countParagraphs(essay);
  const wordCountValue = Number(signals.wordCount) || countWords(essay);
  const sentenceCount = Number(signals.sentenceCount) || sentenceUnits(essay).length;
  const distinctRatio = distinctWordRatio(essay);
  const connectorCount = countCueMatches(essay, [
    /\b(firstly|secondly|thirdly|however|moreover|furthermore|in conclusion|overall)\b/gi,
    /\b(because|for example|for instance|therefore|as a result|also|when|if|although|while)\b/gi
  ]);

  const task1Complete = task === "Task 1"
    ? (bullets.length ? covered + partly >= bullets.length : missing === 0)
    : false;
  const task2Complete = task === "Task 2"
    ? ((questionCount ? answeredParts >= questionCount : answeredParts >= 1) && Boolean(task2Profile?.twoPartQuestion ? answeredParts >= 2 : true))
    : false;

  const firstName = names[0];
  const secondName = "Coherence and Cohesion";
  const thirdName = "Lexical Resource";
  const fourthName = "Grammatical Range and Accuracy";

  const positive = {
    [firstName]: [],
    [secondName]: [],
    [thirdName]: [],
    [fourthName]: []
  };
  const limiting = {
    [firstName]: [],
    [secondName]: [],
    [thirdName]: [],
    [fourthName]: []
  };
  const outputs = {};

  const taskRequirementCoverage = task === "Task 1"
    ? `Task 1 coverage: ${covered}/${Math.max(1, bullets.length)} bullet(s) covered, ${partly} partly covered, ${missing} missing.`
    : `Task 2 coverage: ${answeredParts}/${Math.max(1, questionCount || items.length || 1)} required part(s) answered, ${partly} partly covered, ${missing} missing.`;

  if (task === "Task 1") {
    positive[firstName].push(
      missing === 0 ? "all bullet points are attempted" : "the letter is still task-related"
    );
    if (covered >= Math.max(2, Math.min(3, bullets.length || 3))) positive[firstName].push("purpose is clear enough to guide the letter");
    if (taskRequirementAudit?.summary) positive[firstName].push(taskRequirementAudit.summary);
    if (partly > 0 || missing > 0) limiting[firstName].push(taskRequirementCoverage);
    if (wordCountValue < 150) limiting[firstName].push(`word count is ${wordCountValue}, so development is constrained`);

    positive[secondName].push(
      paragraphCount >= 3 ? "opening, body and closing are present" : "ideas are separated into readable chunks"
    );
    if (connectorCount >= 2) positive[secondName].push("basic linking devices are used effectively");
    if (paragraphCount <= 2) limiting[secondName].push("paragraphing is thin or compressed");
    if (connectorCount <= 1) limiting[secondName].push("cohesion relies on simple linking only");

    positive[thirdName].push(
      signals.lexicalControl === "adequate_or_better" ? "general letter vocabulary is understandable" : "topic vocabulary is visible"
    );
    if (distinctRatio >= 0.58) positive[thirdName].push("there is some vocabulary variety");
    if (signals.lexicalControl === "weak" || signals.lexicalNaturalnessRisk === "high") limiting[thirdName].push("lexical control is weak or awkward");
    if (distinctRatio < 0.6) limiting[thirdName].push("range is simple and repetition is noticeable");

    positive[fourthName].push(
      signals.grammarErrorDensity === "low" || signals.grammarErrorDensity === "none" ? "meaning is generally clear" : "basic sentence control is visible"
    );
    if (signals.sentenceControl === "adequate_or_better") positive[fourthName].push("simple and some complex forms are mostly controlled");
    if (signals.grammarErrorDensity === "high") limiting[fourthName].push("grammar errors are frequent and limit accuracy");
    if (signals.sentenceControl === "weak") limiting[fourthName].push("sentence control is limited");
  } else {
    positive[firstName].push(
      task2Complete ? "answers both direct questions" : "the response is task-related"
    );
    if (taskRequirementAudit?.markers?.clearOpinion || taskRequirementAudit?.markers?.implicitJudgement || taskRequirementAudit?.markers?.positiveNegativeJudgement || taskRequirementAudit?.markers?.outweighJudgement) {
      positive[firstName].push("a clear opinion or judgement is present");
    }
    if (taskRequirementAudit?.markers?.exampleSupport || taskRequirementAudit?.markers?.explanationMarkers >= 2) positive[firstName].push("reasons are given for the answer");
    if (taskRequirementAudit?.summary) positive[firstName].push(taskRequirementAudit.summary);
    if (!task2Complete || missing > 0 || partly > 0) limiting[firstName].push(taskRequirementCoverage);
    if (wordCountValue < 150) limiting[firstName].push(`development is limited by word count ${wordCountValue}`);

    positive[secondName].push(
      paragraphCount >= 3 ? "clear paragraphing and logical order" : "the response is grouped into readable paragraphs"
    );
    if (connectorCount >= 2) positive[secondName].push("basic cohesive devices are used effectively");
    if (paragraphCount >= 4) positive[secondName].push("progression is easy to follow");
    if (paragraphCount <= 2) limiting[secondName].push("paragraphing is too thin or compressed");
    if (connectorCount <= 1) limiting[secondName].push("cohesion is simple and repetitive");

    positive[thirdName].push(
      signals.lexicalControl === "adequate_or_better" ? "topic vocabulary is understandable" : "word choice is clear enough for the message"
    );
    if (distinctRatio >= 0.58) positive[thirdName].push("there is some lexical range");
    if (signals.lexicalControl === "weak" || signals.lexicalNaturalnessRisk === "high") limiting[thirdName].push("lexical range is limited or repetitive");
    if (distinctRatio < 0.6) limiting[thirdName].push("repetition is noticeable");

    positive[fourthName].push(
      signals.grammarErrorDensity === "low" || signals.grammarErrorDensity === "none" ? "sentence control is mostly clear" : "simple sentence control is functional"
    );
    if (signals.sentenceControl === "adequate_or_better") positive[fourthName].push("there is some use of subordinate clauses");
    if (signals.grammarErrorDensity === "high") limiting[fourthName].push("grammar errors reduce accuracy");
    if (signals.sentenceControl === "weak") limiting[fourthName].push("sentence range and control are limited");
  }

  const baseBands = names.map((name) => Number(criteria?.[name]));
  names.forEach((name) => {
    outputs[name] = {
      band: Number.isFinite(Number(criteria?.[name])) ? Number(criteria[name]) : null,
      positiveEvidence: positive[name].slice(0, 4),
      limitingEvidence: limiting[name].slice(0, 4),
      reason: positive[name].length || limiting[name].length
        ? `${positive[name][0] || "Criterion-specific evidence reviewed."}${limiting[name][0] ? `; limiting: ${limiting[name][0]}` : ""}`
        : "Criterion-specific evidence reviewed."
    };
  });

  return {
    criterionAudit: outputs,
    criterionScoreAudit: {
      allCriteriaSame: allCriteriaSame(criteria),
      sameScoreJustification: allCriteriaSame(criteria)
        ? `All four criteria start from Band ${Number.isFinite(baseBands[0]) ? baseBands[0].toFixed(1) : "-"}. The audit will only separate them if task-response, cohesion, lexis, or grammar evidence clearly differs.`
        : "AI already differentiated the criterion bands.",
      mechanicalCopyDetected: false,
      originalCriteria: { ...(criteria || {}) }
    },
    taskRequirementCoverage
  };
}

function rebalanceMechanicalCriteria(task, criteria = {}, signals = {}, body = {}) {
  const names = criterionNames(task);
  const original = {};
  names.forEach((name) => { original[name] = Number(criteria?.[name]); });
  const audit = buildCriterionAudit(task, original, signals, body);
  return {
    criteria: original,
    criterionAudit: audit.criterionAudit,
    criterionScoreAudit: {
      ...audit.criterionScoreAudit,
      allCriteriaSame: allCriteriaSame(original),
      mechanicalCopyDetected: allCriteriaSame(original),
      originalCriteria: { ...original },
      adjustedCriteria: { ...original },
      spread: 0
    },
    taskRequirementCoverage: audit.taskRequirementCoverage
  };
}


// Detailed feedback quality auditing has been removed from the scoring endpoint.
// The scoring endpoint only freezes bands; /api/criterion-feedback owns feedback quality.

function normalizeCriterionCalibration(rawCalibration, criteria, task) {
  const names = criterionNames(task);
  const source = rawCalibration && typeof rawCalibration === "object" ? rawCalibration : {};
  const out = {};
  names.forEach((name) => {
    const item = criterionKeyAliases(name, task).map((key) => source[key]).find((value) => value && typeof value === "object") || {};
    const band = criteria[name];
    const lower = Math.max(1, band - 0.5);
    const higher = Math.min(9, band + 0.5);
    const half = item.halfBandDecision || {};
    const whyThis = String(item.whyThisBand || item.summary || half.whyExactBand || `Band ${band.toFixed(1)} was selected based on the criterion evidence.`).trim();
    const whyLower = String(item.whyNotLower || half.whyAboveLowerBand || `Not Band ${lower.toFixed(1)} because the response shows enough relevant control for Band ${band.toFixed(1)}.`).trim();
    const whyHigher = String(item.whyNotHigher || half.whyBelowUpperBand || `Not Band ${higher.toFixed(1)} because the limiting evidence prevents a stronger band.`).trim();
    out[name] = {
      ...item,
      band,
      selectedBand: band,
      candidateBandsConsidered: Array.isArray(item.candidateBandsConsidered) && item.candidateBandsConsidered.length ? item.candidateBandsConsidered : [lower, band, higher],
      summary: String(item.summary || whyThis).trim(),
      summaryZh: String(item.summaryZh || "").trim(),
      whyThisBand: whyThis,
      whyThisBandZh: String(item.whyThisBandZh || item.summaryZh || half.whyExactBandZh || "").trim(),
      whyNotLower: whyLower,
      whyAboveLowerBand: String(item.whyAboveLowerBand || item.whyNotLower || half.whyAboveLowerBand || whyLower).trim(),
      whyNotLowerZh: String(item.whyNotLowerZh || item.whyAboveLowerBandZh || half.whyAboveLowerBandZh || "").trim(),
      whyNotHigher: whyHigher,
      whyNotYetHigherBand: String(item.whyNotYetHigherBand || item.whyNotHigher || half.whyBelowUpperBand || whyHigher).trim(),
      whyNotHigherZh: String(item.whyNotHigherZh || item.whyNotYetHigherBandZh || half.whyBelowUpperBandZh || "").trim(),
      howToImprove: String(item.howToImprove || item.improvementFocus || defaultImproveForCriterion(name)).trim(),
      howToImproveZh: String(item.howToImproveZh || item.improvementFocusZh || "").trim(),
      zhSummary: String(item.zhSummary || item.cardZh || item.chineseSummary || "").trim(),
      positiveEvidence: Array.isArray(item.positiveEvidence) ? item.positiveEvidence : [],
      positiveEvidenceZh: Array.isArray(item.positiveEvidenceZh) ? item.positiveEvidenceZh : [],
      limitingEvidence: Array.isArray(item.limitingEvidence) ? item.limitingEvidence : [],
      limitingEvidenceZh: Array.isArray(item.limitingEvidenceZh) ? item.limitingEvidenceZh : [],
      essayEvidence: Array.isArray(item.essayEvidence) ? item.essayEvidence : (Array.isArray(item.evidenceQuotes) ? item.evidenceQuotes : []),
      halfBandDecision: {
        whyAboveLowerBand: String(half.whyAboveLowerBand || whyLower).trim(),
        whyAboveLowerBandZh: String(half.whyAboveLowerBandZh || item.whyNotLowerZh || "").trim(),
        whyBelowUpperBand: String(half.whyBelowUpperBand || whyHigher).trim(),
        whyBelowUpperBandZh: String(half.whyBelowUpperBandZh || item.whyNotHigherZh || "").trim(),
        whyExactBand: String(half.whyExactBand || whyThis).trim(),
        whyExactBandZh: String(half.whyExactBandZh || item.whyThisBandZh || item.summaryZh || "").trim()
      }
    };
  });
  return out;
}

function buildTaskProfile(body, signals) {
  return signals.task === "Task 1"
    ? {
        task: "Task 1",
        criterion: "Task Achievement",
        scoringProfile: taskRuleLabel("Task 1"),
        anchorBands: TASK1_BAND_ANCHORS_0_TO_9,
        gateRules: TASK1_GATE_RULES,
        bulletPoints: signals.task1BulletPoints,
        taskRequirementAudit: signals.taskRequirementAudit || null,
        letterStyle: body.letterStyle || "",
        purposeRequired: true,
        requiredMinimumWords: 150
      }
    : {
        task: "Task 2",
        criterion: "Task Response",
        scoringProfile: taskRuleLabel("Task 2"),
        anchorBands: TASK2_BAND_ANCHORS_0_TO_9,
        gateRules: TASK2_GATE_RULES,
        questionType: signals.task2QuestionProfile?.questionType || body.questionType || "general_essay",
        requiredParts: signals.task2QuestionProfile?.requiredParts || [],
        questionCount: signals.task2QuestionProfile?.questionCount || 0,
        directQuestions: signals.task2QuestionProfile?.directQuestions || [],
        twoPartQuestion: Boolean(signals.task2QuestionProfile?.twoPartQuestion),
        taskRequirementAudit: signals.taskRequirementAudit || null,
        positionRequired: Boolean(signals.task2QuestionProfile?.positionRequired),
        requiredMinimumWords: 250
      };
}


function combineGate(localGate, aiGate) {
  const localTriggered = Boolean(localGate?.status === "triggered" || localGate?.localTriggered);
  const ai = aiGate && typeof aiGate === "object" ? aiGate : {};
  const status = localTriggered ? "triggered" : (ai.status || localGate?.status || "passed");
  return {
    ...(ai || {}),
    ...(localGate || {}),
    status,
    reason: String(localGate?.reason || ai.reason || ai.explanation || ai.note || "Gate checked.").trim(),
    reasonZh: String(localGate?.reasonZh || ai.reasonZh || ai.explanationZh || ai.noteZh || "").trim(),
    evidence: Array.isArray(ai.evidence) ? ai.evidence : (Array.isArray(localGate?.evidence) ? localGate.evidence : [])
  };
}

function detectTask1HighCompletionEvidence(body = {}, signals = {}) {
  const essay = String(body.essay || "");
  const lower = essay.toLowerCase();
  const words = Number(signals.wordCount) || countWords(essay);
  const audit = signals.taskRequirementAudit || buildTaskRequirementAudit(body, signals) || {};
  const items = Array.isArray(audit.items) ? audit.items : [];
  const missing = Number(audit.missingCount);
  const partly = Number(audit.partlyCount);
  const extractedCount = Array.isArray(signals.task1BulletPoints) ? signals.task1BulletPoints.length : 0;
  const coveredCount = items.filter((item) => item.status === "covered" || item.status === "partly_covered").length;
  const allExtractedCovered = extractedCount >= 3 && coveredCount >= extractedCount && (!Number.isFinite(missing) || missing === 0) && (!Number.isFinite(partly) || partly <= 1);

  const hasGreeting = /\b(dear|hello|hi)\b/i.test(essay);
  const hasClosing = /\b(best regards|kind regards|regards|yours sincerely|yours faithfully|sincerely|best wishes|yours)\b/i.test(essay);
  const hasPurpose = /\b(i am writing|i'm writing|i would like|i would be happy|i am happy to|i can|i will|let you know|please let me know|could you|would you)\b/i.test(lower);
  const offerSignal = /\b(offer|prepare|make|cook|bring|contribute|provide|help|volunteer|would be happy to|would like to|i can|i will)\b/i.test(lower);
  const describeSignal = /\b(is|are|called|known|made|filled|contains?|ingredients?|dish|food|usually|traditional|popular|well[- ]known|boiled|steamed|fried|served|version)\b/i.test(lower);
  const explainSignal = /\b(because|since|reason|should be included|should include|suitable|fit|fits|spirit|meaningful|culture|cultural|chance|opportunity|experience|not only|also|therefore)\b/i.test(lower);
  const requirementSignalCount = [offerSignal, describeSignal, explainSignal].filter(Boolean).length;
  const paragraphCount = Number(signals.paragraphCount) || countParagraphs(essay);
  const sentenceCount = Number(signals.sentenceCount) || sentenceUnits(essay).length;

  const enoughLength = words >= 145;
  const coherentLetterShape = hasGreeting && hasClosing && hasPurpose && paragraphCount >= 3 && sentenceCount >= 6;
  const contentComplete = allExtractedCovered || requirementSignalCount >= 3;
  return {
    triggered: enoughLength && coherentLetterShape && contentComplete,
    reason: `Task 1 high-completion evidence: ${words} words, greeting/closing/purpose present, ${requirementSignalCount}/3 key bullet-signal groups detected, and ${coveredCount}/${extractedCount || 3} extracted bullets covered or inferably covered.`
  };
}

function detectExamRealismUnderScoreRisk(criteria = {}, signals = {}, body = {}) {
  const { finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) return { triggered: false, reason: "" };
  const task = signals.task === "Task 1" ? "Task 1" : "Task 2";
  const words = Number(signals.wordCount) || countWords(body.essay || "");
  const audit = signals.taskRequirementAudit || buildTaskRequirementAudit(body, signals) || {};
  const missing = Number(audit.missingCount);
  const partly = Number(audit.partlyCount);
  const spelling = Number(signals.spellingIssueCount) || 0;
  const grammar = Number(signals.grammarIssueSignalCount) || 0;
  const spellingDensity = Number(signals.spellingDensityPer100Words) || 0;
  const grammarDensity = Number(signals.grammarDensityPer100Words) || 0;
  const languageNotWeak = signals.lexicalControl !== "weak" && signals.sentenceControl !== "weak" && signals.spellingErrorDensity !== "high" && signals.grammarErrorDensity !== "high";
  const lowErrorSignal = spelling <= 3 && grammar <= 3 && spellingDensity <= 2.2 && grammarDensity <= 1.8;
  if (task === "Task 1") {
    const firstBand = Number(criteria["Task Achievement"]);
    const completeBullets = missing === 0 && partly === 0;
    const enoughLength = words >= 145;
    const highCompletion = detectTask1HighCompletionEvidence(body, signals);
    if (highCompletion.triggered && languageNotWeak && finalBand < 6.5) {
      return { triggered: true, reason: `${highCompletion.reason} Current final Band ${finalBand.toFixed(1)} is likely under-calibrated; re-check whether 6.5/7.0+ is more realistic under GT Task 1 standards.` };
    }
    if (highCompletion.triggered && lowErrorSignal && finalBand < 7.0) {
      return { triggered: true, reason: `${highCompletion.reason} Low local error signals plus complete communicative task response make Band ${finalBand.toFixed(1)} suspiciously low; re-check against Band 7 Task 1 descriptors.` };
    }
    if (completeBullets && enoughLength && lowErrorSignal && Number.isFinite(firstBand) && firstBand < 6.5) {
      return { triggered: true, reason: `Task Achievement under-score risk: all Task 1 bullets appear covered with normal length and low error signals, but TA is ${firstBand.toFixed(1)}. Re-check against real GT Task 1 standards.` };
    }
  } else {
    const firstBand = Number(criteria["Task Response"]);
    const completeTask = (missing === 0 || !Number.isFinite(missing)) && words >= 240 && Number(signals.paragraphCount) >= 4;
    if (completeTask && languageNotWeak && finalBand < 5.5) {
      return { triggered: true, reason: `Exam-realism under-score risk: Task 2 is full length with paragraphing and no high weak-language signal, but final Band is ${finalBand.toFixed(1)}. Re-check whether a mid-band score is more realistic.` };
    }
    if (completeTask && lowErrorSignal && Number.isFinite(firstBand) && firstBand < 5.5) {
      return { triggered: true, reason: `Task Response under-score risk: full-length Task 2 response has low error signals but TR is ${firstBand.toFixed(1)}. Re-check against real Task 2 standards.` };
    }
  }
  return { triggered: false, reason: "" };
}

function buildHardBoundaryAudit(criteria, signals, anchorComparison = {}, criterionCalibration = {}, existing = {}) {
  const { rawAverage, finalBand } = averageBand(criteria);
  const wordBoundary = getWordCountBoundaryProfile(signals.task, signals.wordCount);
  const highCandidate = detectHighBandCandidate(criteria, signals, anchorComparison, criterionCalibration);
  const warnings = collectScoreWarnings(criteria, signals);
  const feedbackQualityIssues = [];
  const anchorBand = Number(anchorComparison?.closestAnchorBand);
  const anchorMissing = Boolean(anchorComparison?.anchorMissing || anchorComparison?.anchorSource === "local_fallback_missing_ai_anchor");
  const anchorConflict = Number.isFinite(anchorBand) && Number.isFinite(finalBand) && Math.abs(anchorBand - finalBand) > 1;
  const values = scoreValues(criteria);
  const allSame = allCriteriaSame(criteria);
  const allFourSeven = values.length === 4 && values.every((x) => x === 7);
  const lowBandScoreTooHigh = Boolean(wordBoundary.triggered && Number.isFinite(finalBand) && Number.isFinite(wordBoundary.upper) && finalBand > wordBoundary.upper);
  const band6AccessConflict = Boolean(signals.task === "Task 2" && signals.wordCount < 230 && values.some((x) => x >= 6) && (signals.rateabilityStatus !== "clearly_rateable" || wordBoundary.triggered));
  const names = criterionNames(signals.task);
  const firstCriterionBand = Number(criteria[names[0]]);
  const lrBand = Number(criteria["Lexical Resource"]);
  const graBand = Number(criteria["Grammatical Range and Accuracy"]);
  const weakLanguageHighScoreConflict = Boolean((signals.lexicalControl === "weak" || signals.spellingErrorDensity === "high") && lrBand >= 5.5) || Boolean((signals.sentenceControl === "weak" || signals.grammarErrorDensity === "high") && graBand >= 5.5);
  const fullLengthWeakLanguageOverallConflict = Boolean(!wordBoundary.triggered && Number.isFinite(finalBand) && finalBand >= 6 && (signals.lexicalControl === "weak" || signals.sentenceControl === "weak" || signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high"));
  const task1BelowLengthHighTAConflict = Boolean(signals.task === "Task 1" && Number(signals.wordCount) < 150 && Number.isFinite(firstCriterionBand) && firstCriterionBand >= 6);
  const requirementAudit = signals.taskRequirementAudit || {};
  const requirementCap = signals.task === "Task 1" ? Number(requirementAudit.taskAchievementCap) : Number(requirementAudit.taskResponseCap);
  const taskRequirementScoreConflict = Number.isFinite(requirementCap) && Number.isFinite(firstCriterionBand) && firstCriterionBand > requirementCap;
  const examRealismUnderScoreRisk = detectExamRealismUnderScoreRisk(criteria, signals);
  const reviewReasons = [];
  if (anchorMissing) reviewReasons.push("AI did not provide an independent anchor comparison.");
  if (lowBandScoreTooHigh) reviewReasons.push(`Final Band ${finalBand.toFixed(1)} exceeds local word-count boundary ${wordBoundary.suggestedRange}.`);
  if (allFourSeven) reviewReasons.push("All four criterion bands are exactly Band 7.0; this must be reviewed for possible 7.5/8.0+ or justified as true Band 7.");
  if (highCandidate.triggered) reviewReasons.push(highCandidate.reason);
  if (anchorConflict) reviewReasons.push(`Anchor Band ${anchorBand} differs from final Band ${finalBand.toFixed(1)} by more than 1.0.`);
  if (allSame && finalBand >= 5) reviewReasons.push("All four criterion bands are identical; forced differentiation review is required.");
  if (band6AccessConflict) reviewReasons.push("Band 6+ access conflict: short or weakly rateable Task 2 needs real development evidence.");
  if (weakLanguageHighScoreConflict) reviewReasons.push("Language-control conflict: weak spelling/lexical or grammar/sentence-control signals require LR/GRA boundary review.");
  if (fullLengthWeakLanguageOverallConflict) reviewReasons.push("Full-length but weak-language conflict: overall 6.0+ requires strong evidence despite high local language-error signals.");
  if (task1BelowLengthHighTAConflict) reviewReasons.push("Task 1 below recommended length but Task Achievement is 6.0+; bullet detail and purpose/tone must be reviewed.");
  if (taskRequirementScoreConflict) reviewReasons.push(`${signals.task} task-specific requirement conflict: ${names[0]} ${firstCriterionBand.toFixed(1)} exceeds the requirement-audit ceiling ${requirementCap.toFixed(1)}; AI boundary review must justify or revise it.`);
  if (examRealismUnderScoreRisk.triggered) reviewReasons.push(examRealismUnderScoreRisk.reason);
  return {
    version: "strict-boundary-audit-v6-midband-advisory-requirements",
    localScoringApplied: false,
    localParticipation: "The server does not assign bands, but it performs hard local gate audit, boundary-trigger detection, structural validation, and AI re-review routing before score freeze.",
    status: reviewReasons.length ? "review_required" : "passed",
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    wordCountBoundary: wordBoundary,
    lowBandBoundary: {
      status: wordBoundary.triggered ? "triggered" : "passed",
      suggestedRange: wordBoundary.suggestedRange,
      scoreTooHigh: lowBandScoreTooHigh,
      reason: wordBoundary.reason
    },
    highBandBoundary: {
      status: highCandidate.triggered || allFourSeven ? "triggered" : "passed",
      allFourSeven,
      highCandidate: highCandidate.triggered,
      reason: highCandidate.reason
    },
    anchorAudit: {
      status: anchorMissing || anchorConflict ? "triggered" : "passed",
      anchorMissing,
      anchorConflict,
      closestAnchorBand: Number.isFinite(anchorBand) ? anchorBand : null,
      finalBand
    },
    scoreProfileAudit: {
      status: (warnings.length || allSame || weakLanguageHighScoreConflict || fullLengthWeakLanguageOverallConflict || task1BelowLengthHighTAConflict) ? "triggered" : "passed",
      allCriteriaSame: allSame,
      weakLanguageHighScoreConflict,
      fullLengthWeakLanguageOverallConflict,
      task1BelowLengthHighTAConflict,
      taskRequirementScoreConflict,
      examRealismUnderScoreRisk,
      requirementCap: Number.isFinite(requirementCap) ? requirementCap : null,
      feedbackQualityIssues,
      warnings
    },
    firstPass: existing.firstPass || null,
    boundaryReview: existing.boundaryReview || null,
    rawAverage,
    finalBand
  };
}


function boundaryStepMessage(stage, result = {}) {
  const audit = result.boundaryAudit || {};
  const meta = result.scoreCoreMeta || {};
  const signals = result.localSignals || {};
  if (stage === "score-precheck") {
    return `本地文本检查完成：${signals.wordCount ?? "-"} words，${signals.paragraphCount ?? "-"} 段，${signals.sentenceCount ?? "-"} 句，可评分性：${signals.rateabilityStatus || "pending"}。`;
  }
  if (stage === "score-task-router") {
    return `任务分流完成：${result.task || signals.task || "unknown"}，已选择 ${result.task === "Task 1" || signals.task === "Task 1" ? "GT Task 1 Letter" : "GT Task 2 Essay"} 评分规则。`;
  }
  if (stage === "score-anchor") {
    const anchor = result.anchorComparison || {};
    return anchor.anchorMissing
      ? "AI 独立锚点判断未返回有效结果；后续必须触发边界复核，不能直接冻结。"
      : `AI 独立锚点完成：closest anchor Band ${anchor.closestAnchorBand ?? "-"}，候选区间 ${anchor.candidateRange || `${anchor.lowerAnchorBand ?? "-"}-${anchor.higherAnchorBand ?? "-"}`}。`;
  }
  if (stage === "score-criteria") {
    const finalBand = result.overallBand ?? result.scoreCalculation?.finalBand;
    return `AI 四项初评完成：初始 Overall Band ${Number.isFinite(Number(finalBand)) ? Number(finalBand).toFixed(1) : "-"}；半分理由、证据和 anchor 已返回。`;
  }
  if (stage === "score-boundary-audit") {
    const reasons = Array.isArray(audit.reviewReasons) ? audit.reviewReasons : [];
    return audit.reviewRequired
      ? `本地 hard audit 触发 ${reasons.length || 1} 项复核：${reasons.slice(0, 3).join("；")}${reasons.length > 3 ? "..." : ""}`
      : "本地 hard audit 通过：没有发现必须二次复核的低分、高分、锚点或分数组合冲突。";
  }
  if (stage === "score-boundary-review") {
    if (audit.boundaryReview?.triggered || meta.boundaryReviewApplied) {
      return `AI 二次边界复核完成：${audit.boundaryReview?.decision || "reviewed"}。${audit.boundaryReview?.whyFinalCriteriaAreSafe || "AI 已重新确认最终四项分。"}`;
    }
    return "AI 二次边界复核跳过：本地 hard audit 未发现必须二次复核的风险。";
  }
  if (stage === "score-differentiation-review") {
    const diff = audit.criterionDifferentiationReview || {};
    if (diff.triggered) {
      return `AI 四项独立区分复核完成：${diff.decision || "reviewed"}。${diff.whyNotMechanicalCopy || "AI 已检查四项同分是否有独立证据。"}`;
    }
    return "AI 四项独立区分复核跳过：四项不是需要复核的中高分同分组合。";
  }
  if (stage === "score-finalize") {
    const finalBand = result.overallBand ?? result.scoreCalculation?.finalBand;
    return `最终验证完成：四项最终分已冻结，机械平均后的 Overall Band 为 ${Number.isFinite(Number(finalBand)) ? Number(finalBand).toFixed(1) : "-"}。`;
  }
  return "阶段状态已更新。";
}

function buildDetailedScoringProgress(stageKey, result = {}, status = "done") {
  const idx = Math.max(0, DETAILED_SCORING_STEPS.findIndex((step) => step.stage === stageKey));
  const currentIndex = idx >= 0 ? idx : 0;
  const steps = DETAILED_SCORING_STEPS.map((step, index) => {
    const done = index <= currentIndex;
    return {
      ...step,
      index: index + 1,
      status: done ? "done" : "waiting",
      message: done ? boundaryStepMessage(step.stage, result) : step.description,
      detail: step.stage === "score-boundary-audit" ? result.boundaryAudit || null : step.stage === "score-boundary-review" ? result.boundaryAudit?.boundaryReview || null : step.stage === "score-differentiation-review" ? result.boundaryAudit?.criterionDifferentiationReview || null : null
    };
  });
  return {
    version: SCORE_SYSTEM_VERSION,
    totalSteps: DETAILED_SCORING_STEPS.length,
    currentStep: currentIndex + 1,
    currentStage: stageKey,
    status,
    updatedAt: new Date().toISOString(),
    steps
  };
}

function withDetailedProgress(result, stageKey, status = "done") {
  const progress = buildDetailedScoringProgress(stageKey, result, status);
  return { ...result, detailedScoringProgress: progress, scoringProgress: progress };
}

function attachSinglePassProgress(result, status = "done") {
  const internal = buildDetailedScoringProgress("score-finalize", result, status);
  const visible = buildVisibleProgress(result, status);
  return {
    ...result,
    visibleProgress: visible,
    scoringProgress: visible,
    detailedScoringProgress: internal,
    internalAuditTrail: internal.steps.map((step) => ({
      stage: step.stage,
      title: step.title,
      status: step.status,
      message: step.message,
      detail: step.detail || null
    }))
  };
}

function boundaryAuditSummaryZh(audit = {}) {
  const reasons = Array.isArray(audit.reviewReasons) ? audit.reviewReasons : [];
  if (!reasons.length) return "本地硬性校准通过：未发现必须二次复核的低分、高分、锚点或分数组合冲突。";
  return `本地硬性校准触发二次复核：${reasons.join("；")}`;
}

function boundaryReviewEvidenceText(reviewed = {}, review = {}, audit = {}) {
  return [
    review?.whyFinalCriteriaAreSafe,
    review?.whyFinalCriteriaAreSafeZh,
    review?.allFourSevenResolution ? JSON.stringify(review.allFourSevenResolution) : "",
    reviewed?.examinerSummary,
    reviewed?.examinerSummaryZh,
    reviewed?.criterionCalibration ? JSON.stringify(reviewed.criterionCalibration) : "",
    audit?.reviewReasons ? audit.reviewReasons.join(" ") : ""
  ].filter(Boolean).join("\n");
}

function hasStrongBoundaryKeepEvidence(reviewed = {}, review = {}, audit = {}) {
  const text = boundaryReviewEvidenceText(reviewed, review, audit);
  const hasConcreteLimitation = /specific limitation|concrete limitation|not fully developed|not fully extended|minor imprecision|limited sophistication|some mechanical|not consistently|occasional error|rare error|lexical limitation|grammar limitation|cohesion limitation|prevents 7\.5|prevents 8|prevents 9|不能达到|限制|不足|不够|未能/i.test(text);
  const hasResolution = Boolean(review?.allFourSevenResolution?.resolved || review?.allFourSevenResolution?.criteriaDecisions || review?.whyFinalCriteriaAreSafe);
  return hasResolution && hasConcreteLimitation && String(text).length > 180;
}

function unresolvedCriticalBoundaryReasons(reviewed = {}, audit = {}) {
  const criteria = reviewed.finalCriteria || reviewed.criteria || {};
  const { finalBand } = averageBand(criteria);
  const reasons = [];
  // v7.4: boundary audit is diagnostic, not a user-visible crash trigger.
  // Low-word-count, all-four-7 and all-same-high profiles must trigger review/warnings,
  // but after review they should freeze with warnings instead of returning HTTP 502.
  if (audit.anchorAudit?.anchorMissing && !hasUsableAnchorComparison(reviewed.anchorComparison)) {
    reasons.push("Independent anchor comparison is still missing after boundary review.");
  }
  if (!Number.isFinite(finalBand)) reasons.push("Final band is not numeric.");
  return reasons;
}

function assertFinalCanFreeze(result = {}) {
  const criteria = result.finalCriteria || result.criteria || {};
  const { finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) {
    const error = new Error("Final score freeze blocked: final band is not numeric.");
    error.status = 502;
    error.aiStage = "score-finalize";
    throw error;
  }
  const audit = result.boundaryAudit || {};
  const unresolved = Array.isArray(audit.unresolvedCriticalReasons) ? audit.unresolvedCriticalReasons : [];
  const critical = unresolved.filter((item) => /not numeric|missing.*anchor/i.test(String(item)));
  if (critical.length) {
    const error = new Error(`Final score freeze blocked by critical scoring integrity issue: ${critical.join("; ")}`);
    error.status = 502;
    error.aiStage = "score-finalize";
    throw error;
  }
  // v7.4: Do not crash for score-profile review warnings such as low-word-count boundary,
  // all-four-7, or all-same-high. Those are preserved in boundaryAudit and stabilityWarnings.
}

function buildBoundaryReviewPrompt(body, firstResult, audit) {
  const signals = resolveScoringSignals(body, firstResult);
  const task = signals.task;
  const names = criterionNames(task);
  return [
    "You are the second-pass IELTS GT Writing boundary examiner. Return compact valid JSON only.",
    `Score system: ${SCORE_SYSTEM_VERSION}. The server does not assign bands locally; it only audits and freezes AI-returned criterion bands.`,
    `Task: ${task}. Criteria must be exactly: ${names.join(", ")}.`,
    `IELTS criterion band matrix for the locked ${task}:\n${criterionBandMatrixText(task)}`,
    halfBandDecisionProtocol(),
    `Task-specific high/low band boundary protocol:\n${bandBoundaryProtocolForTask(task)}`,
    "AI-only boundary review rule: do not use local boundary profiles, local word-count limits, local spelling/grammar counters, or local task-requirement caps to keep, lower, or raise bands. Re-score from the prompt, the student response, and the 0-9 criterion matrix only.",
    "Only re-check scoring boundaries. Do not generate detailed feedback, corrections, translations, or model answers in this boundary review.",
    "If the first score violates a boundary, revise the criterion bands yourself. If you keep them, give compact concrete evidence.",
    `Exam-realism calibration for ${task}:\n${examRealismCalibrationRulesForTask(task)}`,
    `Primary 4.0-6.5 midband calibration for ${task}:\n${midbandCalibrationRulesForTask(task)}`,
    `v8.5.5 score-scale calibration for ${task}:\n${scoreScaleCalibrationText(task)}`,
    `v8.5.6 forced anchor-comparison calibration for ${task}:\n${v856ForcedAnchorComparisonProtocol(task)}`,
    `${v855ExtremeBandDecisionProtocol(task)}`,
    `${v856ForcedAnchorComparisonProtocol(task)}`,
    "Two-sided calibration rule: revise downward when the first score over-rewards weak, repetitive or error-prone writing; revise upward when the first score under-rewards mature, precise and well-controlled writing. Do not only look for under-scoring.",
    "Task 1 review: greeting/closing/all bullets do not by themselves justify Band 7. Check depth, reader focus, tone, naturalness, LR and GRA. A complete but basic/error-prone letter may be 4.5/5.5/6.0.",
    "Criterion differentiation rule: do not return four identical criterion bands unless the evidence for TA/TR, CC, LR and GRA independently supports the same half-band. For all-four Band 7 cases, actively check whether LR/GRA should be 6.5 or whether TA/TR/CC should be 7.5. If you keep 7/7/7/7, give criterion-specific evidence; do not copy Overall into all criteria.",
    "High-band review: if the independent anchor or response quality suggests Band 8/9 and final score remains 7.0 or below, revise upward unless there are clear concrete limitations. If a polished full response is kept at 7/7.5, identify exact limitations in task fulfilment, cohesion, lexis and grammar.",
    "Low-band review: if the response is weak, repetitive, error-prone or only mechanically organised, do not keep 5.5/6/6.5 merely because it is long or task-related. Lower LR/GRA and, when content is thin, TA/TR/CC too.",
    "Extreme low-band anchor review: for writing with repeated basic errors, awkward phrasing and shallow content, first test Band 3/4/4.5 before considering 5.5+. If you keep 5.5+, state concrete evidence of control beyond basic relevance.",
    "Extreme high-band anchor review: for near-error-free, precise, mature responses, first test Band 8/8.5 before defaulting to 7. If you keep 7/7.5, state exact limitations beyond simply not being official-perfect.",
    "JSON safety: no markdown, no comments, no trailing prose, no unescaped double quotes inside strings. Use single quotes for student phrases.",
    `Review reason: mandatory AI-only second-pass calibration. Ignore local audit scores or caps; they are not allowed to determine bands.`,
    `First compact score to verify or revise: ${JSON.stringify({ criteria: firstResult.finalCriteria || firstResult.criteria, overallBand: firstResult.overallBand, anchorComparison: firstResult.anchorComparison, shortReasons: firstResult.shortReasons, examinerSummary: firstResult.examinerSummary })}`,
    `Prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly this compact shape: {\"ok\":true,\"aiStage\":\"score-boundary-review\",\"task\":\"Task 1 or Task 2\",\"anchorComparison\":{\"closestAnchorBand\":number,\"lowerAnchorBand\":number,\"higherAnchorBand\":number,\"candidateRange\":\"x-y\",\"whyCloserToThisBand\":\"max 30 words\",\"whyNotLowerAnchor\":\"max 25 words\",\"whyNotHigherAnchor\":\"max 25 words\"},\"criteria\":{...four criterion bands as numbers...},\"shortReasons\":{\"Criterion Name\":\"max 18 words, concrete reason\"},\"boundaryReview\":{\"triggered\":true,\"decision\":\"revised\" or \"kept_after_review\",\"reviewReasons\":[\"short reason\"],\"whyFinalCriteriaAreSafe\":\"max 45 words\",\"whyFinalCriteriaAreSafeZh\":\"中文简短说明\",\"firstCriteria\":{...},\"finalCriteria\":{...},\"allFourSevenResolution\":{\"resolved\":boolean,\"keptAllSeven\":boolean,\"criteriaDecisions\":{}}},\"examinerSummary\":\"max 35 words\"}."
  ].join("\n\n");
}

async function applyBoundaryReviewIfNeeded(body, firstResult) {
  const signals = resolveScoringSignals(body, firstResult);
  const initialAudit = firstResult.boundaryAudit || buildHardBoundaryAudit(firstResult.finalCriteria || firstResult.criteria, signals, firstResult.anchorComparison || {}, firstResult.criterionCalibration || {}, { skipFeedbackQualityAudit: true });
  // v8.5.1: Always run one AI-only second-pass calibration. This is not local scoring:
  // it prevents first-pass central-band compression and lets the AI re-check 0.5-band boundaries.
  const forcedAudit = {
    ...initialAudit,
    status: "mandatory_ai_only_review",
    reviewRequired: true,
    reviewReasons: [
      ...new Set([
        ...(initialAudit.reviewReasons || []),
        "Mandatory AI-only second-pass calibration: verify low/mid/high band boundaries using only the 0-9 criterion matrix."
      ])
    ]
  };
  let ai;
  try {
    ai = await callDeepSeek([
      { role: "system", content: "You are an IELTS GT Writing boundary-review scoring engine. You must correct central-band compression using strict low/high anchors. You score only; no editing advice." },
      { role: "user", content: buildBoundaryReviewPrompt(body, firstResult, forcedAudit) }
    ], 3600, 0);
  } catch (error) {
    return {
      ...firstResult,
      boundaryAudit: {
        ...forcedAudit,
        status: "review_skipped_ai_error_freeze_first_pass",
        reviewRequired: false,
        freezeBlocked: false,
        boundaryReview: {
          triggered: true,
          decision: "skipped_ai_error",
          reviewReasons: forcedAudit.reviewReasons || [],
          error: String(error?.message || error),
          whyFinalCriteriaAreSafe: "Boundary review call failed; first-pass AI score will be frozen with audit warnings only. No local calibration is applied.",
          whyFinalCriteriaAreSafeZh: "边界复核调用失败；系统将冻结首轮 AI 分数并保留审计提醒，不进行本地校准或改分。"
        }
      },
      stabilityWarnings: [...new Set([...(firstResult.stabilityWarnings || []), `Boundary review AI call failed: ${String(error?.message || error)}`])],
      scoreCoreMeta: { ...(firstResult.scoreCoreMeta || {}), boundaryReviewed: false, boundaryReviewApplied: false, boundaryReviewErrorRecovered: true, scoreFrozen: false }
    };
  }
  const independentAnchor = hasUsableAnchorComparison(firstResult.anchorComparison) ? firstResult.anchorComparison : null;
  const reviewedBase = await normalizeScoreCoreResultWithZeroRescue(ai, body, signals, { fromBoundaryReview: true, independentAnchor, skipFeedbackQualityAudit: true });
  const reviewed = {
    ...reviewedBase,
    anchorComparison: (!reviewedBase.anchorComparison?.anchorMissing ? reviewedBase.anchorComparison : (independentAnchor || reviewedBase.anchorComparison))
  };
  const reviewedAuditRaw = buildHardBoundaryAudit(reviewed.finalCriteria || reviewed.criteria, signals, reviewed.anchorComparison || {}, reviewed.criterionCalibration || {}, {
    firstPass: {
      criteria: firstResult.finalCriteria || firstResult.criteria,
      overallBand: firstResult.overallBand,
      anchorComparison: firstResult.anchorComparison,
      audit: forcedAudit
    },
    skipFeedbackQualityAudit: true,
    boundaryReview: {
      triggered: true,
      decision: ai.boundaryReview?.decision || "reviewed",
      reviewReasons: forcedAudit.reviewReasons,
      whyFinalCriteriaAreSafe: ai.boundaryReview?.whyFinalCriteriaAreSafe || ai.boundaryReview?.explanation || "Boundary review completed by AI.",
      whyFinalCriteriaAreSafeZh: ai.boundaryReview?.whyFinalCriteriaAreSafeZh || "AI 已完成边界复核并返回最终四项分。"
    }
  });
  const boundaryReview = {
    ...reviewedAuditRaw.boundaryReview,
    allFourSevenResolution: ai.boundaryReview?.allFourSevenResolution || ai.allFourSevenResolution || null
  };
  const auditForResolution = { ...reviewedAuditRaw, boundaryReview };
  const unresolvedCriticalReasons = unresolvedCriticalBoundaryReasons(reviewed, auditForResolution);
  const freezeBlocked = unresolvedCriticalReasons.length > 0;
  const reviewedStatus = freezeBlocked
    ? "review_failed_unresolved"
    : reviewedAuditRaw.reviewRequired
      ? "reviewed_passed_with_strong_evidence"
      : "reviewed_passed";
  return {
    ...reviewed,
    boundaryAudit: {
      ...reviewedAuditRaw,
      status: reviewedStatus,
      reviewRequired: freezeBlocked,
      freezeBlocked,
      unresolvedCriticalReasons,
      reviewedRemainingWarnings: reviewedAuditRaw.reviewReasons,
      firstPass: reviewedAuditRaw.firstPass,
      boundaryReview
    },
    stabilityWarnings: [...new Set([...(reviewed.stabilityWarnings || []), ...(reviewedAuditRaw.reviewReasons || []).map((x) => `Boundary review note: ${x}`), ...unresolvedCriticalReasons.map((x) => `Boundary freeze block: ${x}`)])],
    scoreCoreMeta: { ...(reviewed.scoreCoreMeta || {}), boundaryReviewed: true, boundaryReviewApplied: true, freezeBlocked, scoreFrozen: false }
  };
}


function shouldRunCriterionDifferentiationReview(result = {}) {
  const criteria = result.finalCriteria || result.criteria || {};
  const values = scoreValues(criteria);
  if (values.length !== 4) return false;
  const same = values.every((x) => x === values[0]);
  if (!same) return false;
  const { finalBand } = averageBand(criteria);
  // Do not spend an extra AI call for strict-zero or very low severely limited writing.
  // The main problem we are solving is mid/high-band criterion cloning such as 7/7/7/7.
  return Number.isFinite(finalBand) && finalBand >= 5;
}

function buildCriterionDifferentiationPrompt(body, reviewedResult, audit = {}) {
  const signals = resolveScoringSignals(body, reviewedResult);
  const task = signals.task;
  const names = criterionNames(task);
  const criteria = reviewedResult.finalCriteria || reviewedResult.criteria || {};
  const { finalBand } = averageBand(criteria);
  return [
    "You are the third-pass IELTS GT Writing criterion-differentiation examiner. Return compact valid JSON only.",
    `Score system: ${SCORE_SYSTEM_VERSION}. This is AI-only; the server must not change bands locally.`,
    `Locked task: ${task}. Criteria must be exactly: ${names.join(", ")}.`,
    "Purpose: the previous AI pass returned four identical criterion bands. Re-check whether this equality is genuinely justified by criterion-specific evidence, or whether the score copied the overall profile into every criterion.",
    `Current identical criterion profile: ${JSON.stringify(criteria)}; current overall: ${finalBand}.`,
    `IELTS criterion band matrix for ${task}:\n${criterionBandMatrixText(task)}`,
    halfBandDecisionProtocol(),
    "Independent criterion rule: score each criterion separately. Do not choose a criterion band because the overall score is around that band.",
    "Evidence separation rule:",
    `- ${names[0]}: judge only task fulfilment, prompt coverage, position/development, register and purpose as relevant to the locked task.`,
    "- Coherence and Cohesion: judge progression, paragraphing, referencing, cohesion and sequencing only.",
    "- Lexical Resource: judge range, precision, collocation, repetition, word choice and spelling/word formation only.",
    "- Grammatical Range and Accuracy: judge sentence range, clause control, punctuation, agreement, tense and error density only.",
    "All-four-same challenge: identical bands are allowed only if all four criteria independently deserve the same half-band. If one criterion is slightly stronger or weaker, adjust it by 0.5 or 1.0. Do not create an artificial spread; keep equality if genuinely justified.",
    "For a Band 7-like profile, actively check whether LR or GRA is actually 6.5, or whether TA/TR or CC is 7.5. For a Band 6/6.5 profile, actively check whether task fulfilment is stronger than language control or vice versa.",
    "Do not give advice, corrections, translations, or model answers. Score only.",
    `Boundary review evidence already returned: ${JSON.stringify({ anchorComparison: reviewedResult.anchorComparison, shortReasons: reviewedResult.shortReasons, boundaryReview: audit.boundaryReview || null, examinerSummary: reviewedResult.examinerSummary }).slice(0, 2000)}`,
    `Prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly this JSON shape: {\"ok\":true,\"aiStage\":\"score-differentiation-review\",\"task\":\"Task 1 or Task 2\",\"criteria\":{...four criterion bands as numbers...},\"criterionDifferentiationReview\":{\"triggered\":true,\"decision\":\"revised\" or \"kept_identical_with_evidence\",\"sameBandsJustified\":boolean,\"changedCriteria\":[\"Criterion Name\"],\"criterionEvidence\":{\"Criterion Name\":\"max 18 words; specific evidence for this criterion only\"},\"whyNotMechanicalCopy\":\"max 40 words\",\"whyFinalProfileIsBalanced\":\"max 40 words\"},\"examinerSummary\":\"max 35 words\"}."
  ].join("\n\n");
}

async function applyCriterionDifferentiationReviewIfNeeded(body, reviewedResult = {}) {
  const signals = resolveScoringSignals(body, reviewedResult);
  const criteria = normalizeCriteria(reviewedResult.finalCriteria || reviewedResult.criteria, signals.task);
  if (!shouldRunCriterionDifferentiationReview({ ...reviewedResult, criteria, finalCriteria: criteria })) {
    return {
      ...reviewedResult,
      boundaryAudit: {
        ...(reviewedResult.boundaryAudit || {}),
        criterionDifferentiationReview: {
          triggered: false,
          decision: "skipped_not_all_same_mid_high",
          reason: "Criterion bands were not an identical mid/high profile requiring a differentiation challenge."
        }
      },
      scoreCoreMeta: { ...(reviewedResult.scoreCoreMeta || {}), criterionDifferentiationReviewed: false }
    };
  }

  const firstSameCriteria = criteria;
  const audit = reviewedResult.boundaryAudit || {};
  let ai;
  try {
    ai = await callDeepSeek([
      { role: "system", content: "You are an IELTS GT Writing criterion-differentiation scoring engine. Score only; no advice." },
      { role: "user", content: buildCriterionDifferentiationPrompt(body, { ...reviewedResult, criteria, finalCriteria: criteria }, audit) }
    ], 3400, 0);
  } catch (error) {
    return {
      ...reviewedResult,
      boundaryAudit: {
        ...audit,
        criterionDifferentiationReview: {
          triggered: true,
          decision: "skipped_ai_error_keep_previous_ai_score",
          error: String(error?.message || error),
          firstCriteria: firstSameCriteria,
          finalCriteria: firstSameCriteria,
          whyNotMechanicalCopy: "Differentiation AI call failed; previous AI-reviewed profile is kept without local changes."
        }
      },
      stabilityWarnings: [...new Set([...(reviewedResult.stabilityWarnings || []), `Criterion differentiation AI call failed: ${String(error?.message || error)}`])],
      scoreCoreMeta: { ...(reviewedResult.scoreCoreMeta || {}), criterionDifferentiationReviewed: false, criterionDifferentiationErrorRecovered: true }
    };
  }

  const independentAnchor = hasUsableAnchorComparison(reviewedResult.anchorComparison) ? reviewedResult.anchorComparison : null;
  const differentiatedBase = await normalizeScoreCoreResultWithZeroRescue(ai, body, signals, { fromBoundaryReview: true, independentAnchor, skipFeedbackQualityAudit: true });
  const differentiatedCriteria = normalizeCriteria(differentiatedBase.finalCriteria || differentiatedBase.criteria, signals.task);
  const differentiatedAuditRaw = buildHardBoundaryAudit(differentiatedCriteria, signals, differentiatedBase.anchorComparison || reviewedResult.anchorComparison || {}, differentiatedBase.criterionCalibration || reviewedResult.criterionCalibration || {}, {
    firstPass: audit.firstPass || null,
    skipFeedbackQualityAudit: true,
    boundaryReview: audit.boundaryReview || null
  });
  const diffReview = {
    triggered: true,
    decision: ai.criterionDifferentiationReview?.decision || (allCriteriaSame(differentiatedCriteria) ? "kept_identical_with_evidence" : "revised"),
    sameBandsJustified: Boolean(ai.criterionDifferentiationReview?.sameBandsJustified ?? allCriteriaSame(differentiatedCriteria)),
    changedCriteria: Array.isArray(ai.criterionDifferentiationReview?.changedCriteria) ? ai.criterionDifferentiationReview.changedCriteria : namesChanged(firstSameCriteria, differentiatedCriteria),
    criterionEvidence: ai.criterionDifferentiationReview?.criterionEvidence || ai.shortReasons || {},
    whyNotMechanicalCopy: ai.criterionDifferentiationReview?.whyNotMechanicalCopy || "AI re-checked each criterion independently against the matrix.",
    whyFinalProfileIsBalanced: ai.criterionDifferentiationReview?.whyFinalProfileIsBalanced || "Final profile returned by AI differentiation pass.",
    firstCriteria: firstSameCriteria,
    finalCriteria: differentiatedCriteria
  };
  const differentiatedCriterionAudit = buildCriterionAudit(signals.task, differentiatedCriteria, signals, body);
  return {
    ...reviewedResult,
    ...differentiatedBase,
    criteria: differentiatedCriteria,
    finalCriteria: differentiatedCriteria,
    criterionAudit: differentiatedCriterionAudit.criterionAudit,
    criterionScoreAudit: {
      ...differentiatedCriterionAudit.criterionScoreAudit,
      allCriteriaSame: allCriteriaSame(differentiatedCriteria),
      mechanicalCopyDetected: allCriteriaSame(differentiatedCriteria),
      originalCriteria: { ...firstSameCriteria },
      adjustedCriteria: { ...differentiatedCriteria }
    },
    anchorComparison: differentiatedBase.anchorComparison?.anchorMissing ? (reviewedResult.anchorComparison || differentiatedBase.anchorComparison) : differentiatedBase.anchorComparison,
    boundaryAudit: {
      ...audit,
      ...differentiatedAuditRaw,
      status: "criterion_differentiation_reviewed",
      reviewRequired: false,
      freezeBlocked: false,
      boundaryReview: audit.boundaryReview || differentiatedAuditRaw.boundaryReview || null,
      criterionDifferentiationReview: diffReview
    },
    stabilityWarnings: [...new Set([...(reviewedResult.stabilityWarnings || []), ...(differentiatedBase.stabilityWarnings || []), "Criterion differentiation review completed for all-four-same profile."])],
    scoreCoreMeta: { ...(reviewedResult.scoreCoreMeta || {}), ...(differentiatedBase.scoreCoreMeta || {}), boundaryReviewed: true, criterionDifferentiationReviewed: true, criterionDifferentiationApplied: true, scoreFrozen: false }
  };
}

function namesChanged(before = {}, after = {}) {
  return Object.keys(after || {}).filter((name) => Number(before?.[name]) !== Number(after?.[name]));
}

function gateStatus(reason, triggered = false) {
  return { status: triggered ? "triggered" : "passed", reason };
}

function buildLocalGateReport(criteria, signals, existing = {}, anchorComparison = {}, calibration = {}) {
  const warnings = collectScoreWarnings(criteria, signals);
  const profile = existing && typeof existing === "object" ? existing : {};
  const names = criterionNames(signals.task);
  const first = criteria[names[0]];
  const cc = criteria["Coherence and Cohesion"];
  const lr = criteria["Lexical Resource"];
  const gra = criteria["Grammatical Range and Accuracy"];
  const wordBoundary = getWordCountBoundaryProfile(signals.task, signals.wordCount);
  const highCandidate = detectHighBandCandidate(criteria, signals, anchorComparison, calibration);
  const localLow = gateStatus(wordBoundary.triggered ? `${wordBoundary.reason} Suggested range: ${wordBoundary.suggestedRange}.` : "No hard low-band word-count boundary detected.", wordBoundary.triggered || signals.rateabilityStatus === "not_rateable_or_severely_limited");
  const localMid = gateStatus("Mid-band gate checked: visible structure alone must not over-reward TR/TA or CC, and LR/GRA are checked against language-control signals.", Boolean((first >= 5.5 || cc >= 5.5 || lr >= 5.5 || gra >= 5) && (signals.grammarErrorDensity === "high" || signals.spellingErrorDensity === "high" || signals.lexicalControl === "weak" || signals.sentenceControl === "weak")));
  const localHigh = gateStatus(highCandidate.reason, highCandidate.triggered || Object.values(criteria).some((x) => x >= 7.5));
  const localProfile = gateStatus(warnings.length ? warnings.join(" ") : "No major score-profile instability detected.", warnings.length > 0 || allCriteriaSame(criteria));
  const reqAudit = signals.taskRequirementAudit || null;
  const localRequirement = gateStatus(reqAudit?.summary || "Task-specific requirement audit not available.", Boolean(reqAudit?.triggered && !reqAudit?.midbandAdvisoryOnly));
  return {
    likelyOverallRange: profile.likelyOverallRange || (wordBoundary.triggered ? wordBoundary.suggestedRange : (signals.rateabilityStatus === "clearly_rateable" ? "rateable; band depends on criterion evidence" : "limited or weakly rateable")),
    lowBandGate: combineGate(localLow, profile.lowBandGate),
    midBandGate: combineGate(localMid, profile.midBandGate),
    highBandGate: combineGate(localHigh, profile.highBandGate),
    taskRequirementGate: combineGate(localRequirement, profile.taskRequirementGate),
    scoreProfileGate: combineGate(localProfile, profile.scoreProfileGate)
  };
}
function normalizeScoreCoreResult(ai, body, signals, options = {}) {
  const task = signals.task === "Task 1" ? "Task 1" : "Task 2";
  const normalizedCriteria = normalizeCriteria(ai.criteria || ai.finalCriteria, task);
  const criterionRebalance = rebalanceMechanicalCriteria(task, normalizedCriteria, signals, body);
  const criteria = criterionRebalance.criteria || normalizedCriteria;
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) throw new Error("AI returned incomplete criterion bands.");
  const warnings = collectScoreWarnings(criteria, signals);
  const rawAnchor = ai.anchorComparison || ai.anchorCalibration || options.independentAnchor || {};
  let anchorComparison = normalizeAnchorComparison(rawAnchor, task, criteria, signals);
  if (anchorComparison.anchorMissing && hasUsableAnchorComparison(options.independentAnchor)) {
    anchorComparison = normalizeAnchorComparison(options.independentAnchor, task, criteria, signals);
  }
  const criterionCalibration = normalizeCriterionCalibration(ai.criterionCalibration || {}, criteria, task);
  const scoreProfile = buildLocalGateReport(criteria, signals, ai.scoreProfile || {}, anchorComparison, criterionCalibration);
  const taskSpecificGate = normalizeTaskSpecificGate(ai.taskSpecificGate || {}, signals, criteria, anchorComparison, criterionCalibration);
  const boundaryAudit = buildHardBoundaryAudit(criteria, signals, anchorComparison, criterionCalibration, { ...(ai.boundaryAudit || {}), skipFeedbackQualityAudit: Boolean(options.skipFeedbackQualityAudit) });
  return {
    ok: true,
    aiStage: "score-core",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    scoreCalculation: {
      mode: task === "Task 1" ? "task1_gt_letter_v8_5_ai_only_matrix" : "task2_essay_v8_5_ai_only_matrix",
      formula: "AI-only 0-9 criterion band matrix pipeline: AI scores four task-locked criteria using 0.5 increments; local code performs only strict hard-zero, task lock, audit routing, and mechanical averaging. No local cap, floor, lift, lowering, or regression calibration is applied.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No local band assignment or modification. The server only locks task, blocks strict hard-zero cases, routes audit warnings to AI boundary review, and mechanically averages AI-returned final criterion bands."
    },
    scoreCoreMeta: {
      scoreFirst: true,
      scoreFrozen: !boundaryAudit.reviewRequired,
      adviceSystemRemoved: true,
      anchorCalibrated: true,
      strictBoundaryAudited: true,
      taskAware: true,
      fromBoundaryReview: Boolean(options.fromBoundaryReview),
      generatedAt: new Date().toISOString()
    },
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration,
    scoreProfile,
    taskSpecificGate,
    boundaryAudit,
    criterionAudit: criterionRebalance.criterionAudit,
    criterionScoreAudit: criterionRebalance.criterionScoreAudit,
    criterionDifferentiationAudit: buildCriterionDifferentiationAudit(criteria),
    localLogicAudit: buildLocalLogicAudit(),
    scoreFrozen: !boundaryAudit.reviewRequired,
    feedbackCanChangeScore: false,
    diagnosticSignals: ai.diagnosticSignals || {},
    examinerSummary: String(ai.examinerSummary || "").trim(),
    examinerSummaryZh: String(ai.examinerSummaryZh || "").trim(),
    stabilityWarnings: warnings,
    localScoreChanged: false
  };
}


function buildCompactScorePrompt(body, signals, independentAnchor = null) {
  const task = signals.task;
  const names = criterionNames(task);
  const localBoundaryProfile = getLocalBandBoundaryProfile(signals);
  const compactSignals = {
    task: signals.task,
    wordCount: signals.wordCount,
    paragraphCount: signals.paragraphCount,
    sentenceCount: signals.sentenceCount,
    rateabilityStatus: signals.rateabilityStatus,
    recommendedMinimum: signals.recommendedMinimum,
    spellingIssueCount: signals.spellingIssueCount,
    spellingErrorDensity: signals.spellingErrorDensity,
    grammarIssueSignalCount: signals.grammarIssueSignalCount,
    grammarErrorDensity: signals.grammarErrorDensity,
    weakPhraseCount: signals.weakPhraseCount,
    lexicalControl: signals.lexicalControl,
    sentenceControl: signals.sentenceControl,
    lexicalNaturalnessRisk: signals.lexicalNaturalnessRisk,
    task1BulletCount: Array.isArray(signals.task1BulletPoints) ? signals.task1BulletPoints.length : 0,
    task2QuestionType: signals.task2QuestionProfile?.questionType || "",
    task2QuestionCount: signals.task2QuestionProfile?.questionCount || 0,
    task2TwoPartQuestion: Boolean(signals.task2QuestionProfile?.twoPartQuestion),
    task2DirectQuestions: Array.isArray(signals.task2QuestionProfile?.directQuestions) ? signals.task2QuestionProfile.directQuestions : [],
    taskRequirementAudit: signals.taskRequirementAudit ? {
      version: signals.taskRequirementAudit.version,
      triggered: Boolean(signals.taskRequirementAudit.triggered && !signals.taskRequirementAudit.midbandAdvisoryOnly),
      advisoryOnly: Boolean(signals.taskRequirementAudit.midbandAdvisoryOnly),
      missingCount: signals.taskRequirementAudit.missingCount,
      partlyCount: signals.taskRequirementAudit.partlyCount,
      taskAchievementCap: signals.taskRequirementAudit.midbandAdvisoryOnly ? null : signals.taskRequirementAudit.taskAchievementCap,
      advisoryTaskAchievementCap: signals.taskRequirementAudit.advisoryTaskAchievementCap,
      taskResponseCap: signals.taskRequirementAudit.taskResponseCap,
      summary: signals.taskRequirementAudit.summary
    } : null
  };
  const anchorMini = anchorSetForTask(task).map((item) => `B${item.band}: ${item.profile}`).join(" | ");
  const taskMini = task === "Task 1"
    ? `Task 1 prompt bullets extracted for orientation only: ${JSON.stringify(signals.task1BulletPoints || [])}. You, the AI examiner, must judge each bullet from the prompt and response yourself as covered, partly_covered, or missing. Do not rely on any local audit.`
    : `Task 2 question profile for orientation only: ${JSON.stringify(signals.task2QuestionProfile || {})}. You, the AI examiner, must judge the question type and all required parts yourself from the prompt and response. If the prompt has two direct questions, treat each as a required part. Do not rely on any local audit.`;
  return [
    "You are an IELTS GT Writing SCORE KERNEL. Return one tiny valid JSON object only.",
    `Score system: ${SCORE_SYSTEM_VERSION}. Task: ${task}. Criteria keys must be exactly ${JSON.stringify(names)}.`,
    "The selected scoring task is locked by the request. Do not reclassify this response as the other IELTS task. If the writing style resembles another task, treat that as a task-response/achievement issue within the locked task, not permission to change rubrics.",
    "This is Step 2: AI core scoring only. Forbidden in this step: Chinese, long explanations, original quotations, detailed feedback, evidence arrays, taskSpecificGate, scoreProfile, criterionCalibration, corrections, translations, revision/model answers, markdown, comments, trailing prose.",
    "Return only anchorBand, candidateRange, four criterion bands, reasonCodes, and flags. Keep all strings as short snake_case codes. Do not quote the student's text.",
    "Use bands 0-9 in 0.5 increments. The server will average four AI-returned criteria and run audit-only checks. Do not output overallBand.",
    `IELTS criterion band matrix for the locked ${task}:\n${criterionBandMatrixText(task)}`,
    halfBandDecisionProtocol(),
    "Band 0 is forbidden for any response containing assessable English, a relevant opinion, a reason, an example, or any real attempt to answer the prompt. Band 0 is only for blank, wholly non-English, explicit no-answer, or completely unassessable submissions. Very weak but rateable writing must be scored from Band 1.0 upward, not Band 0.",
    "If you believe a criterion is near zero but the essay has any topical English content, use a low positive half-band and explain the concrete limitation; do not output 0.0.",
    ...(taskSpecificPositiveRescueRules(task)),
    "For both Task 1 and Task 2, Band 0 means no assessable response, not merely missing examples, missing bullet points, weak development, poor tone, or limited language.",
    "Half-band rule: use X.5 when performance is clearly above X.0 but not stable at X+1.0. Do not prefer whole bands by default.",
    "Low-band rule: do not lift short/weak writing because it has paragraph labels. Full-length but weak-language writing should usually have lower LR/GRA, while TR/TA and CC may be higher only if content and organisation justify it.",
    "Task-specific requirement rule: for Task 1, judge every extracted bullet separately as covered/partly/missing and let that evidence influence Task Achievement through the matrix. For Task 2, judge the exact question type and all required parts. Missing or thin parts should affect AI scoring, but there is no local cap or floor.",
    "Midband source-of-truth rule: local taskRequirementAudit is advisory evidence only in midband mode. Do not treat any local advisory cap as a ceiling. You must decide TA/TR and LR/GRA from the actual prompt and essay.",
    "Band 5 reality rule: Band 5 writing can still have visible errors, simple vocabulary and simple sentence structures. If the main message is clear and the task is basically completed, do not keep LR/GRA below 5.0 merely because the style is basic.",
    `Exam-realism calibration for ${task}:\n${examRealismCalibrationRulesForTask(task)}`,
    `Primary 4.0-6.5 midband calibration for ${task}:\n${midbandCalibrationRulesForTask(task)}`,
    `v8.5.5 score-scale calibration for ${task}:\n${scoreScaleCalibrationText(task)}`,
    `v8.5.6 forced anchor-comparison calibration for ${task}:\n${v856ForcedAnchorComparisonProtocol(task)}`,
    `${v855ExtremeBandDecisionProtocol(task)}`,
    `${v856ForcedAnchorComparisonProtocol(task)}`,
    "Task 1 calibration: a complete-looking letter is not automatically Band 7. If it is basic, repetitive, awkward, thin, or error-prone, keep it in Band 4/5/6 according to the matrix. If it is natural, precise and well controlled, allow 7/8/9.",
    task === "Task 1" ? `Task 1 corrected Band 5 anchor:\n${task1CorrectedBand5AnchorText()}` : "Task 1 corrected Band 5 anchor: not applicable.",
    "Task 2 calibration: a long essay with paragraphs is not automatically Band 6/7. If reasoning is shallow and language weak, keep it low/mid. If reasoning is mature and language controlled, allow 8/9.",
    "Task 2 two-question rule: when the prompt contains two direct questions, each direct question is a required part. A basic but complete answer that addresses both questions should not be treated as missing task response merely because the development is simple.",
    "High-band rule: if task fulfilment, reasoning/cohesion, lexis and grammar are genuinely high-band, use 7.5/8/8.5/9 where justified; do not cap mature writing at four 7s. For polished, fully relevant, naturally organised answers with few errors, 8.0 is normal, not exceptional. Band 8.5/9 does not require literary native-speaker prose; it requires complete task fulfilment, natural control, precision and negligible errors. If the only limitation is that the text is not flamboyant, do not hold it at 7.5.", 
    "Criterion differentiation rule: score TA/TR, CC, LR and GRA independently before thinking about Overall. Avoid mechanical all-four-same bands. If all four are identical, reasonCodes must prove that each criterion separately deserves that same half-band; otherwise use a justified 0.5 spread.",
    "Calibration failure warning: if a clear Band 8/9-quality sample is scored around 6.0/6.5, that is under-scoring. If a clearly weak Band 3/4 sample is scored around 5.5, that is over-scoring. Use the entire 0-9 scale.",
    `Task boundary protocol: ${bandBoundaryProtocolForTask(task)}`,
    `0-9 anchor mini table: ${anchorMini}`,
    taskMini,
    "AI-only rule: ignore all local risk signals, local likely zones, local word-count boundaries, local spelling/grammar counters, and local task-requirement caps when choosing bands. Use only the prompt, the student response, and the 0-9 criterion matrix.",
    "Full-range calibration rule: do not compress scores toward 5.5/6.5. Very weak full-length writing may still be Band 3/4 if communication, control, and development match those descriptors. Strong, polished writing must be allowed to reach 7.5/8/8.5/9 when the matrix supports it.",
    "Adjacent-band rule: before returning each criterion, mentally compare the selected band against the lower 0.5 and higher 0.5. Pick the closest descriptor, not the safest middle score.",
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return exactly this JSON shape: {\"ok\":true,\"aiStage\":\"score-kernel\",\"task\":\"Task 1 or Task 2\",\"anchorBand\":number,\"candidateRange\":\"x-y\",\"criteria\":{...four criterion bands as numbers...},\"reasonCodes\":{\"Criterion Name\":[\"short_code\",\"short_code\"]},\"flags\":{\"lowBandRisk\":boolean,\"weakLanguage\":boolean,\"highBandCandidate\":boolean,\"allFourSeven\":boolean,\"boundaryReviewSuggested\":boolean}}"
  ].join("\n\n");
}

function compactCriterionCalibration(ai = {}, criteria = {}, task = "Task 2") {
  const names = criterionNames(task);
  const reasons = ai.shortReasons && typeof ai.shortReasons === "object" ? ai.shortReasons : (ai.reasonCodes && typeof ai.reasonCodes === "object" ? ai.reasonCodes : {});
  const out = {};
  names.forEach((name) => {
    const band = Number(criteria[name]);
    const rawReason = criterionKeyAliases(name, task).map((key) => reasons[key]).find((value) => value !== undefined && value !== null);
    const reason = Array.isArray(rawReason) ? rawReason.join(", ") : String(rawReason || `Score kernel reason for Band ${Number.isFinite(band) ? band.toFixed(1) : "-"}.`).trim();
    out[name] = {
      band,
      selectedBand: band,
      summary: reason,
      whyThisBand: reason,
      whyNotLower: "Core score pass froze the band; detailed lower-bound evidence is generated after freeze.",
      whyNotHigher: "Core score pass froze the band; detailed higher-bound evidence is generated after freeze.",
      howToImprove: defaultImproveForCriterion(name),
      positiveEvidence: [],
      limitingEvidence: [],
      essayEvidence: [],
      compactOnly: true
    };
  });
  return out;
}
// Detailed criterion feedback generation is intentionally not implemented here.
// Use /api/criterion-feedback after the score is frozen.

function freezeReviewedScore(result = {}, body = {}, signals = {}) {
  const initialCriteria = normalizeCriteria(result.finalCriteria || result.criteria, signals.task);
  assertNoImpossibleZeroBand(initialCriteria, signals);
  const initialAverage = averageBand(initialCriteria);
  if (!Number.isFinite(initialAverage.finalBand)) throw new Error("AI returned incomplete criterion bands in compact score pass.");
  const initialAnchorComparison = normalizeAnchorComparison(result.anchorComparison || result.anchorCalibration || {}, signals.task, initialCriteria, signals);
  const localCalibrationAudit = applyLocalRegressionCalibration(initialCriteria, signals, initialAnchorComparison, body);
  const criteria = initialCriteria;
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  const calibration = normalizeCriterionCalibration(result.criterionCalibration || {}, criteria, signals.task);
  const anchorComparison = normalizeAnchorComparison(result.anchorComparison || result.anchorCalibration || {}, signals.task, criteria, signals);
  const boundaryAuditBase = result.boundaryAudit || buildHardBoundaryAudit(criteria, signals, anchorComparison, calibration, { skipFeedbackQualityAudit: true });
  const boundaryAudit = localCalibrationAudit.changed ? { ...boundaryAuditBase, localAuditNotesOnly: localCalibrationAudit.notes, localCalibrationApplied: false } : boundaryAuditBase;
  assertFinalCanFreeze({ ...result, criteria, finalCriteria: criteria, boundaryAudit, anchorComparison, criterionCalibration: calibration, localSignals: signals });
  return {
    ...result,
    ok: true,
    aiStage: "score-core",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task: signals.task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    localSignals: signals,
    taskProfile: result.taskProfile || buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration: calibration,
    scoreProfile: buildLocalGateReport(criteria, signals, result.scoreProfile || {}, anchorComparison, calibration),
    taskSpecificGate: normalizeTaskSpecificGate(result.taskSpecificGate || {}, signals, criteria, anchorComparison, calibration),
    boundaryAudit: { ...boundaryAudit, reviewRequired: false, freezeBlocked: false },
    stabilityWarnings: collectScoreWarnings(criteria, signals),
    scoreCalculation: {
      mode: signals.task === "Task 1" ? "task1_gt_letter_v8_3_1_score_kernel_feedback_after_freeze" : "task2_essay_v8_3_1_score_kernel_feedback_after_freeze",
      formula: "v8.5.0 AI-only criterion band matrix core: AI returns task-locked four criterion bands using the 0-9 matrix and 0.5 increments; wrong cross-task criterion keys are rejected; strict hard-zero is limited to blank/non-English/explicit no-answer; false Band 0 is routed through AI rescue; local cap/floor/regression calibration is disabled. Detailed feedback is generated only by /api/criterion-feedback and cannot change the score.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No local cap/floor/lift/lowering. Local checks are audit/review triggers only; final bands are AI-returned and mechanically averaged."
    },
    scoreCoreMeta: { ...(result.scoreCoreMeta || {}), scoreFirst: true, scoreFrozen: true, strictBoundaryAudited: true, sub7StrictCalibrated: false, localCalibrationApplied: false, localScoreInterferenceDisabled: true, feedbackAfterFreeze: false, externalCriterionFeedback: true, compactScoreFirst: true, generatedAt: new Date().toISOString(), stage: "single-pass-score-core" },
    localScoreChanged: false
  };
}

function anchorComparisonFromKernel(ai = {}, task = "Task 2", criteria = {}, signals = {}) {
  const rawBand = Number(ai.anchorBand ?? ai.closestAnchorBand ?? ai.anchorComparison?.closestAnchorBand);
  const fallback = defaultAnchorComparison(task, criteria, signals);
  const closest = Number.isFinite(rawBand) ? Math.max(0, Math.min(9, Math.round(rawBand))) : fallback.closestAnchorBand;
  const lower = Math.max(0, closest - 1);
  const higher = Math.min(9, closest + 1);
  const anchor = anchorSetForTask(task).find((item) => item.band === closest) || {};
  const reasonCodes = ai.reasonCodes && typeof ai.reasonCodes === "object" ? JSON.stringify(ai.reasonCodes).slice(0, 500) : "score kernel reason codes";
  return normalizeAnchorComparison({
    anchorSystem: `${taskRuleLabel(task)} score-kernel anchor`,
    closestAnchorBand: closest,
    lowerAnchorBand: lower,
    higherAnchorBand: higher,
    candidateRange: String(ai.candidateRange || `${Math.max(0, closest - 0.5)}-${Math.min(9, closest + 0.5)}`),
    closestAnchorProfile: anchor.profile || "",
    closestAnchorProfileZh: anchor.zh || "",
    whyCloserToThisBand: `Score kernel selected Band ${closest} anchor using task fit, development and language-control reason codes: ${reasonCodes}`,
    whyNotLowerAnchor: `Reason codes show enough task response, organisation or language control to avoid the lower anchor.` ,
    whyNotHigherAnchor: `Reason codes show limitations preventing the next higher anchor.`,
    highBandCandidate: Boolean(ai.flags?.highBandCandidate),
    lowBandCandidate: Boolean(ai.flags?.lowBandRisk)
  }, task, criteria, signals);
}

function normalizeScoreKernelResult(ai, body, signals, boundaryProfile = null) {
  const task = signals.task || (body.task === "Task 1" ? "Task 1" : "Task 2");
  const criteria = normalizeCriteria(ai.criteria || ai.finalCriteria, task);
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  if (!Number.isFinite(finalBand)) throw new Error("AI score kernel returned incomplete criterion bands.");
  const anchorComparison = anchorComparisonFromKernel(ai, task, criteria, signals);
  const criterionCalibration = compactCriterionCalibration(ai, criteria, task);
  const scoreProfile = buildLocalGateReport(criteria, signals, {}, anchorComparison, criterionCalibration);
  const taskSpecificGate = normalizeTaskSpecificGate({}, signals, criteria, anchorComparison, criterionCalibration);
  const boundaryAudit = buildHardBoundaryAudit(criteria, signals, anchorComparison, criterionCalibration, { skipFeedbackQualityAudit: true });
  const warnings = collectScoreWarnings(criteria, signals);
  return {
    ok: true,
    aiStage: "score-kernel",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration,
    scoreProfile,
    taskSpecificGate,
    boundaryAudit,
    shortReasons: ai.shortReasons || ai.reasonCodes || {},
    reasonCodes: ai.reasonCodes || {},
    boundaryFlags: ai.flags || ai.boundaryFlags || {},
    scoreKernel: {
      anchorBand: Number(ai.anchorBand ?? anchorComparison.closestAnchorBand),
      candidateRange: String(ai.candidateRange || anchorComparison.candidateRange || ""),
      flags: ai.flags || {},
      reasonCodes: ai.reasonCodes || {}
    },
    diagnosticSignals: { boundaryProfile: boundaryProfile || getLocalBandBoundaryProfile(signals) },
    examinerSummary: "Core score kernel completed. Detailed evidence is generated only after score freeze.",
    examinerSummaryZh: "核心评分内核已完成。详细证据只在分数冻结后生成。",
    stabilityWarnings: warnings,
    scoreCalculation: {
      mode: task === "Task 1" ? "task1_gt_letter_v8_3_1_score_kernel" : "task2_essay_v8_3_1_score_kernel",
      formula: "v8.4.0 score-kernel pipeline: AI returns a tiny score kernel first; strict hard-zero is limited to blank/non-English/explicit no-answer; false Band 0 is routed through AI positive-level rescue; final AI-returned bands are frozen and averaged; local audit does not change bands; required detailed feedback is generated only by /api/criterion-feedback and cannot change the score.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No local band assignment. The server audits, may require AI boundary review, and freezes AI-returned bands. It does not generate detailed feedback in this endpoint."
    },
    criterionDifferentiationAudit: buildCriterionDifferentiationAudit(criteria),
    localLogicAudit: buildLocalLogicAudit(),
    scoreFrozen: false,
    feedbackCanChangeScore: false,
    scoreCoreMeta: { scoreKernelFirst: true, scoreFrozen: false, feedbackAfterFreeze: false, externalCriterionFeedback: true, compactScoreFirst: true, generatedAt: new Date().toISOString(), stage: "score-kernel" },
    localScoreChanged: false
  };
}

async function callScoreKernel(body, signals, boundaryProfile) {
  try {
    return await callDeepSeek([
      { role: "system", content: "You are an IELTS GT Writing score-kernel engine. Use the full 0-9 IELTS scale with strict low/high anchors. Return one tiny valid JSON object only. No feedback, no Chinese, no quotes." },
      { role: "user", content: buildCompactScorePrompt(body, signals, null) }
    ], 1900, 0);
  } catch (error) {
    if (!/MalformedAiJsonError|malformed JSON|valid JSON|JSON/i.test(String(error?.name || "") + " " + String(error?.message || ""))) throw error;
    const names = criterionNames(signals.task);
    const compactSignals = {
      task: signals.task,
      wordCount: signals.wordCount,
      rateabilityStatus: signals.rateabilityStatus,
      spellingErrorDensity: signals.spellingErrorDensity,
      grammarErrorDensity: signals.grammarErrorDensity,
      lexicalControl: signals.lexicalControl,
      sentenceControl: signals.sentenceControl,
      boundaryProfile: boundaryProfile?.likelyZone || ""
    };
    const emergencyPrompt = [
      "Return one tiny valid JSON object only. No feedback. No Chinese. No evidence. No quotes from the essay.",
      `Task: ${signals.task}. Criteria keys: ${JSON.stringify(names)}.`,
      `Local signals: ${JSON.stringify(compactSignals)}`,
      `Prompt: ${body.questionPrompt || body.promptText || ""}`,
      `Essay: ${body.essay || ""}`,
      "JSON shape: {\"ok\":true,\"aiStage\":\"score-kernel\",\"task\":\"Task 1 or Task 2\",\"anchorBand\":number,\"candidateRange\":\"x-y\",\"criteria\":{...four numeric bands...},\"reasonCodes\":{\"Criterion Name\":[\"code\",\"code\"]},\"flags\":{\"lowBandRisk\":boolean,\"weakLanguage\":boolean,\"highBandCandidate\":boolean,\"allFourSeven\":boolean,\"boundaryReviewSuggested\":boolean}}"
    ].join("\n\n");
    return await callDeepSeek([
      { role: "system", content: "Emergency IELTS score-kernel JSON generator. Return JSON only." },
      { role: "user", content: emergencyPrompt }
    ], 1000, 0);
  }
}


function taskSpecificPositiveRescueRules(task = "Task 2") {
  if (task === "Task 1") {
    return [
      "Task 1 zero rule: Band 0 is only for no assessable GT letter at all: blank, wholly non-English, explicit no-answer, fully copied prompt, or completely unassessable fragments.",
      "Task 1 positive-band rule: if the response contains any assessable English letter/message attempt, visible purpose, request, complaint, apology, invitation, explanation, greeting/closing, or any relevant bullet-point content, Task Achievement must be a low positive band rather than Band 0.",
      "Task 1 weak-but-rateable rule: missing bullets, wrong tone, thin details, or poor letter layout can justify a low Task Achievement band, but not Band 0 when there is a real message to the reader.",
      "Task 1 exam-realism rule: a weak but understandable letter with many basic grammar/spelling errors and limited detail is usually around Band 4.0-5.0 overall, not automatically 5.0+. Band 5+ needs generally clear purpose and some bullet coverage; Band 6+ needs adequate bullet coverage, detail, tone/register, and language control.",
      "Task 1 corrected-letter calibration: if obvious grammar/spelling errors are mostly fixed, the message is clear, and all bullets are covered with basic details, then Band 5.0-5.5 is realistic even when vocabulary and sentence patterns remain simple.",
      "Task 1 language ceiling rule: if errors such as wrong verb forms, missing articles/prepositions, misspellings, and awkward word choice are frequent across sentences, keep Lexical Resource and Grammar around low-mid bands unless the text shows clear stronger control.",
      "Task 1 criteria must be exactly: Task Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy."
    ];
  }
  return [
    "Task 2 zero rule: Band 0 is only for no assessable essay response at all: blank, wholly non-English, explicit no-answer, fully copied prompt, or completely unassessable fragments.",
    "Task 2 positive-band rule: if the response contains any assessable English essay attempt, relevant opinion, position, reason, example, conclusion, or answer to any part of the prompt, Task Response must be a low positive band rather than Band 0.",
    "Task 2 weak-but-rateable rule: no examples, shallow reasoning, undeveloped ideas, weak paragraphing, or vague opinions can justify a low Task Response band, but not Band 0 when there is a real attempt to answer.",
    "Task 2 two-question prompt rule: when the prompt asks two direct questions, both parts must be answered, but a basic complete response that answers both should be treated as Band 5/5.5 material if the answer is relevant and understandable. Do not misread limited development as missing task response.",
    "Task 2 exam-realism rule: a response can be positive-band but still very low if it is a wrong format, wrong topic, list of assertions, or barely developed. Band 5+ requires some relevant development; Band 6+ requires a clear position and adequately extended ideas, not only a list of assertions.",
    "Task 2 language ceiling rule: frequent basic grammar/spelling/word-form problems should keep Lexical Resource and Grammar around low-mid bands unless the text shows clear stronger control.",
    "Task 2 criteria must be exactly: Task Response, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy."
  ];
}

function taskSpecificPositiveLevelSchema(task = "Task 2") {
  const names = criterionNames(task);
  return {
    task,
    criteria: names,
    positiveBandLevels: Object.fromEntries(names.map((name) => [name, "integer 1-17 only; 0 forbidden"])),
    taskSpecificRules: taskSpecificPositiveRescueRules(task)
  };
}

async function retryScoreKernelAfterImpossibleZero(body, signals, boundaryProfile, previousAi = {}) {
  const names = criterionNames(signals.task);
  const prompt = [
    "Return one tiny valid JSON object only. No feedback, no Chinese, no markdown.",
    `Task is locked as ${signals.task}. Criteria keys: ${JSON.stringify(names)}.`,
    ...(taskSpecificPositiveRescueRules(signals.task)),
    "The previous score-kernel returned Band 0 for a response that is not strict hard-zero. That is invalid.",
    "Band 0 is only allowed for blank, wholly non-English, explicit no-answer, or completely unassessable submissions.",
    "This response must be scored as weak-but-rateable if it contains any relevant English attempt, opinion, reason, example, or answer to the prompt. Use Band 1.0-9.0 half-bands, not Band 0, unless it is truly blank/non-English/no-answer.",
    `Local signals: ${JSON.stringify({ task: signals.task, wordCount: signals.wordCount, paragraphCount: signals.paragraphCount, sentenceCount: signals.sentenceCount, rateabilityStatus: signals.rateabilityStatus, hardZeroGate: signals.hardZeroGate, boundaryProfile: boundaryProfile?.likelyZone || "" })}`,
    `Previous invalid compact result: ${JSON.stringify(previousAi).slice(0, 1200)}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    `JSON shape: {"ok":true,"aiStage":"score-kernel","task":"Task 1 or Task 2","anchorBand":number,"candidateRange":"x-y","criteria":{...four numeric bands...},"reasonCodes":{"Criterion Name":["code","code"]},"flags":{"lowBandRisk":boolean,"weakLanguage":boolean,"highBandCandidate":boolean,"allFourSeven":boolean,"boundaryReviewSuggested":boolean}}`
  ].join("\n\n");
  return await callDeepSeek([
    { role: "system", content: "IELTS score-kernel zero-band retry. Return JSON only." },
    { role: "user", content: prompt }
  ], 1400, 0);
}


async function rescueScoreKernelWithoutZero(body, signals, boundaryProfile, previousAi = {}, previousError = null) {
  const names = criterionNames(signals.task);
  const prompt = [
    "Return one tiny valid JSON object only. No feedback, no Chinese, no markdown.",
    "This is an AI-only rescue scoring pass after repeated invalid Band 0 output.",
    `Task is locked as ${signals.task}. Criteria keys must be exactly ${JSON.stringify(names)}.`,
    ...(taskSpecificPositiveRescueRules(signals.task)),
    "The server has confirmed this response is NOT strict hard-zero. It is not blank, not wholly non-English, and not an explicit no-answer.",
    "Therefore, Band 0 is not an available score for any criterion in this rescue pass.",
    "Score strictly from Band 1.0 to Band 9.0 in 0.5 increments. If performance is extremely weak, use Band 1.0 or 1.5, but never 0.0.",
    "Do not inflate the score. This rescue pass exists only to avoid a false zero; it must still choose the lowest realistic IELTS band supported by the actual writing.",
    "Do not use Band 5.0 as a safe/default rescue value. Choose Band 4.0/4.5 when the response is understandable but has frequent basic errors, limited detail, or weak development; choose Band 5.0 only if the evidence meets Band 5 descriptors.",
    "For Task Achievement/Task Response, distinguish: completely no answer = 0; assessable task attempt with thin detail/development = low positive band, not 0. Apply this equally to Task 1 letters and Task 2 essays.",
    "For Coherence, Lexical Resource, and Grammar, assign the lowest positive band that reflects the actual text if there is any assessable English.",
    `Local non-scoring signals: ${JSON.stringify({ task: signals.task, wordCount: signals.wordCount, paragraphCount: signals.paragraphCount, sentenceCount: signals.sentenceCount, rateabilityStatus: signals.rateabilityStatus, hardZeroGate: signals.hardZeroGate, boundaryProfile: boundaryProfile?.likelyZone || "" })}`,
    `Previous invalid result: ${JSON.stringify(previousAi).slice(0, 1500)}`,
    `Previous validation error: ${String(previousError?.message || previousError || "").slice(0, 500)}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    `Return exactly: {"ok":true,"aiStage":"score-kernel","task":"${signals.task}","anchorBand":number,"candidateRange":"x-y","criteria":{...four numeric bands, all >= 1.0...},"reasonCodes":{"Criterion Name":["specific_code","specific_code"]},"flags":{"lowBandRisk":boolean,"weakLanguage":boolean,"highBandCandidate":boolean,"allFourSeven":boolean,"boundaryReviewSuggested":boolean}}`
  ].join("\n\n");
  return await callDeepSeek([
    { role: "system", content: "IELTS AI no-zero rescue scorer. Return JSON only. Never return Band 0 for non-hard-zero writing." },
    { role: "user", content: prompt }
  ], 1700, 0);
}


function shouldRunFinalPositiveBandRepair(error = {}) {
  const msg = String(error?.message || error || "");
  return error?.code === "IMPOSSIBLE_ZERO_BAND"
    || /valid half-band|Invalid IELTS band|incomplete criterion bands|Band 0 for a rateable/i.test(msg);
}

function parsePositiveLevelValue(value) {
  if (value && typeof value === "object") {
    const candidates = [value.level, value.positiveLevel, value.bandLevel, value.value, value.score, value.band];
    for (const candidate of candidates) {
      const parsed = parsePositiveLevelValue(candidate);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    const levelMatch = text.match(/(?:level|positive\s*level|band\s*level)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (levelMatch) return Number(levelMatch[1]);
    const bandMatch = text.match(/band\s*([1-9](?:\.5|\.0)?)/i);
    if (bandMatch) {
      const band = Number(bandMatch[1]);
      if (Number.isFinite(band) && band >= 1 && band <= 9) return Math.round((band - 1) / 0.5 + 1);
    }
    const plain = text.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
    if (plain) return Number(plain[1]);
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveBandLevelToBand(level) {
  const parsed = parsePositiveLevelValue(level);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 17) return null;
  return 1 + (rounded - 1) * 0.5;
}

function positiveLevelSourceCandidates(ai = {}) {
  const direct = [ai.positiveBandLevels, ai.criterionPositiveLevels, ai.criteriaLevels, ai.bandLevels, ai.positiveLevels].filter(Boolean);
  const nested = [ai.criteria, ai.finalCriteria].filter((x) => x && typeof x === "object");
  return [...direct, ...nested];
}

function lookupCriterionValue(source = {}, name, task = "Task 2") {
  if (!source || typeof source !== "object") return undefined;
  for (const key of criterionKeyAliases(name, task)) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  const lowerMap = new Map(Object.entries(source).map(([k, v]) => [String(k).toLowerCase().replace(/[\s_&-]+/g, ""), v]));
  for (const key of criterionKeyAliases(name, task)) {
    const normalized = String(key).toLowerCase().replace(/[\s_&-]+/g, "");
    if (lowerMap.has(normalized)) return lowerMap.get(normalized);
  }
  return undefined;
}

function applyPositiveBandLevelsRepairAi(ai = {}, task = "Task 2") {
  const names = criterionNames(task);
  for (const source of positiveLevelSourceCandidates(ai)) {
    const criteria = {};
    const levelAudit = {};
    names.forEach((name) => {
      const raw = lookupCriterionValue(source, name, task);
      const band = positiveBandLevelToBand(raw);
      if (band !== null) {
        criteria[name] = band;
        levelAudit[name] = { raw, band };
      }
    });
    if (Object.keys(criteria).length === names.length) {
      return {
        ...ai,
        criteria,
        finalCriteria: criteria,
        anchorBand: positiveBandLevelToBand(ai.anchorPositiveLevel || ai.anchorBandLevel) || ai.anchorBand || Math.min(...Object.values(criteria)),
        positiveBandLevelAudit: levelAudit,
        aiStage: ai.aiStage || "score-kernel"
      };
    }
  }
  return ai;
}

async function finalPositiveBandRepairScoreKernel(body, signals, boundaryProfile, previousAi = {}, previousError = null) {
  const names = criterionNames(signals.task);
  const levelShape = Object.fromEntries(names.map((name) => [name, "integer 1-17 only"]));
  const bandScale = Array.from({ length: 17 }, (_, i) => `${i + 1}=${1 + i * 0.5}`).join(", ");
  const prompt = [
    "Return exactly one JSON object. No markdown. No explanation outside JSON.",
    "This is the final AI scoring repair pass for an IELTS GT Writing response.",
    `The selected task is locked as ${signals.task}. Do not reclassify it.`,
    ...(taskSpecificPositiveRescueRules(signals.task)),
    "The server has confirmed this is not strict hard-zero: not blank, not wholly non-English, and not an explicit no-answer.",
    "Do NOT return IELTS band numbers in the criteria field. Instead choose POSITIVE BAND LEVELS.",
    `Positive band level scale: ${bandScale}.`,
    "Level 1 means Band 1.0. Level 2 means Band 1.5. Level 17 means Band 9.0.",
    "There is no level 0. Do not output 0 anywhere. If the writing is extremely weak but assessable, choose level 1 or 2.",
    "Do not choose level 9 (Band 5.0) as a default. For frequent basic sentence errors, repeated misspellings, weak word choice, and limited development, levels 7-8 (Band 4.0-4.5) are often more realistic unless stronger evidence is present.",
    "For Task 1, level 9+ in Task Achievement requires generally clear purpose and some coverage of the actual bullet requirements; for Task 2, level 9+ in Task Response requires some relevant development of the actual prompt. Wrong task format or wrong topic must keep the first criterion low.",
    "Score the actual student response again. Do not copy the previous invalid all-zero result.",
    "Return the four criteria with the exact criterion names below. Do not abbreviate, rename, or omit any criterion.",
    `positiveBandLevels shape: ${JSON.stringify(levelShape)}`,
    `Task-synced rescue schema: ${JSON.stringify(taskSpecificPositiveLevelSchema(signals.task))}`,
    "Exam realism calibration: before selecting levels, identify whether the response is (a) wrong task/wrong topic, (b) task attempt with limited development, (c) generally adequate Band 5-level writing, or (d) Band 6+ writing. Do not skip directly from false-zero prevention to Band 5.",
    `Non-scoring local signals: ${JSON.stringify({ task: signals.task, wordCount: signals.wordCount, paragraphCount: signals.paragraphCount, sentenceCount: signals.sentenceCount, englishRatio: signals.englishRatio, rateabilityStatus: signals.rateabilityStatus, hardZeroGate: signals.hardZeroGate, boundaryProfile: boundaryProfile?.likelyZone || "" })}`,
    `Previous invalid result summary: ${JSON.stringify({ criteria: previousAi?.criteria || previousAi?.finalCriteria || null, anchorBand: previousAi?.anchorBand, candidateRange: previousAi?.candidateRange }).slice(0, 1000)}`,
    `Previous validation error: ${String(previousError?.message || previousError || "").slice(0, 600)}`,
    `Question prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    `Return exactly this schema with positive integer levels only: {"ok":true,"aiStage":"score-kernel","task":"${signals.task}","anchorPositiveLevel":1,"candidateRange":"positive-levels x-y","positiveBandLevels":${JSON.stringify(Object.fromEntries(names.map((name) => [name, "integer_1_to_17"])))},"reasonCodes":${JSON.stringify(Object.fromEntries(names.map((name) => [name, ["specific_reason","specific_reason"]])))},"flags":{"lowBandRisk":boolean,"weakLanguage":boolean,"highBandCandidate":boolean,"allFourSeven":boolean,"boundaryReviewSuggested":boolean}}`
  ].join("\n\n");
  return await callDeepSeek([
    { role: "system", content: "IELTS final positive-level JSON scorer. Return JSON only. Use positive levels 1-17. Level 0 is forbidden." },
    { role: "user", content: prompt }
  ], 2200, 0);
}


async function normalizeScoreKernelResultWithFinalPositiveRepair(ai, body, signals, boundaryProfile, previousError = null) {
  const repairedAi = await finalPositiveBandRepairScoreKernel(body, signals, boundaryProfile, ai, previousError);
  const repaired = normalizeScoreKernelResult(applyPositiveBandLevelsRepairAi(repairedAi, signals.task), body, signals, boundaryProfile);
  repaired.scoreCoreMeta = {
    ...(repaired.scoreCoreMeta || {}),
    zeroBandFinalPositiveRepairApplied: true,
    zeroBandFinalPositiveRepairReason: String(previousError?.message || previousError || "invalid zero-band kernel output")
  };
  return repaired;
}

async function normalizeScoreCoreResultWithFinalPositiveRepair(ai, body, signals, options = {}, previousError = null) {
  const boundaryProfile = getLocalBandBoundaryProfile(signals);
  const repairedAi = await finalPositiveBandRepairScoreKernel(body, signals, boundaryProfile, ai, previousError);
  const repaired = normalizeScoreCoreResult(applyPositiveBandLevelsRepairAi(repairedAi, signals.task), body, signals, options);
  repaired.scoreCoreMeta = {
    ...(repaired.scoreCoreMeta || {}),
    zeroBandFinalPositiveRepairApplied: true,
    zeroBandFinalPositiveRepairReason: String(previousError?.message || previousError || "invalid zero-band score output")
  };
  return repaired;
}

async function normalizeScoreKernelResultWithZeroRescue(ai, body, signals, boundaryProfile = null) {
  try {
    return normalizeScoreKernelResult(ai, body, signals, boundaryProfile);
  } catch (error) {
    if (!shouldRunFinalPositiveBandRepair(error)) throw error;
    const retryAi = await retryScoreKernelAfterImpossibleZero(body, signals, boundaryProfile, ai);
    try {
      const retried = normalizeScoreKernelResult(retryAi, body, signals, boundaryProfile);
      retried.scoreCoreMeta = { ...(retried.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRetryReason: String(error.message || error) };
      return retried;
    } catch (retryError) {
      if (!shouldRunFinalPositiveBandRepair(retryError)) throw retryError;
      const rescueAi = await rescueScoreKernelWithoutZero(body, signals, boundaryProfile, retryAi, retryError);
      try {
        const rescued = normalizeScoreKernelResult(rescueAi, body, signals, boundaryProfile);
        rescued.scoreCoreMeta = { ...(rescued.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRescueApplied: true, zeroBandRetryReason: String(error.message || error), zeroBandRescueReason: String(retryError.message || retryError) };
        return rescued;
      } catch (rescueError) {
        if (!shouldRunFinalPositiveBandRepair(rescueError)) throw rescueError;
        const finalRepaired = await normalizeScoreKernelResultWithFinalPositiveRepair(rescueAi, body, signals, boundaryProfile, rescueError);
        finalRepaired.scoreCoreMeta = { ...(finalRepaired.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRescueApplied: true, zeroBandRetryReason: String(error.message || error), zeroBandRescueReason: String(retryError.message || retryError) };
        return finalRepaired;
      }
    }
  }
}

async function normalizeScoreCoreResultWithZeroRescue(ai, body, signals, options = {}) {
  try {
    return normalizeScoreCoreResult(ai, body, signals, options);
  } catch (error) {
    if (!shouldRunFinalPositiveBandRepair(error)) throw error;
    const boundaryProfile = getLocalBandBoundaryProfile(signals);
    const retryAi = await retryScoreKernelAfterImpossibleZero(body, signals, boundaryProfile, ai);
    try {
      const retried = normalizeScoreCoreResult(retryAi, body, signals, options);
      retried.scoreCoreMeta = { ...(retried.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRetryReason: String(error.message || error) };
      return retried;
    } catch (retryError) {
      if (!shouldRunFinalPositiveBandRepair(retryError)) throw retryError;
      const rescueAi = await rescueScoreKernelWithoutZero(body, signals, boundaryProfile, retryAi, retryError);
      try {
        const rescued = normalizeScoreCoreResult(rescueAi, body, signals, options);
        rescued.scoreCoreMeta = { ...(rescued.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRescueApplied: true, zeroBandRetryReason: String(error.message || error), zeroBandRescueReason: String(retryError.message || retryError) };
        return rescued;
      } catch (rescueError) {
        if (!shouldRunFinalPositiveBandRepair(rescueError)) throw rescueError;
        const finalRepaired = await normalizeScoreCoreResultWithFinalPositiveRepair(rescueAi, body, signals, options, rescueError);
        finalRepaired.scoreCoreMeta = { ...(finalRepaired.scoreCoreMeta || {}), zeroBandRetryApplied: true, zeroBandRescueApplied: true, zeroBandRetryReason: String(error.message || error), zeroBandRescueReason: String(retryError.message || retryError) };
        return finalRepaired;
      }
    }
  }
}

async function scoreCore(body) {
  const signals = resolveScoringSignals(body);
  const hardZeroGate = signals.hardZeroGate || detectHardZeroResponse(body, signals);
  if (isStrictHardZeroGate(hardZeroGate)) {
    return buildHardZeroScore(body, signals, hardZeroGate);
  }
  const boundaryProfile = getLocalBandBoundaryProfile(signals);

  // Step 2: one tiny AI score kernel call. No separate anchor call and no detailed feedback here.
  const kernelAi = await callScoreKernel(body, signals, boundaryProfile);
  const first = await normalizeScoreKernelResultWithZeroRescue(kernelAi, body, signals, boundaryProfile);

  // Step 3/4: production midband route skips the old mandatory boundary adjudicator.
  // The first AI score is still locally hard-audited and mechanically frozen, but ordinary
  // Band 4.0-6.5 scripts are no longer re-scored by boundary/lowband logic.
  const midbandPrimaryMode = isMidbandPrimaryScoringRequest(body);
  const reviewed = midbandPrimaryMode
    ? bypassBoundaryReviewForMidband(body, first)
    : await applyBoundaryReviewIfNeeded(body, first);

  // Step 4B: AI-only criterion differentiation challenge for all-four-same mid/high profiles.
  // This is still AI scoring only; local code never invents or adjusts bands.
  const differentiated = await applyCriterionDifferentiationReviewIfNeeded(body, reviewed);

  // Step 5A: freeze the AI-returned final criteria and mechanically average them.
  const frozen = freezeReviewedScore(differentiated, body, signals);

  // Step 5B is intentionally external in v8.4.0.
  // Core scoring must freeze quickly and reliably; detailed criterion feedback is generated
  // by /api/criterion-feedback after the frozen score is returned. This prevents a long
  // feedback JSON failure from affecting the scoring response.
  const withFeedbackPlan = {
    ...frozen,
    feedbackStatus: {
      status: "required_external",
      scoreChanged: false,
      note: "Core score is frozen. Required detailed criterion feedback must be generated by /api/criterion-feedback and cannot change the score."
    },
    scoreCoreMeta: {
      ...(frozen.scoreCoreMeta || {}),
      fiveStepPipeline: true,
      scoreKernelFirst: true,
      scoreFrozenBeforeFeedback: true,
      feedbackGenerated: false,
      feedbackRequiredExternal: true,
      feedbackEndpoint: "/api/criterion-feedback",
      feedbackStatus: "required_external",
      midbandPrimaryMode: Boolean(isMidbandPrimaryScoringRequest(body)),
      mandatoryBoundaryReviewSkipped: Boolean(isMidbandPrimaryScoringRequest(body))
    }
  };
  return attachSinglePassProgress(withFeedbackPlan, "done");
}

function scorePrecheck(body) {
  const signals = resolveScoringSignals(body);
  return withDetailedProgress({
    ok: true,
    aiStage: "score-precheck",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    note: "Precheck only. No criterion band is assigned in this stage."
  }, "score-precheck");
}

function scoreTaskRouterStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  return withDetailedProgress({
    ...current,
    ok: true,
    aiStage: "score-task-router",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), taskRouted: true, stage: "task-router" },
    note: "Task routed. No criterion band is assigned in this stage."
  }, "score-task-router");
}

async function scoreAnchorStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS GT Writing independent anchor classifier. Return JSON only. Do not assign criterion bands." },
    { role: "user", content: buildIndependentAnchorPrompt(body, signals) }
  ], 2800, 0);
  const anchorComparison = normalizeAnchorComparison(ai.anchorComparison || ai.anchorCalibration || ai, signals.task, {}, signals);
  if (anchorComparison.anchorMissing) throw new Error("Independent anchor classification did not return a usable anchorComparison.");
  return withDetailedProgress({
    ...current,
    ok: true,
    aiStage: "score-anchor",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), anchorPrepared: true, independentAiAnchorReturned: true, stage: "anchor" },
    note: "AI independent anchor classification completed and will be used to calibrate criterion scoring."
  }, "score-anchor");
}

async function scoreCriteriaStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const independentAnchor = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, {}, signals);
  const prompt = buildCompactScorePrompt(body, signals, independentAnchor);
  const ai = await callDeepSeek([
    { role: "system", content: "You are an IELTS General Training Writing compact scoring engine. Return only short JSON scores; no detailed feedback." },
    { role: "user", content: prompt }
  ], 3000, 0);
  if (!ai.criterionCalibration && ai.shortReasons) {
    const compactCriteria = normalizeCriteria(ai.criteria || ai.finalCriteria, signals.task);
    ai.criterionCalibration = compactCriterionCalibration(ai, compactCriteria, signals.task);
  }
  const firstRaw = await normalizeScoreCoreResultWithZeroRescue(ai, body, signals, { independentAnchor, skipFeedbackQualityAudit: true });
  const criteria = firstRaw.finalCriteria || firstRaw.criteria;
  const anchorForResult = !independentAnchor.anchorMissing ? independentAnchor : firstRaw.anchorComparison;
  const calibration = normalizeCriterionCalibration(firstRaw.criterionCalibration || {}, criteria, signals.task);
  const first = {
    ...firstRaw,
    anchorComparison: anchorForResult,
    criterionCalibration: calibration,
    scoreProfile: buildLocalGateReport(criteria, signals, firstRaw.scoreProfile || {}, anchorForResult, calibration),
    taskSpecificGate: normalizeTaskSpecificGate(firstRaw.taskSpecificGate || {}, signals, criteria, anchorForResult, calibration),
    boundaryAudit: buildHardBoundaryAudit(criteria, signals, anchorForResult, calibration, firstRaw.boundaryAudit || {})
  };
  return withDetailedProgress({
    ...first,
    aiStage: "score-criteria",
    scoreCoreMeta: { ...first.scoreCoreMeta, scoreFrozen: false, stage: "criteria", boundaryAuditCompleted: false, boundaryReviewApplied: false, independentAnchorUsed: !anchorForResult.anchorMissing }
  }, "score-criteria");
}

function scoreGatesStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
  assertNoImpossibleZeroBand(criteria, signals);
  const normalizedCalibration = normalizeCriterionCalibration(current.criterionCalibration || {}, criteria, signals.task);
  const anchorComparisonForGates = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, criteria, signals);
  const scoreProfile = buildLocalGateReport(criteria, signals, current.scoreProfile || {}, anchorComparisonForGates, normalizedCalibration);
  const warnings = collectScoreWarnings(criteria, signals);
  const result = {
    ...current,
    ok: true,
    aiStage: "score-boundary-audit",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    task: signals.task,
    criteria,
    finalCriteria: criteria,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison: anchorComparisonForGates,
    criterionCalibration: normalizedCalibration,
    scoreProfile,
    taskSpecificGate: normalizeTaskSpecificGate(current.taskSpecificGate || {}, signals, criteria, anchorComparisonForGates, normalizedCalibration),
    boundaryAudit: buildHardBoundaryAudit(criteria, signals, anchorComparisonForGates, normalizedCalibration, current.boundaryAudit || {}),
    stabilityWarnings: warnings,
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), scoreFrozen: false, gatesChecked: true, stage: "gates" }
  };
  return withDetailedProgress(result, "score-boundary-audit");
}

async function scoreBoundaryReviewStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
  assertNoImpossibleZeroBand(criteria, signals);
  const calibration = normalizeCriterionCalibration(current.criterionCalibration || {}, criteria, signals.task);
  const anchorComparison = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, criteria, signals);
  const boundaryAudit = current.boundaryAudit || buildHardBoundaryAudit(criteria, signals, anchorComparison, calibration);
  const staged = { ...current, localSignals: signals, finalCriteria: criteria, criteria, criterionCalibration: calibration, anchorComparison, boundaryAudit };
  const reviewed = await applyBoundaryReviewIfNeeded(body, staged);
  assertNoImpossibleZeroBand(normalizeCriteria(reviewed.finalCriteria || reviewed.criteria, signals.task), signals);
  return withDetailedProgress({
    ...reviewed,
    aiStage: "score-boundary-review",
    scoreCoreMeta: { ...(reviewed.scoreCoreMeta || {}), scoreFrozen: false, stage: "boundary-review" }
  }, "score-boundary-review");
}

function scoreFinalizeStage(body) {
  const current = safeCurrentForTask(body, body.currentResult || {});
  const signals = resolveScoringSignals(body, current);
  const criteria = normalizeCriteria(current.finalCriteria || current.criteria, signals.task);
  assertNoImpossibleZeroBand(criteria, signals);
  const { rawAverage, finalBand } = averageBand(criteria);
  const calibration = normalizeCriterionCalibration(current.criterionCalibration || {}, criteria, signals.task);
  const anchorComparison = normalizeAnchorComparison(current.anchorComparison || current.anchorCalibration || {}, signals.task, criteria, signals);
  const scoreProfile = buildLocalGateReport(criteria, signals, current.scoreProfile || {}, anchorComparison, calibration);
  const boundaryAudit = current.boundaryAudit || buildHardBoundaryAudit(criteria, signals, anchorComparison, calibration);
  assertFinalCanFreeze({ ...current, criteria, finalCriteria: criteria, boundaryAudit, anchorComparison, criterionCalibration: calibration, localSignals: signals });
  const result = {
    ...current,
    ok: true,
    aiStage: "score-finalize",
    scoreSystemVersion: SCORE_SYSTEM_VERSION,
    disclaimer: DISCLAIMER,
    task: signals.task,
    criteria,
    finalCriteria: criteria,
    rawAverage,
    overallBand: finalBand,
    localSignals: signals,
    taskProfile: buildTaskProfile(body, signals),
    anchorComparison,
    criterionCalibration: calibration,
    scoreProfile,
    taskSpecificGate: normalizeTaskSpecificGate(current.taskSpecificGate || {}, signals, criteria, anchorComparison, calibration),
    boundaryAudit,
    stabilityWarnings: collectScoreWarnings(criteria, signals),
    scoreCalculation: {
      mode: signals.task === "Task 1" ? "task1_gt_letter_v8_5_ai_only_matrix" : "task2_essay_v8_5_ai_only_matrix",
      formula: "AI-only 0-9 criterion band matrix pipeline: AI scores four task-locked criteria using 0.5 increments; local code performs only strict hard-zero, task lock, audit routing, and mechanical averaging. No local cap, floor, lift, lowering, or regression calibration is applied.",
      criteria: Object.entries(criteria).map(([criterion, band]) => ({ criterion, band })),
      rawAverage,
      finalBand,
      localScoreChanged: false,
      localScoreChangeExplanation: "No local band assignment or modification. The server only locks task, blocks strict hard-zero cases, routes audit warnings to AI boundary review, and mechanically averages AI-returned final criterion bands."
    },
    scoreCoreMeta: { ...(current.scoreCoreMeta || {}), scoreFirst: true, scoreFrozen: true, strictBoundaryAudited: true, feedbackStagesMayNotChangeScore: true, generatedAt: new Date().toISOString(), stage: "finalize" },
    criterionDifferentiationAudit: buildCriterionDifferentiationAudit(criteria),
    localLogicAudit: buildLocalLogicAudit(),
    scoreFrozen: true,
    feedbackCanChangeScore: false,
    localScoreChanged: false
  };
  return withDetailedProgress(result, "score-finalize");
}
function buildRevisionPrompt(body) {
  const frozen = body.currentResult || body.frozenScore || {};
  return [
    "You are generating IELTS learning models only. Do not change or comment on the score.",
    "Return JSON only. Generate optional model/revision content based on the already frozen score.",
    `Frozen score: ${JSON.stringify({ criteria: frozen.criteria || frozen.finalCriteria, overallBand: frozen.overallBand || frozen.scoreCalculation?.finalBand })}`,
    `Task: ${normalizeRequestedTask(body)}`,
    `Prompt: ${body.questionPrompt || body.promptText || ""}`,
    `Student response: ${body.essay || ""}`,
    "Return {\"ok\":true,\"aiStage\":\"revision-generator\",\"revisionMeta\":{\"scoreUnchanged\":true},\"modelAnswerOutline\":\"...\",\"modelAnswer\":\"...\",\"revisedEssay\":\"...\"}."
  ].join("\n\n");
}

async function revisionGenerator(body) {
  const ai = await callDeepSeek([
    { role: "system", content: "You generate IELTS model answers and revised essays. You never change the frozen score." },
    { role: "user", content: buildRevisionPrompt(body) }
  ], 6500, 0.2);
  return {
    ok: true,
    aiStage: "revision-generator",
    disclaimer: DISCLAIMER,
    scoreUnchanged: true,
    generationOnly: true,
    task: normalizeRequestedTask(body),
    taskLocked: true,
    revisionMeta: { ...(ai.revisionMeta || {}), scoreUnchanged: true },
    modelAnswerOutline: String(ai.modelAnswerOutline || "").trim(),
    modelAnswer: String(ai.modelAnswer || "").trim(),
    revisedEssay: String(ai.revisedEssay || "").trim()
  };
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  if (req.method !== "POST") return sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  const body = normalizeIncomingBody(await readJsonBody(req));
  const requestedStage = body.aiStage || body.stage || (String(body.mode || "").toLowerCase() === "score" ? "score-core" : "score-core");
  const stage = String(requestedStage).toLowerCase();
  if (stage === "revision-generator" || stage === "revision") return sendJson(req, res, 200, await revisionGenerator(body));
  if (stage === "score-precheck") return sendJson(req, res, 200, scorePrecheck(body));
  if (stage === "score-task-router") return sendJson(req, res, 200, scoreTaskRouterStage(body));
  if (stage === "score-anchor") return sendJson(req, res, 200, await scoreAnchorStage(body));
  if (stage === "score-criteria") return sendJson(req, res, 200, await scoreCriteriaStage(body));
  if (stage === "score-boundary-audit" || stage === "score-gates") return sendJson(req, res, 200, scoreGatesStage(body));
  if (stage === "score-boundary-review") return sendJson(req, res, 200, await scoreBoundaryReviewStage(body));
  if (stage === "score-finalize") return sendJson(req, res, 200, scoreFinalizeStage(body));
  if (stage === "score-core") return sendJson(req, res, 200, await scoreCore(body));
  return sendJson(req, res, 400, { ok: false, error: `Unsupported clean scoring stage: ${stage}` });
}

module.exports = async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (error) {
    const detail = error?.message || String(error);
    const freezeBlocked = /freeze blocked|boundary audit|boundary review/i.test(detail);
    sendJson(req, res, Number(error?.status) || (freezeBlocked ? 409 : 502), {
      ok: false,
      error: freezeBlocked ? "Score freeze blocked by unresolved boundary audit." : "AI scoring failed. No non-AI score was generated.",
      provider: DEFAULT_PROVIDER,
      detail,
      businessError: freezeBlocked ? "评分冻结失败：边界校准冲突未解决，系统已阻止展示不可信分数。" : "评分失败：AI 核心评分没有返回可冻结的短 JSON 评分结果；系统已尝试零分重评、AI正分救援和正分等级修复。",
      scoreSystemVersion: SCORE_SYSTEM_VERSION,
      suggestion: freezeBlocked ? "请重试一次；如果连续出现，请检查独立锚点、四项全7复核和 boundaryAudit 返回内容。" : "Retry once. If it repeats, check Vercel logs; the zero-band retry/task-synced final positive-level repair also failed."
    });
  }
};

module.exports.config = { maxDuration: 300 };
