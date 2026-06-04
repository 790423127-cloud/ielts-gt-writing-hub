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

const extractedPromptOverrides = {
  "b15-t1-task1": { type: "information", letterStyle: "informal letter", title: "Camping Holiday Advice", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nA friend of yours is thinking of going on a camping holiday for the first time this summer. He/She has asked for your advice.\n\nWrite a letter to your friend. In your letter:\n- explain why you think your friend would enjoy a camping holiday\n- describe some possible disadvantages\n- say whether you would like to go camping with your friend this summer\n\nBegin your letter as follows: Dear [Name],` },
  "b15-t2-task1": { type: "application", letterStyle: "formal letter", title: "Museum Voluntary Unpaid Work Application", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nA museum near your home is looking for people to do part-time voluntary/unpaid work. You would like to do some voluntary/unpaid work at the museum.\n\nWrite a letter to the museum director to apply for the voluntary/unpaid work. In your letter:\n- explain why you want to do voluntary/unpaid work at the museum\n- describe some skills and qualities you have that would be useful\n- give details of when you would be available for work\n\nBegin your letter as follows: Dear Sir or Madam,` },
  "b15-t3-task1": { type: "information", letterStyle: "informal letter", title: "Same Course at University Advice", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nA friend of yours is thinking about applying for the same course that you did at university. He/She has asked for your advice about studying this subject.\n\nWrite a letter to your friend. In your letter:\n- give details of the course you took at the university\n- explain why you recommend the university\n- give some advice about how to apply\n\nBegin your letter as follows: Dear [Name],` },
  "b15-t4-task1": { type: "application", letterStyle: "formal letter", title: "Teach Their Two Children Your Language", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYou have seen an advertisement from a couple, who live in Australia, for someone to teach their two children your language for a year.\n\nWrite a letter to the couple. In your letter:\n- explain why you think you would be suitable for the job\n- say what else you could do for the family\n- give your reasons for wanting the job\n\nBegin your letter as follows: Dear Sir or Madam,` },
  "b16-t1-task1": { type: "application", letterStyle: "semi-formal letter", title: "Helping Mrs Barrett at Home", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nMrs Barrett, an English-speaking woman who lives in your town, has advertised for someone to help her in her home for a few hours next summer.\n\nWrite a letter to Mrs Barrett. In your letter:\n- suggest how you could help her in her home\n- say why you would like to do this work\n- explain when you will and will not be available\n\nBegin your letter as follows: Dear Mrs Barrett,` },
  "b16-t2-task1": { type: "information", letterStyle: "formal letter", title: "Town Centres Newspaper Response", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYou have just read an article in a national newspaper which claims that town centres in your country all look very similar to each other. You do not fully agree with this opinion.\n\nWrite a letter to the editor of the newspaper. In your letter:\n- say which points in the article you agree with\n- explain ways in which your town centre is different from most other town centres\n- offer to give a guided tour of your town to the writer of the article\n\nBegin your letter as follows: Dear Sir or Madam,` },
  "b16-t3-task1": { type: "information", letterStyle: "formal letter", title: "Book That Influenced Me Most", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nA magazine wants to include contributions from its readers for an article called 'The book that influenced me most'.\n\nWrite a letter to the editor of the magazine about the book that influenced you most. In your letter:\n- describe what this book was about\n- explain how this book influenced you\n- say whether this book would be likely to influence other people\n\nBegin your letter as follows: Dear Sir or Madam,` },
  "b16-t4-task1": { type: "information", letterStyle: "informal letter", title: "Finding a Place to Live", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYour friend has been offered a place on a course at the university where you studied. He/She would like your advice about finding a place to live.\n\nWrite an email to your friend. In your email:\n- describe where you lived when you were a student at the university\n- recommend the best way for him/her to look for accommodation\n- warn him/her of mistakes students make when choosing accommodation\n\nBegin your email as follows: Dear [Name],` },
  "b17-t1-task1": { type: "information", letterStyle: "informal letter", title: "Learning a New Sport", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYour English-speaking friend who lives in your town has asked for your advice about learning a new sport.\n\nWrite an email to your friend. In your email:\n- recommend a new sport that would be suitable for your friend to learn\n- explain how your friend could learn this sport\n- suggest that you both learn this sport together\n\nBegin your email as follows: Dear [Name],` },
  "b17-t2-task1": { type: "apology", letterStyle: "semi-formal letter", title: "Surprise Birthday Party for Chris", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nThe parents of your Australian friend Chris have invited you to a surprise birthday party for him/her.\n\nWrite a letter to Chris's parents. In your letter:\n- say why you think Chris will enjoy the surprise party\n- explain why you will not be able to attend the party\n- give details of a plan to see Chris at a different time\n\nNote: You do NOT need to write any addresses. Begin your letter as follows: Dear Mr and Mrs Collins,` },
  "b17-t3-task1": { type: "request", letterStyle: "formal letter", title: "Cancel Your Booking", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYou recently booked a part-time course at a college. You now need to cancel your booking.\n\nWrite a letter to the college administrator. In your letter:\n- say which part-time course you booked\n- explain why you need to cancel your booking\n- ask about booking a different course\n\nNote: You do NOT need to write any addresses. Begin your letter as follows: Dear Sir or Madam,` },
  "b17-t4-task1": { type: "complaint", letterStyle: "formal letter", title: "Clothing Online Purchase Complaint", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYou have bought some clothing online and are not satisfied with your purchase.\n\nWrite a letter to the company that you bought the clothing from. In your letter:\n- give details of the purchase\n- describe the problem\n- explain why you need a replacement urgently\n\nNote: You do NOT need to write any addresses. Begin your letter as follows: Dear Sir or Madam,` },
  "b18-t1-task1": { type: "information", letterStyle: "informal letter", title: "Celebrating New Year", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYour English-speaking friend has asked for your help with a college project he/she is doing about celebrating New Year in different countries.\n\nWrite a letter to your friend. In your letter:\n- say how important New Year is to people in your country\n- describe how New Year is celebrated in your country\n- explain what you like about New Year celebrations in your country\n\nNote: You do NOT need to write any addresses. Begin your letter as follows: Dear ......,` },
  "b18-t2-task1": { type: "thanks", letterStyle: "formal letter", title: "Work Experience in an Organisation", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYou are soon going to spend three months doing work experience in an organisation.\n\nWrite a letter to the manager of the organisation where you are going to do work experience. In your letter:\n- thank the manager for the opportunity to do work experience\n- explain what you hope to learn from the work experience\n- ask some questions about the work experience you are going to do\n\nNote: You do NOT need to write any addresses. Begin your letter as follows: Dear Sir or Madam,` },
  "b18-t3-task1": { type: "complaint", letterStyle: "formal letter", title: "Train Tickets Complaint", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYou recently bought some train tickets for a journey a week in advance. When you went to the station to catch the train, you were told you could not use the tickets and the staff were very unhelpful to you.\n\nWrite a letter to the train company. In your letter:\n- describe the problem you had with the tickets\n- say why you were unhappy with the staff\n- suggest what action the train company should take\n\nNote: You do NOT need to write any addresses. Begin your letter as follows: Dear Sir or Madam,` },
  "b18-t4-task1": { type: "thanks", letterStyle: "semi-formal letter", title: "Training Course for Your Work", prompt: `You should spend about 20 minutes on this task. Write at least 150 words.\n\nYou recently attended a training course for your work. Your employer has asked you for your feedback on the training course.\n\nWrite a letter to your employer. In your letter:\n- remind your employer what the course was about\n- explain why the course was useful to you in your work\n- suggest why the course may not be suitable for some of your other colleagues\n\nNote: You do NOT need to write any addresses. Begin your letter as follows: Dear ..........,` },
  "b15-t1-task2": { type: "two-part question", title: "Crime Fiction and TV Crime Dramas", prompt: `In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?` },
  "b15-t2-task2": { type: "problem/solution", title: "Difficulties Getting Enough Sleep", prompt: `Nowadays many people complain that they have difficulties getting enough sleep.\nWhat problems can lack of sleep cause?\nWhat can be done about lack of sleep?` },
  "b15-t3-task2": { type: "opinion", title: "Holidays in Your Own Country", prompt: `In the future, more people will choose to go on holiday in their own country and not travel abroad on holiday.\nDo you agree or disagree?` },
  "b15-t4-task2": { type: "advantage/disadvantage", title: "Paying with Mobile Phone Apps", prompt: `In many countries, paying for things using mobile phone (cellphone) apps is becoming increasingly common.\nDoes this development have more advantages or more disadvantages?` },
  "b16-t1-task2": { type: "problem/solution", title: "Plastic Waste and the Environment", prompt: `Plastic bags, plastic bottles and plastic packaging are bad for the environment.\nWhat damage does plastic do to the environment?\nWhat can be done by governments and individuals to solve this problem?` },
  "b16-t2-task2": { type: "discussion", title: "Trying New Things or Keeping Familiar Habits", prompt: `Some people like to try new things, for example, places to visit and types of food. Other people prefer to keep doing things they are familiar with.\nDiscuss both these attitudes and give your own opinion.` },
  "b16-t3-task2": { type: "two-part question", title: "Living Close to Where People Were Born", prompt: `Some people spend most of their lives living close to where they were born.\nWhat might be the reasons for this?\nWhat are the advantages and disadvantages?` },
  "b16-t4-task2": { type: "two-part question", title: "The Best Time in History to Be Living", prompt: `Some people say that now is the best time in history to be living.\nWhat is your opinion about this?\nWhat other time in history would be interesting to live in?` },
  "b17-t1-task2": { type: "two-part question", title: "Future Cashless Payments", prompt: `In the future, people may no longer be able to pay for things in shops using cash. All payments may have to be made by card or using phones.\nDo you think this will happen one day?\nWhy do you think some people might not be happy to give up using cash?` },
  "b17-t2-task2": { type: "two-part question", title: "Hiring Personal Fitness Trainers", prompt: `In some countries, more and more people are hiring a personal fitness trainer, rather than playing sports or doing exercise classes.\nWhat are the reasons for this?\nIs this a positive or a negative development?` },
  "b17-t3-task2": { type: "opinion", title: "Buying Fewer Expensive Clothes", prompt: `It is better to buy just a few expensive clothes, rather than lots of cheaper clothes.\nDo you agree or disagree?` },
  "b17-t4-task2": { type: "discussion", title: "Socialising with Work Colleagues", prompt: `Some people think that it's a good idea to socialise with work colleagues during evenings and weekends. Other people think it's important to keep working life completely separate from social life.\nDiscuss both these views and give your own opinion.` },
  "b18-t1-task2": { type: "opinion", title: "Working for a Large or Small Company", prompt: `Some people say that it is better to work for a large company than a small one.\nDo you agree or disagree?` },
  "b18-t2-task2": { type: "opinion", title: "First Impressions of People", prompt: `When we meet someone for the first time, we generally decide very quickly what kind of person we think they are and if we like them or not.\nIs this a good thing or a bad thing?` },
  "b18-t3-task2": { type: "two-part question", title: "Having More Than One Job", prompt: `In the past, most working people had only one job. However, nowadays, more and more people have more than one job at the same time.\nWhat are the reasons for this development?\nWhat are the advantages and disadvantages of having more than one job?` },
  "b18-t4-task2": { type: "two-part question", title: "Disliking Changes in Society and Life", prompt: `Some people dislike changes in their society and in their own lives, and want things to stay the same.\nWhy do some people want things to stay the same?\nWhy should change be regarded as something positive?` },
  "b19-t1-task1": { type: "request", letterStyle: "formal letter", title: "Reducing Working Hours", prompt: `You would like to reduce your working hours in order to study part time.\n\nWrite a letter to your boss. In your letter\n- explain why you want to reduce your working hours\n- say which hours you would like to work\n- describe how your part-time studies would benefit your employer` },
  "b19-t1-task2": { type: "two-part question", title: "Taking Photos at Famous Places", prompt: `More and more people nowadays visit well-known places to take photographs of themselves, without looking at the place.\nWhy do you think this is happening?\nIs it a positive or a negative trend?` },
  "b19-t2-task1": { type: "arrangement", letterStyle: "semi-formal letter", title: "International Food Event", prompt: `You are a member of an International Students' Club. The club is organising an event to celebrate popular food from around the world.\n\nWrite a letter to the event organiser, Luis. In your letter\n- offer to make a popular dish from your country\n- describe what this dish is\n- explain why it should be included in the event` },
  "b19-t2-task2": { type: "two-part question", title: "Paying Someone to Do Unwanted Tasks", prompt: `It is sometimes possible to pay somebody to do things you don't want to do, or don't have time to do, for example, household chores or looking after children.\nIs this a good way of providing work for others?\nShould people do these things themselves?` },
  "b19-t3-task1": { type: "request", letterStyle: "formal letter", title: "Extending Apartment Rental", prompt: `Five months ago, you started renting an apartment on a six-month agreement. You now wish to stay in the apartment for longer than the six months you originally agreed with the owner.\n\nWrite a letter to the owner of your apartment. In your letter\n- say how long you now want to rent the apartment for\n- explain why your plans have changed\n- tell the owner about a problem in the apartment` },
  "b19-t3-task2": { type: "two-part question", title: "Imported Goods", prompt: `Some consumers are increasingly choosing to buy goods that are produced in their local area, rather than imported goods.\nWhat are the reasons for this?\nIs this a positive or a negative trend?` },
  "b19-t4-task1": { type: "request", letterStyle: "formal letter", title: "Moving to a Different Department", prompt: `You started in your present job two years ago. You now feel it is important for your career development to move to a different department in the same company.\n\nWrite a letter to your manager. In your letter\n- say what you have learned in your present job\n- suggest how the company would benefit from moving you to a different department\n- explain why you do not wish to leave the company` },
  "b19-t4-task2": { type: "discussion", title: "Photographing Famous People", prompt: `Nowadays famous people are photographed by professional photographers everywhere they go. Some people say this is a good thing because the public are interested in their lives. Other people think that photographers are wrong to follow famous people.\nDiscuss both these views and give your own opinion.` },
  "b20-t1-task1": { type: "arrangement", letterStyle: "informal letter", title: "College Anniversary Celebration", prompt: `It is ten years since you left college. You'd like to organise an event to celebrate this anniversary with all your friends and classmates from college.\n\nWrite a letter to one of your college friends. In your letter\n- say what kind of celebration event you'd like to organise\n- explain why you think it would be good to celebrate in this way\n- describe what help you need to organise this event` },
  "b20-t1-task2": { type: "opinion", title: "The Importance of Hobbies", prompt: `It is important for children, young adults, working people and the retired to have at least one hobby.\nWhat's your opinion about this?` },
  "b20-t2-task1": { type: "information", letterStyle: "semi-formal letter", title: "Studying Abroad Experience", prompt: `The younger sister of one of your friends is thinking about spending a year studying abroad as part of her university course. You did this recently, and she has asked you about your experience.\n\nWrite a letter to your friend's sister. In your letter\n- tell her where you studied during your year abroad\n- describe what you learnt about the country you studied in\n- explain why your year abroad was helpful for your studies` },
  "b20-t2-task2": { type: "advantage/disadvantage", title: "Family Businesses", prompt: `In many countries, family members work together in their family business.\nDo you think family businesses have more advantages than disadvantages?` },
  "b20-t3-task1": { type: "invitation", letterStyle: "formal letter", title: "Opening a New Theatre", prompt: `You work for an entertainment company which plans to open a new theatre soon. You want to invite a famous actor to open the new theatre.\n\nWrite a letter to this famous actor. In your letter\n- give some information about the new theatre\n- invite her/him to open the new theatre\n- explain why she/he would be a good person to open the theatre` },
  "b20-t3-task2": { type: "opinion", title: "Looking Younger", prompt: `Nowadays it's possible for people to buy many products or pay for treatments that help them to look younger.\nIs this a good thing or a bad thing?` },
  "b20-t4-task1": { type: "thanks", letterStyle: "formal letter", title: "Moving Company Feedback", prompt: `You recently used a company to help you move your furniture and possessions to your new apartment. The removal company has now asked for your feedback about the service they provided.\n\nWrite a letter to the removal company. In your letter\n- explain what went well on the day you moved house\n- praise an employee who was particularly helpful\n- mention an aspect of the service that you were not happy with` },
  "b20-t4-task2": { type: "problem/solution", title: "Buying Too Many Clothes", prompt: `In some parts of the world, people buy far too many clothes.\nWhat are the reasons for this?\nHow can people be persuaded to reduce the number of clothes they buy?` }
};

prompts.forEach((prompt) => {
  const extracted = extractedPromptOverrides[prompt.id];
  if (!extracted) return;
  Object.assign(prompt, extracted, { sourceStatus: "user-provided extracted prompt" });
  prompt.notes = {
    ...prompt.notes,
    focus: prompt.task === "Task 1" ? `letter purpose: ${prompt.type}; reader relationship: ${prompt.letterStyle}` : `position / reasons / examples: prepare a clear answer for this ${prompt.type} essay.`
  };
});

window.IELTS_GT_DATA = {
  meta: {
    projectName: "IELTS General Training Writing Practice Hub",
    copyrightNote: "Prompts have been entered from user-provided study materials for personal IELTS General Training writing practice.",
    books: books.map((book) => `Cambridge IELTS ${book}`),
    testsPerBook: 4
  },
  phraseBanks: { task1: TASK1_PHRASES, task2: TASK2_PHRASES },
  prompts
};
