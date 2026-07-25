"use strict";

const academicTask1Prompt = `The table below shows the percentage of commuters in Harton who travelled to work by car, bus or bicycle in 2000 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.`;

const academicTask1Facts = {
  visualType: "table",
  title: "Commuting methods in Harton, 2000 and 2025",
  units: "percentage of commuters",
  timeRange: [2000, 2025],
  dataPoints: [
    { year: 2000, car: 48, bus: 37, bicycle: 15 },
    { year: 2025, car: 62, bus: 24, bicycle: 14 }
  ],
  keyFeatures: [
    "Cars were the most common mode in both years and increased by 14 percentage points.",
    "Bus use fell by 13 percentage points.",
    "Bicycle use was the least common and remained broadly stable, falling by 1 percentage point."
  ],
  majorComparisons: [
    "The gap between car and bus use widened from 11 to 38 percentage points.",
    "Car and bus shares moved in opposite directions."
  ],
  sourceVerified: true,
  verificationNote: "Synthetic table created for repeatable calibration; all facts are enumerated above."
};

module.exports = {
  version: "four-task-complete-corpus-v2-audited-boundaries",
  createdAt: "2026-07-16",
  benchmarkMethod: "Each response was written for this calibration set and audited criterion by criterion. After the first live run, labels and essays were corrected where complete task coverage or near-model-answer language had made the intended band indefensible; model predictions were not copied into the targets.",
  acceptance: {
    overallMeanAbsoluteErrorMax: 0.5,
    criterionMeanAbsoluteErrorMax: 0.65,
    withinHalfBandRateMin: 0.75,
    catastrophicErrorRateMax: 0,
    catastrophicErrorDefinition: "absolute overall error greater than 1.0 band",
    requiredTaskCoverage: ["academic:1", "academic:2", "general_training:1", "general_training:2"]
  },
  samples: [
    {
      id: "A1-B6-table-complete",
      examModule: "academic",
      taskNumber: 1,
      taskKind: "academic_visual_report",
      questionType: "table",
      prompt: academicTask1Prompt,
      visualFacts: academicTask1Facts,
      targetOverall: 6,
      targetCriteria: {
        "Task Achievement": 7,
        "Coherence and Cohesion": 6,
        "Lexical Resource": 5,
        "Grammatical Range and Accuracy": 5.5
      },
      rationale: {
        "Task Achievement": "A clear overview, all three modes and the main comparisons are present; language errors do not remove the task coverage.",
        "Coherence and Cohesion": "The report has clear overall progression, although the year-by-year route is list-like and references such as 'this number' are repetitive.",
        "Lexical Resource": "Meaning is accessible, but a narrow set of words is repeated and several combinations are inaccurate.",
        "Grammatical Range and Accuracy": "Some longer forms are attempted, while agreement, tense, article and comparison errors recur without blocking meaning."
      },
      essay: `The table show information about how people in Harton travelled to their work in 2000 and 2025 by car, bus and bicycle.

Overall, car was the popular transport in both years and its number went up. Bus went down, while bicycle was still the smallest and it did not have a big change.

In 2000, car users was 48 percent. This number was more than bus, which had 37 percent of commuter, so their difference was 11 percentage points. Bicycle only had 15 percent and was the less popular way. These figures shows that most people preferred a car or bus.

In 2025, the car figure grow to 62 percent, but bus reduced to 24 percent. The gap was became much larger, at 38 points. For bicycle, the number only fall from 15 to 14 percent. Therefore, this transport stayed almost same. In summary, the table have a clear increase for cars and a decrease for buses, but cycling changed very little.`
    },
    {
      id: "A1-B7-table-complete",
      examModule: "academic",
      taskNumber: 1,
      taskKind: "academic_visual_report",
      questionType: "table",
      prompt: academicTask1Prompt,
      visualFacts: academicTask1Facts,
      targetOverall: 7,
      targetCriteria: {
        "Task Achievement": 7,
        "Coherence and Cohesion": 7,
        "Lexical Resource": 7,
        "Grammatical Range and Accuracy": 6.5
      },
      rationale: {
        "Task Achievement": "The overview selects the dominant movements and the report makes accurate, relevant comparisons without over-reporting.",
        "Coherence and Cohesion": "Information is grouped by the opposing trends, with clear progression and unobtrusive referencing.",
        "Lexical Resource": "The response uses precise trend and comparison language with natural paraphrase; minor repetition prevents an 8-level profile.",
        "Grammatical Range and Accuracy": "A varied set of controlled sentence forms is used, with any lapses too minor to form a pattern."
      },
      essay: `The table gives information about the percentage of people in Harton who used cars, buses or bicycles to travel to work in 2000 and 2025.

Overall, the car was the most popular method in both years and its figure increased. In contrast, the percentage for buses fell, while bicycle use stayed almost the same and was the smallest category.

In 2000, 48% of commuters travelled by car and 37% used a bus. This means the difference between the two main methods was 11 percentage points. The figure for bicycles was much lower, at 15%.

In 2025, the car figure reached 62%, which was a rise of 14 points. At the same time, bus use dropped to 24%, so cars were now much more common than buses. The figures shows a gap of 38 percentage points between them. Cycling had only a small change, falling from 15% to 14%. Therefore, most of the change in the table came from the opposite movements in cars and buses.`
    },
    {
      id: "A2-B6.5-discussion-complete",
      examModule: "academic",
      taskNumber: 2,
      taskKind: "essay",
      questionType: "discussion_opinion",
      prompt: "Some people believe universities should mainly teach practical skills that help graduates find employment. Others think the main purpose of university is to provide academic knowledge. Discuss both views and give your own opinion.",
      targetOverall: 6.5,
      targetCriteria: {
        "Task Response": 7,
        "Coherence and Cohesion": 7,
        "Lexical Resource": 5.5,
        "Grammatical Range and Accuracy": 5.5
      },
      rationale: {
        "Task Response": "Both views and a consistent opinion are directly addressed with relevant explanation and examples; recurring language errors are scored separately.",
        "Coherence and Cohesion": "The four-paragraph route has clear progression and central topics, though movement within body paragraphs is formulaic and repetitive.",
        "Lexical Resource": "There is adequate topic vocabulary, alongside repeated wording and several imprecise combinations.",
        "Grammatical Range and Accuracy": "The response mixes simple and complex sentences, but recurrent agreement, article and phrasing errors keep control at the mid band."
      },
      essay: `Nowadays, people have different opinion about the main job of universities. Some people think students should learn practical skill for getting a job, while other people believe academic knowledge is more important. I think both are needed, but practical skill should have a little more attention because most students need employment.

On the one hand, practical teaching can make graduates ready for work. For example, a business student can learn how to use office software, speak with a customer and work in a team. These things are asked by many company. If a university only gives books and examinations, the student may have good marks but cannot do a real task in their first day of work. Also, work experience give them confident and help them understand what kind of job they like. This can save time for the student and the employer.

On the other hand, academic knowledge also have an important place. Subjects such as maths, science and history teach people to think and understand difficult ideas. A practical skill can become old when technology changes, but a person with strong knowledge can learn a new skill more easy. Universities also do research which can bring new medicine and inventions for society. However, some theory courses include too much information that students never use after graduation, so they may feel the study is not useful.

In my opinion, universities should not choose only one side. They should teach the main theory, but every course should include a project or some weeks in a workplace. In this way students can understand knowledge and practise it at the same time. This is better for their future jobs, although the academic part must not disappear.`
    },
    {
      id: "A2-B7-discussion-complete",
      examModule: "academic",
      taskNumber: 2,
      taskKind: "essay",
      questionType: "discussion_opinion",
      prompt: "Some people believe universities should mainly teach practical skills that help graduates find employment. Others think the main purpose of university is to provide academic knowledge. Discuss both views and give your own opinion.",
      targetOverall: 7,
      targetCriteria: {
        "Task Response": 7,
        "Coherence and Cohesion": 7,
        "Lexical Resource": 7,
        "Grammatical Range and Accuracy": 7
      },
      rationale: {
        "Task Response": "The essay answers both sides, sustains a qualified position and develops the distinction between immediate employability and long-term adaptability.",
        "Coherence and Cohesion": "Paragraphs perform distinct argumentative roles and ideas progress through clear logical relationships rather than connective display.",
        "Lexical Resource": "Vocabulary is sufficiently wide and precise for the argument, with natural collocation and only minor limitations.",
        "Grammatical Range and Accuracy": "Complex relationships are expressed through varied, controlled structures, with no recurring error pattern."
      },
      essay: `Some people think universities should mainly teach skills which students can use in a job, while others believe academic knowledge is their main purpose. I believe both are necessary, although knowledge should remain the base of a university course.

On the one hand, practical skills can make the move from study to work easier. Employers often want graduates who can use office or professional software, cooperate with other workers and speak clearly to customers. A student who has completed a work placement will understand these expectations better than someone who has only taken examinations. Practical work is especially useful in nursing and engineering, where students need to apply what they know safely. It can also help students discover that a career is not suitable before they spend several years in it.

On the other hand, it would be a mistake to train students only for jobs that exist today. Software and working methods change quickly, and a particular skill may become old. Academic subjects teach students to understand principles, examine evidence and learn new things later. For example, an engineer who understands mathematics can use that knowledge with different design programs. Universities also carry out research, so their purpose is wider than supplying workers to companies.

In my view, courses should combine these two sides in a clear order. Students should learn the important theory first and then use it in projects or placements. This approach gives graduates useful experience, but it also helps them adapt when their first job changes. Universities should prepare people for employment, but not only for one task or one employer.`
    },
    {
      id: "G1-B6-complaint-complete",
      examModule: "general_training",
      taskNumber: 1,
      taskKind: "gt_letter",
      questionType: "formal_complaint",
      letterStyle: "formal",
      prompt: "You ordered a kitchen appliance from an online shop. It arrived late and was damaged. Write a letter to the shop manager. In your letter: describe what you ordered and when it should have arrived; explain the damage and how it affects you; say what you would like the manager to do.",
      targetOverall: 6,
      targetCriteria: {
        "Task Achievement": 7,
        "Coherence and Cohesion": 6,
        "Lexical Resource": 5.5,
        "Grammatical Range and Accuracy": 5.5
      },
      rationale: {
        "Task Achievement": "Purpose and every bullet are clearly addressed with enough useful detail, although the complaint tone becomes somewhat blunt.",
        "Coherence and Cohesion": "The letter has clear progression from order to damage to remedy, although sequencing is mechanical and references are basic.",
        "Lexical Resource": "Everyday complaint vocabulary communicates the message, with repetition and several awkward word combinations.",
        "Grammatical Range and Accuracy": "Meaning remains recoverable, but tense, agreement, article and clause errors recur across the letter."
      },
      essay: `Dear Sir or Madam,

I write because the mixer which I buy from your website has arrived late and broken. The order number is HN4582. Your website promise it will arrive on 6 July, but it only come to my home on 11 July.

Firstly, the glass jug have a crack near its bottom and the lid cannot close correct. When I switched it on, the machine make a very loud sound, so I am afraid to use it. I needed the mixer for making soft food for my father after his dental operation. Now I cannot make his food and must borrow one from my neighbour, which is a lot of inconvenient.

Secondly, I called your service two days ago. The staff only said me to send an email, but nobody answered. I want you send a new mixer quickly and take away the damage one. I should not pay another delivery because this problem is not made by me. If a new mixer cannot arrive in three days, please return all my money, also the first delivery cost.

Please answer me soon because I need to know what I should do.

Yours faithfully,
Chen Wei`
    },
    {
      id: "G1-B7-complaint-complete",
      examModule: "general_training",
      taskNumber: 1,
      taskKind: "gt_letter",
      questionType: "formal_complaint",
      letterStyle: "formal",
      prompt: "You ordered a kitchen appliance from an online shop. It arrived late and was damaged. Write a letter to the shop manager. In your letter: describe what you ordered and when it should have arrived; explain the damage and how it affects you; say what you would like the manager to do.",
      targetOverall: 7,
      targetCriteria: {
        "Task Achievement": 8,
        "Coherence and Cohesion": 7,
        "Lexical Resource": 6.5,
        "Grammatical Range and Accuracy": 6.5
      },
      rationale: {
        "Task Achievement": "The purpose is immediate, every bullet is usefully developed, and the requested remedy is firm yet appropriate to the manager relationship.",
        "Coherence and Cohesion": "The sequence from order to impact to remedy is easy to follow, with natural reference and paragraphing.",
        "Lexical Resource": "Complaint and resolution language is precise and appropriately formal without sounding memorised.",
        "Grammatical Range and Accuracy": "A flexible range supports clear chronology and conditions, with only negligible lapses."
      },
      essay: `Dear Sir or Madam,

I am writing about a blender I ordered from your website on 3 July. The order number is HN4582. It was supposed to arrive on 6 July, but I did not receive it until 11 July.

The glass jug has a crack near the bottom and the power button is loose. I tested the blender without putting food in it, and the motor stopped twice. Because of these problems, the machine are not safe to use. I bought it to make soft meals for my father after a dental operation. The delay has caused difficulty for me because I am now borrowing a blender from a neighbour.

I called customer service and sent photographs on 12 July, but I have not received a useful answer. I would like a replacement to be sent by express delivery, and I would also like your company to collect the damaged blender. I should not be charged for either delivery. If you cannot send a replacement within three working days, please refund the full price and the original delivery cost.

Please tell me which action you will take soon.

Yours faithfully,
Chen Wei`
    },
    {
      id: "G2-B6-problem-solution-complete",
      examModule: "general_training",
      taskNumber: 2,
      taskKind: "essay",
      questionType: "problem_solution",
      prompt: "Traffic congestion is becoming worse in many towns and cities. What are the main causes of this problem, and what measures could be taken to reduce it?",
      targetOverall: 6,
      targetCriteria: {
        "Task Response": 7,
        "Coherence and Cohesion": 6,
        "Lexical Resource": 5.5,
        "Grammatical Range and Accuracy": 5.5
      },
      rationale: {
        "Task Response": "The response answers both causes and measures with relevant explanation and several supported solutions, despite some generalisation.",
        "Coherence and Cohesion": "The problem-solution organisation and overall progression are clear, while internal movement relies heavily on basic signposting.",
        "Lexical Resource": "Enough transport vocabulary communicates the ideas, though repetition and imprecise word combinations recur.",
        "Grammatical Range and Accuracy": "There is some sentence variety, but article, agreement and clause errors form a noticeable pattern."
      },
      essay: `Traffic jam is becoming a big problem in many cities, especially in the morning and evening. There are some causes for this situation and several ways can be used to make it better.

The first cause is more people have a private car now. A family sometimes own two cars, and they use it for going to work, taking children to school and even buying small things near home. This put too many car on the road at the same time. Another cause is public transport are not good enough. Buses can be late and full of people, and some outside places do not have a train station. Because of this, people choose a car because it looks more comfortable and faster. Roads in old city areas are also narrow, so they cannot carry all the new traffic.

To solve this problem, government should improve buses and trains. They can add more bus, make tickets cheaper and build stations in outside areas. If public transport become reliable, some drivers will not use their car every day. Secondly, schools and offices can start at different times. This will reduce the number of people who travel in one time. Companies can also let some worker work at home for two or three days. Another idea is building cycle lanes, but the lanes must be safe or people will still be afraid. The government could make parking in the centre more expensive too. However, this may be difficult for people who do not have another way to travel.

In conclusion, too many private cars, weak public transport and small roads cause congestion. Better buses, different working time and cycling facilities can help. The city should use all these solution together because one action is not enough.`
    },
    {
      id: "G2-B7-problem-solution-complete",
      examModule: "general_training",
      taskNumber: 2,
      taskKind: "essay",
      questionType: "problem_solution",
      prompt: "Traffic congestion is becoming worse in many towns and cities. What are the main causes of this problem, and what measures could be taken to reduce it?",
      targetOverall: 7,
      targetCriteria: {
        "Task Response": 7,
        "Coherence and Cohesion": 7,
        "Lexical Resource": 6.5,
        "Grammatical Range and Accuracy": 6.5
      },
      rationale: {
        "Task Response": "The essay identifies interacting causes and proposes measures tied directly to them, with a clear view of implementation limits.",
        "Coherence and Cohesion": "The response progresses from demand and alternatives to coordinated solutions, and references causes across paragraphs naturally.",
        "Lexical Resource": "Transport and policy vocabulary is precise, varied and appropriate, with no distracting lexical pattern.",
        "Grammatical Range and Accuracy": "Varied structures express cause, condition and qualification accurately, with no recurring control problem."
      },
      essay: `Traffic congestion is a serious problem in many cities. The main causes are the growth in private cars, weak public transport and the fact that many people travel at the same time. In my view, cities need to improve alternatives to driving as well as control car use.

First, more families can afford one or even two cars, and they use them for short journeys that could be made in another way. At the same time, people living outside the centre may have only one slow bus service. They choose to drive because it is more convenient. Another cause is that schools and offices often start at similar hours, which puts a large number of cars on the road during a short period. Cheap parking also makes driving attractive.

The first solution should be better public transport. City governments could provide more buses in outer areas and create bus lanes so that services are not delayed by traffic. Tickets should also be affordable. If public transport is reliable, more people will be willing to leave their cars at home.

Cities can also reduce travel at the busiest time. Companies could offer different starting hours or allow employees to work at home on some days. Parking in the centre could cost more, but this policy should only begin after better buses are available. Finally, safe cycle lanes would help with short journeys. However, the lanes must be connected, because a short piece of cycle path will not give people enough confidence.

In conclusion, there is no single answer to congestion. Better buses, different working times, parking controls and cycling routes can reduce the problem if cities introduce them together.`
    }
  ]
};
