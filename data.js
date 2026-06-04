const TASK1_PHRASES = {
  "Formal letter 常用开头": ["Dear Sir or Madam,", "I am writing to bring to your attention ...", "I am writing to enquire about ...", "I would like to express my concern regarding ..."],
  "Semi-formal letter 常用开头": ["Dear Mr/Ms ... ,", "I hope you are well.", "I am writing to ask for your advice about ...", "I wanted to let you know about ..."],
  "Informal letter 常用开头": ["Hi ... ,", "I hope everything is going well.", "It was great to hear from you.", "Sorry I have not written for a while."],
  "投诉信句型": ["Unfortunately, the problem has caused considerable inconvenience.", "I believe this matter requires urgent attention.", "I would appreciate it if you could look into this issue.", "I hope a suitable solution can be found soon."],
  "请求信句型": ["I would be grateful if you could provide further information about ...", "Could you please let me know whether ...?", "It would be very helpful if you could ...", "Please let me know if any additional details are needed."],
  "道歉信句型": ["Please accept my sincere apologies for ...", "I am very sorry for any inconvenience this may have caused.", "I take full responsibility for the situation.", "I will make sure this does not happen again."],
  "感谢信句型": ["I am writing to thank you for ...", "I really appreciate the time and effort you put into ...", "Your help made a real difference.", "Please accept my sincere thanks."],
  "邀请信句型": ["I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know if you are able to come."],
  "申请信句型": ["I am writing to apply for the position of ...", "I believe my experience makes me a suitable candidate.", "I would welcome the opportunity to discuss my application further.", "Please find below a summary of my relevant experience."],
  "结尾句型": ["Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Kind regards,", "Best wishes,"]
};

const TASK2_PHRASES = {
  "Introduction 模板": ["It is often argued that ...", "People have different views about whether ...", "This essay will discuss both sides before giving my own view.", "In my opinion, this trend has both benefits and drawbacks."],
  "Body paragraph 1 模板": ["One major reason is that ...", "The first point to consider is ...", "This can be seen in the way that ...", "As a result, ..."],
  "Body paragraph 2 模板": ["Another important factor is ...", "On the other hand, it could also be argued that ...", "A further point is that ...", "This means that ..."],
  "Conclusion 模板": ["In conclusion, ...", "Overall, I believe that ...", "Although there are some disadvantages, the advantages are more significant.", "The best solution would be to ..."],
  "表达观点的句型": ["I strongly believe that ...", "From my perspective, ...", "I partly agree with this view because ...", "It seems to me that ..."],
  "表达原因的句型": ["This is mainly because ...", "One explanation for this is that ...", "The main reason behind this trend is ...", "This happens when ..."],
  "举例句型": ["For example, ...", "A good example of this is ...", "This can be illustrated by ...", "For instance, ..."],
  "对比句型": ["By contrast, ...", "However, ...", "Compared with ..., ...", "While this may be true, ..."],
  "让步句型": ["Although this argument is understandable, ...", "Admittedly, ...", "Even though there are some benefits, ...", "Despite this, ..."],
  "总结句型": ["To sum up, ...", "Therefore, ...", "For these reasons, ...", "This is why I believe that ..."]
};

const task1Structure = [
  "Opening: choose a suitable greeting and state the purpose clearly.",
  "Paragraph 1: explain the situation and give the key background.",
  "Paragraph 2: cover the first and second bullet points with specific details.",
  "Paragraph 3: cover the final bullet point and make the action or request clear.",
  "Closing: use a tone-appropriate final sentence and sign-off."
];

const task2Structure = [
  "Introduction: paraphrase the topic and give a clear position or essay direction.",
  "Body paragraph 1: develop the first main idea with a reason and example.",
  "Body paragraph 2: develop the second main idea or the other side of the argument.",
  "Conclusion: summarise the answer and repeat your position in fresh words."
];

const task1Seeds = [
  ["complaint", "formal letter", "Noise from a Community Hall", "the manager of a community hall", "describe the noise problem", "explain how it affects local residents", "suggest what action should be taken", "投诉信句型"],
  ["request", "semi-formal letter", "Changing a Work Shift", "a colleague you know well", "explain why you need to change your shift", "ask for help", "offer something in return", "请求信句型"],
  ["apology", "informal letter", "Missing a Friend's Dinner", "a close friend", "apologise for not coming", "explain what happened", "suggest a new time to meet", "道歉信句型"],
  ["application", "formal letter", "Weekend Museum Assistant", "the museum director", "say which role you are applying for", "describe relevant experience", "explain your availability", "申请信句型"],
  ["information", "semi-formal letter", "Asking About an Evening Course", "a course organiser you met before", "remind the organiser where you met", "ask about timetable and fees", "explain why you are interested", "请求信句型"],
  ["arrangement", "informal letter", "Planning a City Visit", "a friend visiting your city", "suggest where your friend can stay", "recommend places to visit", "explain how you can spend time together", "邀请信句型"],
  ["thanks", "semi-formal letter", "Thanking a Helpful Neighbour", "a neighbour", "thank them for their help", "explain why it mattered", "invite them to your home", "感谢信句型"],
  ["invitation", "informal letter", "Sports Event Invitation", "a friend", "explain what the event is", "say why your friend will enjoy it", "give time and place details", "邀请信句型"],
  ["formal letter", "formal letter", "Unreliable Bus Service", "a transport company", "describe the service problem", "explain the effect on passengers", "suggest improvements", "投诉信句型"],
  ["complaint", "formal letter", "Incorrect Online Delivery", "customer service", "describe what you ordered", "explain what arrived instead", "say what you want the company to do", "投诉信句型"],
  ["informal letter", "informal letter", "Sharing a New Hobby", "a friend", "describe the hobby", "explain why you enjoy it", "invite your friend to try it", "邀请信句型"],
  ["semi-formal letter", "semi-formal letter", "Feedback After a Workshop", "a workshop organiser", "say what was useful", "mention one improvement", "ask about future workshops", "感谢信句型"],
  ["request", "formal letter", "Requesting College Information", "a college admissions office", "say which course interests you", "ask about entry requirements", "ask about fees and start dates", "请求信句型"],
  ["apology", "semi-formal letter", "Apologising to a Landlord", "your landlord", "apologise for damage", "explain how it happened", "offer to pay for repair", "道歉信句型"],
  ["application", "formal letter", "Festival Volunteer Application", "a volunteer coordinator", "explain why you want to volunteer", "describe your skills", "say when you are available", "申请信句型"],
  ["information", "informal letter", "Travel Advice for a Friend", "a friend visiting your country", "suggest the best time to visit", "recommend things to do", "give transport or weather advice", "Informal letter 常用开头"],
  ["thanks", "informal letter", "Thanking a Friend for a Gift", "a friend", "thank your friend for the gift", "explain why you like it", "say how you will use it", "感谢信句型"],
  ["invitation", "semi-formal letter", "Inviting a Former Teacher", "a former teacher", "explain the event", "say why you want them to attend", "give date and location", "邀请信句型"],
  ["arrangement", "semi-formal letter", "Club Meeting Arrangement", "a local club member", "explain the meeting purpose", "suggest a time and place", "ask for confirmation", "请求信句型"],
  ["complaint", "formal letter", "Fitness Centre Membership Problem", "a fitness centre manager", "describe what was promised", "explain what is missing", "say what action you expect", "投诉信句型"],
  ["information", "formal letter", "Accommodation Rules", "an accommodation office", "introduce your booking", "ask about rules", "ask what to bring", "请求信句型"],
  ["application", "semi-formal letter", "Local Club Event Assistant", "a club secretary", "say why you are interested", "describe relevant experience", "explain how you could help", "申请信句型"],
  ["formal letter", "formal letter", "Improving a Public Park", "the local council", "describe the park condition", "explain why improvements are needed", "suggest two changes", "投诉信句型"],
  ["request", "informal letter", "Borrowing Equipment", "a friend", "explain what you need to borrow", "say why you need it", "promise when and how you will return it", "请求信句型"]
];

const task2Seeds = [
  ["opinion", "Working from Home", "Some people believe that working from home improves people's quality of life, while others think it creates new problems. To what extent do you agree or disagree?"],
  ["discussion", "Community Events", "Some people think local festivals and community events are important, while others believe they are a waste of public money. Discuss both views and give your own opinion."],
  ["advantage/disadvantage", "Online Shopping", "Online shopping is becoming more common in many countries. What are the advantages and disadvantages of this development?"],
  ["problem/solution", "Lack of Exercise", "Many adults do not get enough physical exercise. What problems does this cause, and what solutions can you suggest?"],
  ["two-part question", "Learning Practical Skills", "In many places, fewer young people learn practical skills such as cooking or repairing things. Why is this happening? Is this positive or negative?"],
  ["opinion", "Public Libraries", "Some people say public libraries are no longer necessary because information is available online. To what extent do you agree or disagree?"],
  ["discussion", "Children and Household Tasks", "Some people think children should help with household tasks, while others believe children should focus only on schoolwork. Discuss both views and give your opinion."],
  ["advantage/disadvantage", "Large Apartment Buildings", "In many cities, more people are living in large apartment buildings. What are the advantages and disadvantages of this trend?"],
  ["problem/solution", "Too Much Screen Time", "Many people spend too much time looking at screens each day. What problems can this cause, and how can these problems be reduced?"],
  ["two-part question", "Changing Jobs Often", "Many workers change jobs several times during their careers. Why do people do this? Do you think this is positive or negative?"],
  ["opinion", "Learning a Second Language", "Some people believe everyone should learn a second language. To what extent do you agree or disagree?"],
  ["discussion", "City Parks", "Some people think cities should build more parks, while others think land should be used for housing. Discuss both views and give your opinion."],
  ["advantage/disadvantage", "Cashless Payments", "More people are using cards and mobile phones instead of cash. What are the advantages and disadvantages of a cashless society?"],
  ["problem/solution", "Food Waste", "A large amount of food is wasted by households and restaurants. What problems does this cause, and what can be done to reduce it?"],
  ["opinion", "Uniforms at Work", "Some people think all employees should wear uniforms at work. To what extent do you agree or disagree?"],
  ["two-part question", "Moving Away from Small Towns", "In many countries, young people move from small towns to big cities. Why does this happen? What effects does it have on small towns?"],
  ["discussion", "Online or Classroom Learning", "Some people prefer online learning, while others think classroom learning is better. Discuss both views and give your opinion."],
  ["advantage/disadvantage", "Tourism in Small Communities", "Tourism is increasing in many small communities. What are the advantages and disadvantages of this development?"],
  ["problem/solution", "Long Working Hours", "Many employees work long hours and have little time for family or hobbies. What problems can this cause, and what solutions can you suggest?"],
  ["opinion", "Buying Local Products", "Some people believe consumers should buy local products whenever possible. To what extent do you agree or disagree?"],
  ["two-part question", "People Eating Alone", "More people now eat meals alone rather than with family or friends. Why is this happening? Do you think it is a positive or negative change?"],
  ["discussion", "Public Money for Sports", "Some people think governments should spend more money on sports facilities, while others believe money should be spent on healthcare. Discuss both views and give your opinion."],
  ["problem/solution", "Too Much Plastic Packaging", "Many products are sold with too much plastic packaging. What problems does this cause, and what can consumers and companies do to solve the problem?"],
  ["opinion", "Teaching Money Management", "Some people think schools should teach students how to manage money. To what extent do you agree or disagree?"]
];

function task1Prompt(seed) {
  return `You need to write a letter to ${seed[3]}.\n\nIn your letter:\n- ${seed[4]}\n- ${seed[5]}\n- ${seed[6]}`;
}

function makeTask1(seed, book, test, index) {
  const openingKey = seed[1] === "formal letter" ? "Formal letter 常用开头" : seed[1] === "semi-formal letter" ? "Semi-formal letter 常用开头" : "Informal letter 常用开头";
  return {
    id: `b${book}-t${test}-task1`,
    book: `Cambridge IELTS ${book}`,
    test: `Test ${test}`,
    module: "General Training",
    task: "Task 1",
    type: seed[0],
    letterStyle: seed[1],
    title: seed[2],
    prompt: task1Prompt(seed),
    difficulty: index % 4 === 0 ? "Challenging" : index % 3 === 0 ? "Medium" : "Easy",
    timeLimit: 20,
    recommendedWords: 150,
    usefulPhrases: [...TASK1_PHRASES[openingKey], ...TASK1_PHRASES[seed[7]], ...TASK1_PHRASES["结尾句型"]],
    sampleStructure: task1Structure,
    notes: {
      focus: `letter purpose: ${seed[0]}; reader relationship: ${seed[1]}`,
      band5: "Use a clear opening, cover all three bullet points, and finish with a suitable closing.",
      band6: "Add precise details, keep the tone consistent, and make the requested action or purpose easy to identify."
    },
    sourceStatus: "original placeholder"
  };
}

function makeTask2(seed, book, test, index) {
  return {
    id: `b${book}-t${test}-task2`,
    book: `Cambridge IELTS ${book}`,
    test: `Test ${test}`,
    module: "General Training",
    task: "Task 2",
    type: seed[0],
    title: seed[1],
    prompt: seed[2],
    difficulty: index % 4 === 0 ? "Challenging" : "Medium",
    timeLimit: 40,
    recommendedWords: 250,
    usefulPhrases: [...TASK2_PHRASES["Introduction 模板"], ...TASK2_PHRASES["表达观点的句型"], ...TASK2_PHRASES["表达原因的句型"], ...TASK2_PHRASES["举例句型"], ...TASK2_PHRASES["总结句型"]],
    sampleStructure: task2Structure,
    notes: {
      focus: `position / reasons / examples: prepare a clear answer for this ${seed[0]} essay.`,
      band5: "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.",
      band6: "Show a more precise position, develop reasons logically, and use linking language without overusing templates."
    },
    sourceStatus: "original placeholder"
  };
}

const books = [15, 16, 17, 18, 19, 20];
const prompts = [];
books.forEach((book, bIndex) => {
  [1, 2, 3, 4].forEach((test) => {
    const i = bIndex * 4 + test - 1;
    prompts.push(makeTask1(task1Seeds[i], book, test, i));
    prompts.push(makeTask2(task2Seeds[i], book, test, i));
  });
});

window.IELTS_GT_DATA = {
  meta: {
    projectName: "IELTS General Training Writing Practice Hub",
    copyrightNote: "All prompts are original IELTS General Training style placeholders. They are not Cambridge IELTS 15-20 original questions.",
    books: books.map((book) => `Cambridge IELTS ${book}`),
    testsPerBook: 4
  },
  phraseBanks: { task1: TASK1_PHRASES, task2: TASK2_PHRASES },
  prompts
};
