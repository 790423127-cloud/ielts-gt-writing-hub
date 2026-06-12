const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
const LIVE = /^(1|true|yes)$/i.test(String(process.env.AUDIT_LIVE || ""));
const BASE_URL = (process.env.AUDIT_BASE_URL || process.env.SMOKE_BASE_URL || "https://ielts-gt-writing-hub.vercel.app").replace(/\/$/, "");
const TIMEOUT_MS = Math.max(15000, Math.min(Number(process.env.AUDIT_TIMEOUT_MS) || 90000, 180000));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function countWords(text) {
  return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) || []).length;
}

function countParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function countSentences(text) {
  return (String(text || "").match(/[^.!?]+[.!?]+/g) || []).length || (String(text || "").trim() ? 1 : 0);
}

function isNumberBand(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 9;
}

function roundHalf(value) {
  return Math.round(Number(value) * 2) / 2;
}

function extractBand(result = {}) {
  const candidates = [
    result.finalBand,
    result.overallBand,
    result.score,
    result.band,
    result.scoreCalculation && result.scoreCalculation.finalBand,
    result.scoreCalculation && result.scoreCalculation.overallBand,
    result.visibleScore && result.visibleScore.finalBand
  ];
  for (const value of candidates) {
    if (isNumberBand(value)) return roundHalf(value);
  }
  return null;
}

function loadAuditExports(relativeFile, exportNames) {
  const absolute = path.join(ROOT, relativeFile);
  const source = fs.readFileSync(absolute, "utf8");
  const assignments = exportNames.map((name) => `\nmodule.exports.__audit.${name} = typeof ${name} === "undefined" ? undefined : ${name};`).join("");
  const wrapped = `${source}\nmodule.exports.__audit = module.exports.__audit || {};${assignments}\n`;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: createRequire(absolute),
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    fetch,
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    __dirname: path.dirname(absolute),
    __filename: absolute
  };
  vm.runInNewContext(wrapped, sandbox, { filename: absolute, displayErrors: true });
  return sandbox.module.exports.__audit || {};
}

async function postJson(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      throw new Error([`HTTP ${response.status}`, data.error, data.detail, data.provider, data.rawPreview].filter(Boolean).join(" | "));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function hasChinese(value) {
  if (!value) return false;
  if (typeof value === "string") return /[\u4e00-\u9fff]/.test(value);
  if (Array.isArray(value)) return value.some(hasChinese);
  if (typeof value === "object") return Object.values(value).some(hasChinese);
  return false;
}

function criteriaAllSame(criteria = {}) {
  const values = Object.values(criteria || {}).map(Number).filter(Number.isFinite);
  return values.length === 4 && values.every((value) => value === values[0]);
}

function buildLocalSamples() {
  return {
    task1: [
      {
        id: "t1-band3-request",
        task: "Task 1",
        questionType: "request",
        expectedBandMin: 3.0,
        expectedBandMax: 4.0,
        hardLowbandExpected: true,
        highbandExpected: false,
        reason: "Very short request letter with limited detail and weak task coverage.",
        prompt: "You work in a restaurant and want to reduce your evening shifts because of a course. Write a letter to your manager. In your letter, say why you are writing, explain the change you want, and say how this helps the restaurant.",
        essay: `Dear Manager,\n\nI want less evening work. I am busy with school.\n\nPlease help me.\n\nThanks,\nAlex`
      },
      {
        id: "t1-band4-complaint",
        task: "Task 1",
        questionType: "complaint",
        expectedBandMin: 4.0,
        expectedBandMax: 4.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Complaint is relevant but development is thin and the tone is not fully controlled.",
        prompt: "You recently stayed in a hotel and found several problems. Write a letter to the hotel manager. In your letter, explain the problems, say what you want the manager to do, and explain how the problems affected you.",
        essay: `Dear Manager,\n\nI am writing about my recent stay in your hotel. The room was noisy and the shower did not work very well.\n\nI want you to give me some money back and check the room more carefully. The problems made my trip tiring and unpleasant.\n\nRegards,\nSara`
      },
      {
        id: "t1-band4-5-apology",
        task: "Task 1",
        questionType: "apology",
        expectedBandMin: 4.5,
        expectedBandMax: 5.0,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Apology letter answers the task but remains simple and slightly uneven.",
        prompt: "You borrowed a friend's camera and broke it. Write a letter to apologise. In your letter, explain what happened, say how you feel, and say what you will do to fix the problem.",
        essay: `Dear Lisa,\n\nI am sorry about your camera. I dropped it when I was leaving my house.\n\nI feel very bad because I know it was important to you. I will pay for the repair or buy a replacement if needed.\n\nYours sincerely,\nTom`
      },
      {
        id: "t1-band5-request",
        task: "Task 1",
        questionType: "request",
        expectedBandMin: 5.0,
        expectedBandMax: 5.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Basic but complete request letter with clear purpose and all three points covered.",
        prompt: "You work in a restaurant and have started a part-time course. Write a letter to your manager asking to reduce your working hours. Explain why you are writing, describe the change you want, and explain how this change could benefit the restaurant.",
        essay: `Dear Mr Brown,\n\nI am writing to ask if it would be possible to reduce my evening shifts for the next three months. I have started a part-time course, and the classes take place after work.\n\nAt present I work four evenings each week. If possible, I would like to change two of those shifts to daytime hours so that I can attend my classes and arrive on time.\n\nThis change could also help the restaurant because I can continue working with more energy and later use my new skills to help with food preparation. Thank you for considering my request.\n\nYours sincerely,\nKevin`
      },
      {
        id: "t1-band5-5-invitation",
        task: "Task 1",
        questionType: "invitation",
        expectedBandMin: 5.0,
        expectedBandMax: 5.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Simple invitation with all bullet points addressed but limited detail.",
        prompt: "You are organising a small party to celebrate your friend's birthday. Write a letter inviting another friend. Explain why you are writing, describe the party, and say what help you need.",
        essay: `Dear Jenny,\n\nI am writing to invite you to my sister's birthday party next Saturday evening. We will have dinner at home and then play some games.\n\nThe party will start at 7 p.m. and several of our friends will be there. I think it will be a relaxed and fun evening.\n\nCould you help me by bringing some drinks and taking photos? I would really appreciate it if you could come.\n\nBest wishes,\nMia`
      },
      {
        id: "t1-band6-semi-formal",
        task: "Task 1",
        questionType: "semi-formal letter",
        expectedBandMin: 5.5,
        expectedBandMax: 6.0,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Clear purpose, appropriate tone, and better developed bullet points.",
        prompt: "You are moving to another department in your company. Write a letter to your current manager. In your letter, explain why you are leaving, what you have learned, and thank the manager for their help.",
        essay: `Dear Ms Green,\n\nI am writing to let you know that I will be moving to the marketing department next month. I have really enjoyed working in our team, but this new role is a good opportunity for my career.\n\nDuring my time here, I have learned how to organise tasks, work under pressure, and communicate clearly with customers. These skills will stay with me for a long time.\n\nThank you for your support and patience. You have always given me useful advice, and I have learned a great deal from you.\n\nKind regards,\nHannah`
      },
      {
        id: "t1-band6-5-complaint",
        task: "Task 1",
        questionType: "complaint",
        expectedBandMin: 6.0,
        expectedBandMax: 6.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Developed complaint with clear tone and a good structure.",
        prompt: "You recently bought a piece of furniture online, but it arrived damaged. Write a letter to the company. Explain the problem, describe what action you would like them to take, and say why this matters to you.",
        essay: `Dear Sir or Madam,\n\nI am writing to complain about a table I bought from your website last week. When it arrived, the surface was scratched and one leg was broken.\n\nI would like you to send me a new table as soon as possible or collect this damaged one and refund the full amount. I chose your company because I needed the furniture quickly, so this problem has caused me extra inconvenience.\n\nI would appreciate a prompt reply and clear instructions on how to solve this matter.\n\nYours faithfully,\nDaniel`
      },
      {
        id: "t1-band7-formal",
        task: "Task 1",
        questionType: "formal letter",
        expectedBandMin: 6.5,
        expectedBandMax: 7.0,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Well organised formal letter with appropriate detail and control.",
        prompt: "You want to organise a college anniversary celebration. Write to the college principal. In your letter, say what kind of event you want, explain why it would be good, and describe what help you need.",
        essay: `Dear Principal,\n\nI am writing to suggest a small anniversary celebration for our college. I believe a one-day event with speeches, music and a simple exhibition of old photos would be a good way to mark the occasion.\n\nThis kind of celebration would bring current students, teachers and alumni together. It would help everyone remember the college's history and create a stronger sense of pride in the school.\n\nTo organise the event, we would need permission to use the hall, help with publicity and support from staff to collect old photographs. I would be grateful if you could consider this proposal.\n\nYours faithfully,\nRiya`
      },
      {
        id: "t1-band7-5-application",
        task: "Task 1",
        questionType: "application",
        expectedBandMin: 7.0,
        expectedBandMax: 7.5,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Strong application letter with natural tone, precise request and clear supporting detail.",
        prompt: "You would like to do voluntary unpaid work at a museum. Write a letter applying for the position. Explain why you are interested, describe any relevant experience, and say when you are available.",
        essay: `Dear Museum Coordinator,\n\nI would like to apply for the voluntary position at your museum. I have always enjoyed history, and I think this role would let me learn more while helping visitors have a better experience.\n\nLast year I worked as a guide at my university open day, where I welcomed guests and answered simple questions about the campus. I also volunteered at a local library, so I am comfortable working with the public.\n\nI am available on weekends and during school holidays. I would be glad to attend an interview at any time that is convenient for you.\n\nYours faithfully,\nOwen`
      },
      {
        id: "t1-band8-formal",
        task: "Task 1",
        questionType: "formal letter",
        expectedBandMin: 7.5,
        expectedBandMax: 8.0,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Very controlled formal letter with strong fulfilment and fluent organisation.",
        prompt: "You want to suggest a change to the opening hours of your local library. Write to the library manager. Explain your suggestion, give reasons, and say how it would benefit local people.",
        essay: `Dear Library Manager,\n\nI am writing to suggest that the library remain open until 9 p.m. on weekdays. At the moment, many people who work or study during the day cannot use the library after normal hours.\n\nExtending the opening time would help students finish their reading and allow local workers to borrow books without rushing. It would also make the library more useful as a community space in the evening.\n\nIn my view, this small change would be practical and highly beneficial. Thank you for considering it.\n\nYours faithfully,\nElena`
      },
      {
        id: "t1-band8-5-informal",
        task: "Task 1",
        questionType: "informal letter",
        expectedBandMin: 8.0,
        expectedBandMax: 8.5,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Natural informal tone and precise response to all points.",
        prompt: "You are going to stay with a friend for a weekend. Write a letter thanking them and making a few arrangements. Explain what you appreciate, what time you will arrive, and what you would like to bring.",
        essay: `Dear Sam,\n\nThanks a lot for inviting me to stay with you next weekend. I really appreciate it, especially because I have been wanting a quiet break from work.\n\nI should arrive by train on Saturday morning at around 10:30, so I can get to your place before lunch. I will text you if the train is delayed.\n\nI can bring some snacks and a board game, if that would be useful. Please don't worry about anything else; I am looking forward to seeing you.\n\nBest,\nNina`
      },
      {
        id: "t1-band9-formal",
        task: "Task 1",
        questionType: "formal letter",
        expectedBandMin: 8.5,
        expectedBandMax: 9.0,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Near-native level formal letter with complete control, precision and natural tone.",
        prompt: "Write a formal letter to your local council suggesting improvements to a public park. Explain what improvements you want, why they are needed, and how they would help the community.",
        essay: `Dear Councillor,\n\nI am writing to suggest several improvements to Riverside Park. In particular, I believe the playground should be repaired, the walking paths resurfaced and a few more benches installed near the lake.\n\nThese changes are needed because the park is used by families, older residents and joggers every day, yet some parts are now worn and difficult to use. Better facilities would make the area safer, more comfortable and more attractive for everyone.\n\nI hope the council will consider these practical suggestions. Thank you for your time.\n\nYours faithfully,\nLeah`
      }
    ],
    task2: [
      {
        id: "t2-band3-opinion",
        task: "Task 2",
        questionType: "opinion",
        expectedBandMin: 3.0,
        expectedBandMax: 4.0,
        hardLowbandExpected: true,
        highbandExpected: false,
        reason: "Very limited response with weak development and limited control.",
        prompt: "Some people think children should spend more time outdoors. Do you agree or disagree?",
        essay: `I think outdoors is good. Children can play and be healthy. Schools should help them.`
      },
      {
        id: "t2-band4-discuss",
        task: "Task 2",
        questionType: "discuss both views",
        expectedBandMin: 4.0,
        expectedBandMax: 4.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Relevant but thin response with basic development.",
        prompt: "Some people think online learning is better than classroom learning, while others disagree. Discuss both views and give your opinion.",
        essay: `Online learning is good because it is easy and students can study at home. Some people also like classrooms because teachers can help more. I think both are useful, but classrooms are better for young students.`
      },
      {
        id: "t2-band4-5-advantages",
        task: "Task 2",
        questionType: "advantages_disadvantages",
        expectedBandMin: 4.5,
        expectedBandMax: 5.0,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Simple but relevant advantages/disadvantages answer.",
        prompt: "What are the advantages and disadvantages of working from home?",
        essay: `Working from home has advantages and disadvantages. It saves time because people do not need to travel, and it can also help them focus.\n\nHowever, some workers feel lonely and find it difficult to separate work from family life. In my opinion, it is useful if people have a quiet space and clear rules.`
      },
      {
        id: "t2-band5-two-question-crime",
        task: "Task 2",
        questionType: "two-question",
        expectedBandMin: 5.0,
        expectedBandMax: 6.0,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Complete two-question response with simple language, clear paragraphing and limited development.",
        prompt: `In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?`,
        essay: `In many countries, crime novels and TV crime dramas are becoming very popular. I think there are several reasons for this. In my opinion, these books and shows are interesting, but people should not spend too much time watching them.\n\nFirstly, crime stories are popular because they are exciting. Many people like to know who did the crime and why the person did it. When people watch a crime drama, they can follow the police or detective to find the answer. This makes the story more interesting than some normal TV programmes. Also, many crime stories have many surprises, so viewers want to keep watching until the end.\n\nSecondly, crime novels and TV dramas can show people some problems in society. For example, they may show stealing, murder, family problems or money problems. These things are not good, but they can make people think about real life. Some people also like these stories because they want to understand why criminals do bad things.\n\nIn my opinion, crime fiction and TV crime dramas can be good entertainment. They help people relax after work or study. They can also make people think more carefully. However, I also think there are some disadvantages. If the story has too much violence, it may not be suitable for young people. Some people may also feel afraid after watching too many crime dramas.\n\nIn conclusion, crime novels and TV crime dramas are popular because they are exciting and full of mystery. I think they are good if people watch or read them in a sensible way.`
      },
      {
        id: "t2-band5-5-causes",
        task: "Task 2",
        questionType: "causes_and_solutions",
        expectedBandMin: 5.0,
        expectedBandMax: 5.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Basic but complete causes-and-solutions essay.",
        prompt: "What are the main causes of traffic congestion in cities, and what solutions can you suggest?",
        essay: `Traffic congestion in cities happens for several reasons. First, many people now own private cars, so there are too many vehicles on the roads. Second, public transport is not always fast or comfortable enough.\n\nA possible solution is to improve buses and trains so that more people choose them instead of driving. Another idea is to build more roads and cycle lanes in busy areas. If governments take these actions, traffic problems should become less serious.`
      },
      {
        id: "t2-band5-5-opinion",
        task: "Task 2",
        questionType: "opinion",
        expectedBandMin: 5.0,
        expectedBandMax: 5.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Simple opinion essay with clear position and basic support.",
        prompt: "Some people believe that students should spend more time learning practical skills at school. To what extent do you agree or disagree?",
        essay: `I agree that students should spend more time learning practical skills. Academic subjects are important, but young people also need to know how to manage money, cook simple meals and communicate in daily life.\n\nThese skills are useful because they help students become more independent after they leave school. For example, a student who can budget well will be better prepared for university or work.\n\nIn conclusion, practical skills should have a larger place in school, although academic learning should still remain important.`
      },
      {
        id: "t2-band6-discuss-both",
        task: "Task 2",
        questionType: "discuss_both_views",
        expectedBandMin: 5.5,
        expectedBandMax: 6.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Balanced discussion with clear development and an opinion.",
        prompt: "Some people believe that working from home is better, while others prefer working in an office. Discuss both views and give your own opinion.",
        essay: `Working from home has become more common, and people have different views about it. Some say it is better because it saves time and allows workers to focus without office noise. Others prefer offices because they can meet colleagues easily and solve problems faster.\n\nI think both sides are reasonable, but office work is often better for teamwork. When people are in the same room, they can communicate more quickly and avoid misunderstandings. However, home working is still useful for jobs that need quiet concentration.\n\nOverall, the best choice depends on the type of job and the worker's personality.`
      },
      {
        id: "t2-band6-5-problem-solution",
        task: "Task 2",
        questionType: "problem_solution",
        expectedBandMin: 6.0,
        expectedBandMax: 6.5,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Clear problem-solution structure with enough development for Band 6-ish writing.",
        prompt: "Many cities are suffering from a shortage of affordable housing. What are the causes of this problem, and what solutions can you suggest?",
        essay: `One reason for the shortage of affordable housing is that property prices have risen much faster than wages. Another cause is that many city centres are being used for expensive apartments instead of homes for ordinary families.\n\nTo solve this problem, governments should build more public housing and give tax support to developers who create cheaper homes. They could also control rent increases in very busy areas.\n\nThese measures would not remove the problem immediately, but they would make housing more available to low and middle income families.`
      },
      {
        id: "t2-band7-outweigh",
        task: "Task 2",
        questionType: "outweigh",
        expectedBandMin: 6.5,
        expectedBandMax: 7.0,
        hardLowbandExpected: false,
        highbandExpected: false,
        reason: "Comparative judgement with clear development and reasonably strong control.",
        prompt: "Do the advantages of living in a large city outweigh the disadvantages?",
        essay: `There are clear advantages to living in a large city, such as better jobs, more transport and greater access to services. For many people, these benefits are important enough to make city life attractive.\n\nHowever, large cities also have disadvantages, including noise, high costs and crowded public spaces. These problems can make daily life stressful.\n\nIn my opinion, the advantages usually outweigh the disadvantages because cities offer more opportunities for work and education. Even so, people who value peace and quiet may prefer smaller towns.`
      },
      {
        id: "t2-band7-5-positive-negative",
        task: "Task 2",
        questionType: "positive_negative",
        expectedBandMin: 7.0,
        expectedBandMax: 7.5,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Strong Task 2 response with clear judgement and controlled language.",
        prompt: "Is the development of artificial intelligence a positive or negative development?",
        essay: `I believe the development of artificial intelligence is mainly positive, although it also creates some risks. The reason is that AI can save time in areas such as healthcare, education and transport.\n\nFor example, doctors can use AI to detect diseases more quickly, and students can receive immediate feedback on simple tasks. This makes systems faster and more efficient. However, governments should still control how AI is used, because some jobs may disappear and privacy could be damaged.\n\nOverall, AI is a positive development as long as people use it responsibly.`
      },
      {
        id: "t2-band8-two-question-opinion",
        task: "Task 2",
        questionType: "two-question",
        expectedBandMin: 7.5,
        expectedBandMax: 8.0,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Well-developed answer to two questions with natural progression and precise control.",
        prompt: `In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?`,
        essay: `Crime fiction is popular because it gives readers and viewers a puzzle to solve. People are naturally curious, so they enjoy following clues, suspects and unexpected twists until the truth is revealed. Crime stories also let audiences explore danger in a safe way, which makes them both exciting and memorable.\n\nMy own view is largely positive. Crime novels and TV dramas can be entertaining, and they often encourage people to think about justice, motives and the social causes of crime. However, they should not rely on violence alone, and parents should be careful about what younger viewers watch.\n\nOverall, I think these stories are valuable as long as they are written with intelligence rather than simply shock value.`
      },
      {
        id: "t2-band8-5-opinion",
        task: "Task 2",
        questionType: "opinion",
        expectedBandMin: 8.0,
        expectedBandMax: 8.5,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Highly controlled opinion essay with precise language and mature organisation.",
        prompt: "To what extent do you agree that public transport should be free in major cities?",
        essay: `I partly agree that public transport should be free in major cities. Removing fares would make buses and trains more accessible, especially for low income residents, students and older people. It could also reduce traffic, because more drivers would be willing to leave their cars at home.\n\nThat said, free transport would be extremely expensive to fund. If governments covered the full cost, they would need to raise taxes or cut money from other public services. In my opinion, a better solution is to make transport affordable rather than completely free.\n\nFor that reason, I support lower fares and targeted discounts, but not a fully free system.`
      },
      {
        id: "t2-band9-mixed",
        task: "Task 2",
        questionType: "mixed",
        expectedBandMin: 8.5,
        expectedBandMax: 9.0,
        hardLowbandExpected: false,
        highbandExpected: true,
        reason: "Very strong mixed response with fully developed ideas and polished control.",
        prompt: "Some people think universities should teach only practical subjects that help students get jobs. Others believe universities should also teach arts and literature. Discuss both views and give your own opinion.",
        essay: `Universities undoubtedly need to prepare students for employment, and practical subjects clearly serve that purpose. Courses in engineering, medicine and business can lead directly to jobs and help economies remain competitive. From this perspective, a purely job-focused curriculum seems efficient.\n\nNevertheless, universities are not simply training centres. Arts and literature develop critical thinking, cultural awareness and the ability to interpret complex ideas. These qualities matter in modern workplaces just as much as technical knowledge, because employers increasingly value judgement, communication and creativity.\n\nIn my view, universities should continue to teach both kinds of subjects. A balanced curriculum allows students to gain practical skills while also learning to think broadly and independently. That combination is more useful than a narrow system that serves immediate employment alone.`
      }
    ]
  };
}

function makeVmExports(file, names) {
  return loadAuditExports(file, names);
}

function verifyTask2CrimeAudit() {
  const grade = makeVmExports("api/grade-ielts.js", [
    "inferTask2Profile",
    "auditTask2Requirements",
    "buildTaskProfile",
    "buildTaskRequirementAudit",
    "detectTask2RequirementSignals"
  ]);
  const prompt = `In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?`;
  const essay = `In many countries, crime novels and TV crime dramas are becoming very popular. I think there are several reasons for this. In my opinion, these books and shows are interesting, but people should not spend too much time watching them.\n\nFirstly, crime stories are popular because they are exciting. Many people like to know who did the crime and why the person did it. When people watch a crime drama, they can follow the police or detective to find the answer. This makes the story more interesting than some normal TV programmes. Also, many crime stories have many surprises, so viewers want to keep watching until the end.\n\nSecondly, crime novels and TV dramas can show people some problems in society. For example, they may show stealing, murder, family problems or money problems. These things are not good, but they can make people think about real life. Some people also like these stories because they want to understand why criminals do bad things.\n\nIn my opinion, crime fiction and TV crime dramas can be good entertainment. They help people relax after work or study. They can also make people think more carefully. However, I also think there are some disadvantages. If the story has too much violence, it may not be suitable for young people. Some people may also feel afraid after watching too many crime dramas.\n\nIn conclusion, crime novels and TV crime dramas are popular because they are exciting and full of mystery. I think they are good if people watch or read them in a sensible way.`;
  const profile = grade.inferTask2Profile(prompt);
  assert(profile.twoPartQuestion === true, "Two-question Task 2 prompt was not detected as a two-part question.", profile);
  assert(profile.questionCount >= 2, "Two-question Task 2 prompt should have at least two direct questions.", profile);
  assert(profile.requiredParts.length >= 2, "Two-question Task 2 prompt should keep both direct questions as required parts.", profile);
  assert(profile.requiredParts.some((part) => /why do you think/i.test(part)), "First question was not preserved as a required part.", profile);
  assert(profile.requiredParts.some((part) => /what is your opinion/i.test(part)), "Second question was not preserved as a required part.", profile);

  const signals = {
    task: "Task 2",
    wordCount: countWords(essay),
    paragraphCount: countParagraphs(essay),
    sentenceCount: countSentences(essay),
    task2QuestionProfile: profile
  };
  const audit = grade.auditTask2Requirements({ task: "Task 2", questionPrompt: prompt, essay }, signals);
  assert(audit.questionCount >= 2, "Task 2 audit did not keep the two direct questions.", audit);
  assert(audit.twoPartQuestion === true, "Task 2 audit did not flag the prompt as a two-part question.", audit);
  assert(audit.missingCount === 0, "The crime essay should not be marked as missing task response.", audit);
  assert(audit.items.some((item) => /answer all direct question parts/i.test(item.requirement) && item.status !== "missing"), "The two-question response should be treated as at least partly covered.", audit);
  assert(audit.taskResponseCap == null || Number(audit.taskResponseCap) >= 5.5, "The crime essay should stay in the mid-band / upper-mid-band range, not hard lowband.", audit);

  const taskProfile = grade.buildTaskProfile({ task: "Task 2", questionPrompt: prompt, essay }, signals);
  assert(taskProfile.twoPartQuestion === true, "Task profile lost the two-part question flag.", taskProfile);
  assert(Number(taskProfile.questionCount) >= 2, "Task profile lost the two direct questions count.", taskProfile);

  console.log("Local Task 2 crime audit: passed");
  console.log("Task profile:", {
    questionType: profile.questionType,
    questionCount: profile.questionCount,
    requiredParts: profile.requiredParts,
    taskResponseCap: audit.taskResponseCap,
    missingCount: audit.missingCount,
    partlyCount: audit.partlyCount
  });
}

function verifyTask1Audit() {
  const grade = makeVmExports("api/grade-ielts.js", ["auditTask1Requirements", "buildTaskProfile"]);
  const prompt = "You want to suggest a change to the opening hours of your local library. Write to the library manager. Explain your suggestion, give reasons, and say how it would benefit local people.";
  const essay = `Dear Library Manager,\n\nI am writing to ask you to keep the library open until 9 p.m. on weekdays. At the moment, many people who work or study during the day cannot use the library after normal hours.\n\nI think this change is needed because students would have more time to finish their reading and local workers could borrow books after work without rushing. It would also make the library more useful as a community space in the evening.\n\nI hope you will consider this request.\n\nYours faithfully,\nLeah`;
  const signals = {
    task: "Task 1",
    wordCount: countWords(essay),
    paragraphCount: countParagraphs(essay),
    sentenceCount: countSentences(essay),
    task1BulletPoints: [
      "Say what change you want.",
      "Explain why it is needed.",
      "Describe how it would help local people."
    ]
  };
  const audit = grade.auditTask1Requirements({ task: "Task 1", questionPrompt: prompt, essay }, signals);
  assert(Array.isArray(audit.extractedRequirements) && audit.extractedRequirements.length === 3, "Task 1 audit should keep three extracted bullet points.", audit);
  assert(audit.missingCount === 0, "Task 1 sample should not miss any bullet points.", audit);
  assert(audit.partlyCount <= 1, "Task 1 sample should stay complete or nearly complete.", audit);
  const taskProfile = grade.buildTaskProfile({ task: "Task 1", questionPrompt: prompt, essay }, signals);
  assert(Array.isArray(taskProfile.bulletPoints) && taskProfile.bulletPoints.length === 3, "Task profile should report three bullet points.", taskProfile);
  console.log("Local Task 1 audit: passed");
}

function verifyRouteMatrix() {
  const router = makeVmExports("api/grade-ielts-production-router.js", ["routeReason"]);
  const boundary = makeVmExports("api/grade-ielts-boundary-adjudicator.js", ["routeDecision"]);

  const routeBands = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0];
  const expectations = new Map([
    [3.0, "below_boundary"],
    [3.5, "below_boundary"],
    [4.0, "boundary_4_0_5_5"],
    [4.5, "boundary_4_0_5_5"],
    [5.0, "boundary_4_0_5_5"],
    [5.5, "boundary_4_0_5_5"],
    [6.0, "middle_band_6_0_6_5"],
    [6.5, "middle_band_6_0_6_5"],
    [7.0, "highband_candidate_7_0_plus"],
    [7.5, "highband_candidate_7_0_plus"],
    [8.0, "highband_candidate_7_0_plus"],
    [8.5, "highband_candidate_7_0_plus"],
    [9.0, "highband_candidate_7_0_plus"]
  ]);

  for (const band of routeBands) {
    const route = router.routeReason(band);
    assert(route.routeZone === expectations.get(band), `routeReason(${band}) returned unexpected zone.`, route);
  }

  const mkCriterionSet = (mainScore, lowScore) => ({
    main: { score: mainScore, criteria: { "Task Response": mainScore, "Coherence and Cohesion": mainScore, "Lexical Resource": mainScore, "Grammatical Range and Accuracy": mainScore } },
    lowband: { score: lowScore, criteria: { "Task Response": lowScore, "Coherence and Cohesion": lowScore, "Lexical Resource": lowScore, "Grammatical Range and Accuracy": lowScore } }
  });

  const boundaryCases = [
    {
      task: "Task 2",
      wc: 280,
      ...mkCriterionSet(3.0, 3.0),
      expect: "lowband_confirms_low_score"
    },
    {
      task: "Task 2",
      wc: 280,
      ...mkCriterionSet(4.5, 4.0),
      expect: "boundary_4_5_lowband_anchor_adjudicate"
    },
    {
      task: "Task 2",
      wc: 280,
      ...mkCriterionSet(5.0, 4.5),
      expect: "use_main"
    },
    {
      task: "Task 2",
      wc: 280,
      ...mkCriterionSet(5.0, 4.0),
      expect: "boundary_5_0_low4_basic5_strict_adjudicate"
    },
    {
      task: "Task 2",
      wc: 280,
      ...mkCriterionSet(5.5, 4.5),
      expect: "main_high_lowband_conflict_adjudicate"
    },
    {
      task: "Task 1",
      wc: 170,
      ...mkCriterionSet(7.0, 5.0),
      expect: "main_high_lowband_conflict_adjudicate"
    }
  ];

  for (const item of boundaryCases) {
    const route = boundary.routeDecision(item.task, item.wc, item.main, item.lowband);
    assert(route.decision === item.expect, `Boundary route decision mismatch for ${item.task} ${item.main.score}/${item.lowband.score}.`, route);
  }

  console.log("Route matrix: passed");
}

async function verifyLiveApis() {
  const routerEndpoint = `${BASE_URL}/api/grade-ielts-production-router`;
  const generatorEndpoint = `${BASE_URL}/api/essay-generator`;
  const feedbackEndpoint = `${BASE_URL}/api/writing-feedback`;

  const routerSample = {
    task: "Task 2",
    taskType: "Task 2",
    generationTask: "Task 2",
    questionType: "two-question",
    title: "Crime novels and TV crime dramas",
    questionPrompt: `In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?`,
    prompt: `In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?`,
    essay: `In many countries, crime novels and TV crime dramas are becoming very popular. I think there are several reasons for this. In my opinion, these books and shows are interesting, but people should not spend too much time watching them.\n\nFirstly, crime stories are popular because they are exciting. Many people like to know who did the crime and why the person did it. When people watch a crime drama, they can follow the police or detective to find the answer. This makes the story more interesting than some normal TV programmes. Also, many crime stories have many surprises, so viewers want to keep watching until the end.\n\nSecondly, crime novels and TV dramas can show people some problems in society. For example, they may show stealing, murder, family problems or money problems. These things are not good, but they can make people think about real life. Some people also like these stories because they want to understand why criminals do bad things.\n\nIn my opinion, crime fiction and TV crime dramas can be good entertainment. They help people relax after work or study. They can also make people think more carefully. However, I also think there are some disadvantages. If the story has too much violence, it may not be suitable for young people. Some people may also feel afraid after watching too many crime dramas.\n\nIn conclusion, crime novels and TV crime dramas are popular because they are exciting and full of mystery. I think they are good if people watch or read them in a sensible way.`,
    wordCount: countWords(`In many countries, crime novels and TV crime dramas are becoming very popular. I think there are several reasons for this. In my opinion, these books and shows are interesting, but people should not spend too much time watching them.\n\nFirstly, crime stories are popular because they are exciting. Many people like to know who did the crime and why the person did it. When people watch a crime drama, they can follow the police or detective to find the answer. This makes the story more interesting than some normal TV programmes. Also, many crime stories have many surprises, so viewers want to keep watching until the end.\n\nSecondly, crime novels and TV dramas can show people some problems in society. For example, they may show stealing, murder, family problems or money problems. These things are not good, but they can make people think about real life. Some people also like these stories because they want to understand why criminals do bad things.\n\nIn my opinion, crime fiction and TV crime dramas can be good entertainment. They help people relax after work or study. They can also make people think more carefully. However, I also think there are some disadvantages. If the story has too much violence, it may not be suitable for young people. Some people may also feel afraid after watching too many crime dramas.\n\nIn conclusion, crime novels and TV crime dramas are popular because they are exciting and full of mystery. I think they are good if people watch or read them in a sensible way.`),
    mode: "score"
  };

  const score = await postJson(routerEndpoint, routerSample);
  assert(isNumberBand(score.finalBand), "Production router did not return a numeric finalBand.", score);
  assert(score.finalSource, "Production router did not return finalSource.", score);
  assert(score.boundaryMainReuseAudit, "Production router response did not expose boundaryMainReuseAudit.", score);
  assert(score.scoringAudit, "Production router response did not expose scoringAudit.", score);
  assert(score.criterionAudit, "Production router response did not expose criterionAudit.", score);
  assert(score.criterionScoreAudit, "Production router response did not expose criterionScoreAudit.", score);
  assert(!criteriaAllSame(score.criteria || score.finalCriteria || {}), "Crime drama sample should not return four identical criterion scores.", score);
  assert(score.criterionScoreAudit.allCriteriaSame === false, "Criterion score audit should show the crime sample is not mechanically uniform.", score.criterionScoreAudit);

  const generator = await postJson(generatorEndpoint, {
    ...routerSample,
    mode: "generation_only",
    verifyGeneratedScores: false,
    generatedAnswerLabel: "audit"
  });
  for (const key of ["modelAnswer", "revisionPlus05", "revisionPlus10"]) {
    assert(generator[key] && generator[key].essay, `Essay generator did not return ${key}.`, generator[key]);
  }
  assert(["target_met", "below_target", "target_exceeded", "closest_available", "verification_failed"].includes(generator.revisionPlus05?.verification?.status || "target_met"), "Essay generator revision status missing or invalid.", generator.revisionPlus05);

  const feedback = await postJson(feedbackEndpoint, {
    ...routerSample,
    module: "structureCohesionTask",
    moduleName: "structureCohesionTask",
    currentResult: score,
    frozenScore: { overallBand: score.finalBand }
  });
  const moduleNames = (process.env.AUDIT_FEEDBACK_MODULES || "overview,sentenceUpgrade,grammarWordFormSpelling,structureCohesionTask,expressionBank")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const moduleName of moduleNames) {
    const moduleResult = moduleName === "structureCohesionTask" ? feedback : await postJson(feedbackEndpoint, {
      ...routerSample,
      module: moduleName,
      moduleName,
      currentResult: score,
      frozenScore: { overallBand: score.finalBand }
    });
    assert(hasChinese(moduleResult.moduleResult || moduleResult.result), `${moduleName}: feedback response did not contain Chinese helper fields.`, moduleResult);
    assert(!JSON.stringify(moduleResult).includes("涓枃瑙ｉ噴鏆傜己"), `${moduleName}: feedback still exposes the missing Chinese placeholder.`, moduleResult);
  }

  console.log("Live API checks: passed");
  console.log("Router finalBand/finalSource:", score.finalBand, score.finalSource);
  console.log("boundaryMainReuseAudit:", score.boundaryMainReuseAudit);
}

async function main() {
  const localSamples = buildLocalSamples();
  verifyTask2CrimeAudit();
  verifyTask1Audit();
  verifyRouteMatrix();
  console.log(`Local corpus prepared: ${localSamples.task1.length} Task 1 samples, ${localSamples.task2.length} Task 2 samples.`);

  if (LIVE) {
    console.log(`Running live API checks against ${BASE_URL}...`);
    await verifyLiveApis();
  } else {
    console.log("Live API checks skipped. Set AUDIT_LIVE=1 and AUDIT_BASE_URL to run the full remote regression suite.");
  }
}

main().catch((error) => {
  console.error("Scoring full-range audit failed:", error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2).slice(0, 4000));
  process.exit(1);
});
