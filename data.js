// IELTS GT Writing Hub — user-provided prompts with reviewed classifications.
// Classification audit: 2026-06-29
// Task 1: formal / semi-formal / informal + letter purpose.
// Task 2: opinion, discussion, advantages/disadvantages, problem/solution, or mixed two-part question.

const TASK1_PHRASES = {
  "Formal letter 常用开头": [
    "Dear Sir or Madam,",
    "I am writing to enquire about ...",
    "I am writing to express my concern about ...",
    "I would be grateful if you could ..."
  ],
  "Semi-formal letter 常用开头": [
    "Dear Mr / Ms [Surname],",
    "I hope you are well.",
    "I am writing to ask for your help with ...",
    "I am writing about ..."
  ],
  "Informal letter 常用开头": [
    "Dear [First name],",
    "How are you? I hope you are well.",
    "I am writing to tell you about ...",
    "It would be great to hear from you."
  ],
  "投诉信句型": [
    "Unfortunately, I was not satisfied with ...",
    "This caused a great deal of inconvenience.",
    "I would be grateful if you could look into this matter.",
    "I hope that a suitable solution can be found soon."
  ],
  "请求 / 咨询信句型": [
    "I would be grateful if you could provide more information about ...",
    "Could you please let me know whether ...?",
    "It would be very helpful if you could ...",
    "Please let me know if you need any further details."
  ],
  "道歉信句型": [
    "Please accept my sincere apologies for ...",
    "I am very sorry for any inconvenience this may have caused.",
    "I would like to explain what happened.",
    "I will make sure this does not happen again."
  ],
  "感谢 / 反馈信句型": [
    "I am writing to thank you for ...",
    "I really appreciated the help and service provided.",
    "One aspect that could be improved is ...",
    "I hope this feedback will be useful."
  ],
  "邀请 / 安排信句型": [
    "I would be delighted if you could join us for ...",
    "It would be wonderful to see you there.",
    "The event will take place on ...",
    "Please let me know whether you are able to come."
  ],
  "申请信句型": [
    "I am writing to apply for the position of ...",
    "I believe that my experience makes me a suitable candidate.",
    "I would welcome the opportunity to discuss my application further.",
    "Please find below a summary of my relevant experience."
  ],
  "建议信句型": [
    "I think the best time would be ...",
    "You may also wish to ...",
    "This would be a good choice because ...",
    "I hope these suggestions are helpful."
  ],
  "结尾句型": [
    "Thank you for your attention to this matter.",
    "I look forward to hearing from you soon.",
    "Yours faithfully,",
    "Yours sincerely,",
    "Best wishes,"
  ]
};

const TASK2_PHRASES = {
  "Introduction 模板": [
    "It is often argued that ...",
    "People have different views about whether ...",
    "This essay will explain my view.",
    "This essay will discuss the main points."
  ],
  "主体段展开": [
    "The main reason is that ...",
    "This means that ...",
    "For example, ...",
    "As a result, ..."
  ],
  "对比与让步": [
    "On the one hand, ...",
    "On the other hand, ...",
    "However, ...",
    "Although this is true, ..."
  ],
  "结论": [
    "In conclusion, ...",
    "Overall, I believe that ...",
    "For these reasons, ...",
    "The best solution would be to ..."
  ]
};

const task1Structure = [
  "Opening: choose a suitable greeting and state the purpose clearly.",
  "Paragraph 1: explain the situation and give key background.",
  "Paragraph 2: cover the first and second bullet points with details.",
  "Paragraph 3: cover the final bullet point and make the action or request clear.",
  "Closing: use a tone-appropriate final sentence and sign-off."
];

const task2Structure = [
  "Introduction: paraphrase the topic and state your position or essay plan.",
  "Body paragraph 1: answer the first main point with a reason and example.",
  "Body paragraph 2: answer the second main point, other side, or second question.",
  "Conclusion: summarise the answer and repeat your main view."
];

const prompts = [
  {
    "id": "b15-t1-task1",
    "book": "Cambridge IELTS 15",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "complaint / 投诉",
    "title": "Noise from a Community Hall",
    "prompt": "You need to write a letter to the manager of a community hall.\n\nIn your letter:\n- describe the noise problem\n- explain how it affects local residents\n- suggest what action should be taken",
    "difficulty": "Challenging",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "Unfortunately, I was not satisfied with ...", "This caused a great deal of inconvenience.", "I would be grateful if you could look into this matter.", "I hope that a suitable solution can be found soon.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：complaint / 投诉；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b15-t2-task1",
    "book": "Cambridge IELTS 15",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "request / 请求",
    "title": "Changing a Work Shift",
    "prompt": "You need to write a letter to a colleague you know well.\n\nIn your letter:\n- explain why you need to change your shift\n- ask for help\n- offer something in return",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "I would be grateful if you could provide more information about ...", "Could you please let me know whether ...?", "It would be very helpful if you could ...", "Please let me know if you need any further details.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：request / 请求；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b15-t3-task1",
    "book": "Cambridge IELTS 15",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 非正式信",
    "purpose": "apology / 道歉",
    "title": "Missing a Friend's Dinner",
    "prompt": "You need to write a letter to a close friend.\n\nIn your letter:\n- apologise for not coming\n- explain what happened\n- suggest a new time to meet",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "非正式 / Informal",
    "usefulPhrases": ["Dear [First name],", "How are you? I hope you are well.", "I am writing to tell you about ...", "It would be great to hear from you.", "Please accept my sincere apologies for ...", "I am very sorry for any inconvenience this may have caused.", "I would like to explain what happened.", "I will make sure this does not happen again.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 非正式信；写信目的：apology / 道歉；语气：非正式 / Informal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b15-t4-task1",
    "book": "Cambridge IELTS 15",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "application / 申请",
    "title": "Weekend Museum Assistant",
    "prompt": "You need to write a letter to the museum director.\n\nIn your letter:\n- say which role you are applying for\n- describe relevant experience\n- explain your availability",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "I am writing to apply for the position of ...", "I believe that my experience makes me a suitable candidate.", "I would welcome the opportunity to discuss my application further.", "Please find below a summary of my relevant experience.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：application / 申请；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b16-t1-task1",
    "book": "Cambridge IELTS 16",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "enquiry / 咨询",
    "title": "Asking About an Evening Course",
    "prompt": "You need to write a letter to a course organiser you met before.\n\nIn your letter:\n- remind the organiser where you met\n- ask about timetable and fees\n- explain why you are interested",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "I would be grateful if you could provide more information about ...", "Could you please let me know whether ...?", "It would be very helpful if you could ...", "Please let me know if you need any further details.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：enquiry / 咨询；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b16-t2-task1",
    "book": "Cambridge IELTS 16",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 非正式信",
    "purpose": "arrangement / 安排",
    "title": "Planning a City Visit",
    "prompt": "You need to write a letter to a friend visiting your city.\n\nIn your letter:\n- suggest where your friend can stay\n- recommend places to visit\n- explain how you can spend time together",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "非正式 / Informal",
    "usefulPhrases": ["Dear [First name],", "How are you? I hope you are well.", "I am writing to tell you about ...", "It would be great to hear from you.", "I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know whether you are able to come.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 非正式信；写信目的：arrangement / 安排；语气：非正式 / Informal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b16-t3-task1",
    "book": "Cambridge IELTS 16",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "thanks / 感谢",
    "title": "Thanking a Helpful Neighbour",
    "prompt": "You need to write a letter to a neighbour.\n\nIn your letter:\n- thank them for their help\n- explain why it mattered\n- invite them to your home",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "I am writing to thank you for ...", "I really appreciated the help and service provided.", "One aspect that could be improved is ...", "I hope this feedback will be useful.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：thanks / 感谢；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b16-t4-task1",
    "book": "Cambridge IELTS 16",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 非正式信",
    "purpose": "invitation / 邀请",
    "title": "Sports Event Invitation",
    "prompt": "You need to write a letter to a friend.\n\nIn your letter:\n- explain what the event is\n- say why your friend will enjoy it\n- give time and place details",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "非正式 / Informal",
    "usefulPhrases": ["Dear [First name],", "How are you? I hope you are well.", "I am writing to tell you about ...", "It would be great to hear from you.", "I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know whether you are able to come.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 非正式信；写信目的：invitation / 邀请；语气：非正式 / Informal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b17-t1-task1",
    "book": "Cambridge IELTS 17",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "complaint / 投诉",
    "title": "Unreliable Bus Service",
    "prompt": "You need to write a letter to a transport company.\n\nIn your letter:\n- describe the service problem\n- explain the effect on passengers\n- suggest improvements",
    "difficulty": "Challenging",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "Unfortunately, I was not satisfied with ...", "This caused a great deal of inconvenience.", "I would be grateful if you could look into this matter.", "I hope that a suitable solution can be found soon.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：complaint / 投诉；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b17-t2-task1",
    "book": "Cambridge IELTS 17",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "complaint / 投诉",
    "title": "Incorrect Online Delivery",
    "prompt": "You need to write a letter to customer service.\n\nIn your letter:\n- describe what you ordered\n- explain what arrived instead\n- say what you want the company to do",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "Unfortunately, I was not satisfied with ...", "This caused a great deal of inconvenience.", "I would be grateful if you could look into this matter.", "I hope that a suitable solution can be found soon.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：complaint / 投诉；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b17-t3-task1",
    "book": "Cambridge IELTS 17",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 非正式信",
    "purpose": "sharing + invitation / 分享 + 邀请",
    "title": "Sharing a New Hobby",
    "prompt": "You need to write a letter to a friend.\n\nIn your letter:\n- describe the hobby\n- explain why you enjoy it\n- invite your friend to try it",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "非正式 / Informal",
    "usefulPhrases": ["Dear [First name],", "How are you? I hope you are well.", "I am writing to tell you about ...", "It would be great to hear from you.", "I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know whether you are able to come.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 非正式信；写信目的：sharing + invitation / 分享 + 邀请；语气：非正式 / Informal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b17-t4-task1",
    "book": "Cambridge IELTS 17",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "feedback + enquiry / 反馈 + 咨询",
    "title": "Feedback After a Workshop",
    "prompt": "You need to write a letter to a workshop organiser.\n\nIn your letter:\n- say what was useful\n- mention one improvement\n- ask about future workshops",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "I am writing to thank you for ...", "I really appreciated the help and service provided.", "One aspect that could be improved is ...", "I hope this feedback will be useful.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：feedback + enquiry / 反馈 + 咨询；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b18-t1-task1",
    "book": "Cambridge IELTS 18",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "enquiry / 咨询",
    "title": "Requesting College Information",
    "prompt": "You need to write a letter to a college admissions office.\n\nIn your letter:\n- say which course interests you\n- ask about entry requirements\n- ask about fees and start dates",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "I would be grateful if you could provide more information about ...", "Could you please let me know whether ...?", "It would be very helpful if you could ...", "Please let me know if you need any further details.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：enquiry / 咨询；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b18-t2-task1",
    "book": "Cambridge IELTS 18",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "apology + offer / 道歉 + 赔偿",
    "title": "Apologising to a Landlord",
    "prompt": "You need to write a letter to your landlord.\n\nIn your letter:\n- apologise for damage\n- explain how it happened\n- offer to pay for repair",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "Please accept my sincere apologies for ...", "I am very sorry for any inconvenience this may have caused.", "I would like to explain what happened.", "I will make sure this does not happen again.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：apology + offer / 道歉 + 赔偿；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b18-t3-task1",
    "book": "Cambridge IELTS 18",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "application / 申请",
    "title": "Festival Volunteer Application",
    "prompt": "You need to write a letter to a volunteer coordinator.\n\nIn your letter:\n- explain why you want to volunteer\n- describe your skills\n- say when you are available",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "I am writing to apply for the position of ...", "I believe that my experience makes me a suitable candidate.", "I would welcome the opportunity to discuss my application further.", "Please find below a summary of my relevant experience.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：application / 申请；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b18-t4-task1",
    "book": "Cambridge IELTS 18",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 非正式信",
    "purpose": "advice / 建议",
    "title": "Travel Advice for a Friend",
    "prompt": "You need to write a letter to a friend visiting your country.\n\nIn your letter:\n- suggest the best time to visit\n- recommend things to do\n- give transport or weather advice",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "非正式 / Informal",
    "usefulPhrases": ["Dear [First name],", "How are you? I hope you are well.", "I am writing to tell you about ...", "It would be great to hear from you.", "I think the best time would be ...", "You may also wish to ...", "This would be a good choice because ...", "I hope these suggestions are helpful.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 非正式信；写信目的：advice / 建议；语气：非正式 / Informal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b19-t1-task1",
    "book": "Cambridge IELTS 19",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "offer + suggestion / 提议 + 建议",
    "title": "International Food Event",
    "prompt": "You need to write a letter to Luis, the event organiser.\n\nIn your letter:\n- offer to make a popular dish from your country\n- describe what this dish is\n- explain why it should be included in the event",
    "difficulty": "Challenging",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know whether you are able to come.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：offer + suggestion / 提议 + 建议；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b19-t2-task1",
    "book": "Cambridge IELTS 19",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "invitation / 邀请",
    "title": "Inviting a Former Teacher",
    "prompt": "You need to write a letter to a former teacher.\n\nIn your letter:\n- explain the event\n- say why you want them to attend\n- give date and location",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know whether you are able to come.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：invitation / 邀请；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b19-t3-task1",
    "book": "Cambridge IELTS 19",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "request / 请求",
    "title": "Extending Apartment Rental",
    "prompt": "You need to write a letter to the owner of your apartment.\n\nIn your letter:\n- say how long you now want to rent the apartment for\n- explain why your plans have changed\n- tell the owner about a problem in the apartment",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "I would be grateful if you could provide more information about ...", "Could you please let me know whether ...?", "It would be very helpful if you could ...", "Please let me know if you need any further details.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：request / 请求；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b19-t4-task1",
    "book": "Cambridge IELTS 19",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "request / 请求",
    "title": "Moving to a Different Department",
    "prompt": "You need to write a letter to your manager.\n\nIn your letter:\n- say what you have learned in your present job\n- suggest how the company would benefit from moving you to a different department\n- explain why you do not wish to leave the company",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "I would be grateful if you could provide more information about ...", "Could you please let me know whether ...?", "It would be very helpful if you could ...", "Please let me know if you need any further details.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：request / 请求；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b20-t1-task1",
    "book": "Cambridge IELTS 20",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 非正式信",
    "purpose": "arrangement / 安排",
    "title": "College Anniversary Celebration",
    "prompt": "You need to write a letter to one of your college friends.\n\nIn your letter:\n- say what kind of celebration event you'd like to organise\n- explain why you think it would be good to celebrate in this way\n- describe what help you need to organise this event",
    "difficulty": "Challenging",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "非正式 / Informal",
    "usefulPhrases": ["Dear [First name],", "How are you? I hope you are well.", "I am writing to tell you about ...", "It would be great to hear from you.", "I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know whether you are able to come.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 非正式信；写信目的：arrangement / 安排；语气：非正式 / Informal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b20-t2-task1",
    "book": "Cambridge IELTS 20",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 半正式信",
    "purpose": "information / 分享经历",
    "title": "Studying Abroad Experience",
    "prompt": "You need to write a letter to your friend's sister.\n\nIn your letter:\n- tell her where you studied during your year abroad\n- describe what you learnt about the country you studied in\n- explain why your year abroad was helpful for your studies",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "半正式 / Semi-formal",
    "usefulPhrases": ["Dear Mr / Ms [Surname],", "I hope you are well.", "I am writing to ask for your help with ...", "I am writing about ...", "I would be grateful if you could provide more information about ...", "Could you please let me know whether ...?", "It would be very helpful if you could ...", "Please let me know if you need any further details.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 半正式信；写信目的：information / 分享经历；语气：半正式 / Semi-formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b20-t3-task1",
    "book": "Cambridge IELTS 20",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "invitation / 邀请",
    "title": "Opening a New Theatre",
    "prompt": "You need to write a letter to a famous actor.\n\nIn your letter:\n- give some information about the new theatre\n- invite her/him to open the new theatre\n- explain why she/he would be a good person to open the theatre",
    "difficulty": "Easy",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "I would be delighted if you could join us for ...", "It would be wonderful to see you there.", "The event will take place on ...", "Please let me know whether you are able to come.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：invitation / 邀请；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b20-t4-task1",
    "book": "Cambridge IELTS 20",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 1",
    "type": "Task 1 正式信",
    "purpose": "feedback / 反馈",
    "title": "Moving Company Feedback",
    "prompt": "You need to write a letter to the removal company.\n\nIn your letter:\n- explain what went well on the day you moved house\n- praise an employee who was particularly helpful\n- mention an aspect of the service that you were not happy with",
    "difficulty": "Medium",
    "timeLimit": 20,
    "recommendedWords": 150,
    "sourceStatus": "user-provided · classification reviewed",
    "letterStyle": "正式 / Formal",
    "usefulPhrases": ["Dear Sir or Madam,", "I am writing to enquire about ...", "I am writing to express my concern about ...", "I would be grateful if you could ...", "I am writing to thank you for ...", "I really appreciated the help and service provided.", "One aspect that could be improved is ...", "I hope this feedback will be useful.", "Thank you for your attention to this matter.", "I look forward to hearing from you soon.", "Yours faithfully,", "Yours sincerely,", "Best wishes,"],
    "sampleStructure": task1Structure,
    "notes": {"focus": "题型：Task 1 正式信；写信目的：feedback / 反馈；语气：正式 / Formal。", "band5": "Use a clear opening, cover all three bullet points, and use a suitable closing.", "band6": "Add precise details, keep the tone consistent, and make the purpose or requested action easy to identify."}
  },
  {
    "id": "b15-t1-task2",
    "book": "Cambridge IELTS 15",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "reasons + opinion / 原因+观点",
    "title": "Crime Fiction and TV Crime Dramas",
    "prompt": "In many countries today, crime novels and TV crime dramas are becoming more and more popular.\nWhy do you think these books and TV shows are popular?\nWhat is your opinion of crime fiction and TV crime dramas?",
    "difficulty": "Challenging",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：reasons + opinion / 原因+观点。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b15-t2-task2",
    "book": "Cambridge IELTS 15",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 原因 / 问题 / 解决类",
    "purpose": "problems + solutions / 问题+解决",
    "title": "Difficulties Getting Enough Sleep",
    "prompt": "Nowadays many people complain that they have difficulties getting enough sleep.\nWhat problems can lack of sleep cause?\nWhat can be done about lack of sleep?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 原因 / 问题 / 解决类；本题目的：problems + solutions / 问题+解决。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b15-t3-task2",
    "book": "Cambridge IELTS 15",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 观点 / 判断类",
    "purpose": "agree or disagree / 同意或不同意",
    "title": "Holidays in Your Own Country",
    "prompt": "In the future, more people will choose to go on holiday in their own country and not travel abroad on holiday.\nDo you agree or disagree?",
    "difficulty": "Easy",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 观点 / 判断类；本题目的：agree or disagree / 同意或不同意。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b15-t4-task2",
    "book": "Cambridge IELTS 15",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 优缺点 / 权衡类",
    "purpose": "advantages vs disadvantages / 优缺点比较",
    "title": "Paying with Mobile Phone Apps",
    "prompt": "In many countries, paying for things using mobile phone (cellphone) apps is becoming increasingly common.\nDoes this development have more advantages or more disadvantages?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 优缺点 / 权衡类；本题目的：advantages vs disadvantages / 优缺点比较。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b16-t1-task2",
    "book": "Cambridge IELTS 16",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 原因 / 问题 / 解决类",
    "purpose": "damage + solutions / 影响+解决",
    "title": "Plastic Waste and the Environment",
    "prompt": "Plastic bags, plastic bottles and plastic packaging are bad for the environment.\nWhat damage does plastic do to the environment?\nWhat can be done by governments and individuals to solve this problem?",
    "difficulty": "Easy",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 原因 / 问题 / 解决类；本题目的：damage + solutions / 影响+解决。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b16-t2-task2",
    "book": "Cambridge IELTS 16",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双方观点类",
    "purpose": "discussion + opinion / 双方观点+个人观点",
    "title": "Trying New Things or Keeping Familiar Habits",
    "prompt": "Some people like to try new things, for example, places to visit and types of food. Other people prefer to keep doing things they are familiar with.\nDiscuss both these attitudes and give your own opinion.",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双方观点类；本题目的：discussion + opinion / 双方观点+个人观点。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b16-t3-task2",
    "book": "Cambridge IELTS 16",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "reasons + advantages/disadvantages / 原因+优缺点",
    "title": "Living Close to Where People Were Born",
    "prompt": "Some people spend most of their lives living close to where they were born.\nWhat might be the reasons for this?\nWhat are the advantages and disadvantages?",
    "difficulty": "Challenging",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：reasons + advantages/disadvantages / 原因+优缺点。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b16-t4-task2",
    "book": "Cambridge IELTS 16",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "opinion + extension / 观点+延伸问题",
    "title": "The Best Time in History to Be Living",
    "prompt": "Some people say that now is the best time in history to be living.\nWhat is your opinion about this?\nWhat other time in history would be interesting to live in?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：opinion + extension / 观点+延伸问题。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b17-t1-task2",
    "book": "Cambridge IELTS 17",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "prediction + reasons / 预测+原因",
    "title": "Future Cashless Payments",
    "prompt": "In the future, people may no longer be able to pay for things in shops using cash. All payments may have to be made by card or using phones.\nDo you think this will happen one day?\nWhy do you think some people might not be happy to give up using cash?",
    "difficulty": "Easy",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：prediction + reasons / 预测+原因。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b17-t2-task2",
    "book": "Cambridge IELTS 17",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "reasons + positive/negative / 原因+正负判断",
    "title": "Hiring Personal Fitness Trainers",
    "prompt": "In some countries, more and more people are hiring a personal fitness trainer, rather than playing sports or doing exercise classes.\nWhat are the reasons for this?\nIs this a positive or a negative development?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：reasons + positive/negative / 原因+正负判断。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b17-t3-task2",
    "book": "Cambridge IELTS 17",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 观点 / 判断类",
    "purpose": "agree or disagree / 同意或不同意",
    "title": "Buying Fewer Expensive Clothes",
    "prompt": "It is better to buy just a few expensive clothes, rather than lots of cheaper clothes.\nDo you agree or disagree?",
    "difficulty": "Challenging",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 观点 / 判断类；本题目的：agree or disagree / 同意或不同意。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b17-t4-task2",
    "book": "Cambridge IELTS 17",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双方观点类",
    "purpose": "discussion + opinion / 双方观点+个人观点",
    "title": "Socialising with Work Colleagues",
    "prompt": "Some people think that it's a good idea to socialise with work colleagues during evenings and weekends. Other people think it's important to keep working life completely separate from social life.\nDiscuss both these views and give your own opinion.",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双方观点类；本题目的：discussion + opinion / 双方观点+个人观点。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b18-t1-task2",
    "book": "Cambridge IELTS 18",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 观点 / 判断类",
    "purpose": "agree or disagree / 同意或不同意",
    "title": "Working for a Large or Small Company",
    "prompt": "Some people say that it is better to work for a large company than a small one.\nDo you agree or disagree?",
    "difficulty": "Easy",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 观点 / 判断类；本题目的：agree or disagree / 同意或不同意。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b18-t2-task2",
    "book": "Cambridge IELTS 18",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 观点 / 判断类",
    "purpose": "good or bad / 好坏判断",
    "title": "First Impressions of People",
    "prompt": "When we meet someone for the first time, we generally decide very quickly what kind of person we think they are and if we like them or not.\nIs this a good thing or a bad thing?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 观点 / 判断类；本题目的：good or bad / 好坏判断。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b18-t3-task2",
    "book": "Cambridge IELTS 18",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "reasons + advantages/disadvantages / 原因+优缺点",
    "title": "Having More Than One Job",
    "prompt": "In the past, most working people had only one job. However, nowadays, more and more people have more than one job at the same time.\nWhat are the reasons for this development?\nWhat are the advantages and disadvantages of having more than one job?",
    "difficulty": "Challenging",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：reasons + advantages/disadvantages / 原因+优缺点。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b18-t4-task2",
    "book": "Cambridge IELTS 18",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "reasons + positive view / 原因+正面论证",
    "title": "Disliking Changes in Society and Life",
    "prompt": "Some people dislike changes in their society and in their own lives, and want things to stay the same.\nWhy do some people want things to stay the same?\nWhy should change be regarded as something positive?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：reasons + positive view / 原因+正面论证。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b19-t1-task2",
    "book": "Cambridge IELTS 19",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "reasons + positive/negative / 原因+正负判断",
    "title": "Taking Photos at Famous Places",
    "prompt": "More and more people nowadays visit well-known places to take photographs of themselves, without looking at the place.\nWhy do you think this is happening?\nIs it a positive or a negative trend?",
    "difficulty": "Easy",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：reasons + positive/negative / 原因+正负判断。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b19-t2-task2",
    "book": "Cambridge IELTS 19",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "two judgement questions / 双判断问题",
    "title": "Paying Someone to Do Unwanted Tasks",
    "prompt": "It is sometimes possible to pay somebody to do things you don't want to do, or don't have time to do, for example, household chores or looking after children.\nIs this a good way of providing work for others?\nShould people do these things themselves?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：two judgement questions / 双判断问题。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b19-t3-task2",
    "book": "Cambridge IELTS 19",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双问题 / 混合问法",
    "purpose": "reasons + positive/negative / 原因+正负判断",
    "title": "Imported Goods",
    "prompt": "Some consumers are increasingly choosing to buy goods that are produced in their local area, rather than imported goods.\nWhat are the reasons for this?\nIs this a positive or a negative trend?",
    "difficulty": "Challenging",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双问题 / 混合问法；本题目的：reasons + positive/negative / 原因+正负判断。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b19-t4-task2",
    "book": "Cambridge IELTS 19",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 双方观点类",
    "purpose": "discussion + opinion / 双方观点+个人观点",
    "title": "Photographing Famous People",
    "prompt": "Nowadays famous people are photographed by professional photographers everywhere they go. Some people say this is a good thing because the public are interested in their lives. Other people think that photographers are wrong to follow famous people.\nDiscuss both these views and give your own opinion.",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 双方观点类；本题目的：discussion + opinion / 双方观点+个人观点。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b20-t1-task2",
    "book": "Cambridge IELTS 20",
    "test": "Test 1",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 观点 / 判断类",
    "purpose": "opinion / 个人观点",
    "title": "The Importance of Hobbies",
    "prompt": "It is important for children, young adults, working people and the retired to have at least one hobby.\nWhat's your opinion about this?",
    "difficulty": "Easy",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 观点 / 判断类；本题目的：opinion / 个人观点。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b20-t2-task2",
    "book": "Cambridge IELTS 20",
    "test": "Test 2",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 优缺点 / 权衡类",
    "purpose": "outweigh / 优缺点谁更大",
    "title": "Family Businesses",
    "prompt": "In many countries, family members work together in their family business.\nDo you think family businesses have more advantages than disadvantages?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 优缺点 / 权衡类；本题目的：outweigh / 优缺点谁更大。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b20-t3-task2",
    "book": "Cambridge IELTS 20",
    "test": "Test 3",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 观点 / 判断类",
    "purpose": "good or bad / 好坏判断",
    "title": "Looking Younger",
    "prompt": "Nowadays it's possible for people to buy many products or pay for treatments that help them to look younger.\nIs this a good thing or a bad thing?",
    "difficulty": "Challenging",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 观点 / 判断类；本题目的：good or bad / 好坏判断。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  },
  {
    "id": "b20-t4-task2",
    "book": "Cambridge IELTS 20",
    "test": "Test 4",
    "module": "General Training",
    "task": "Task 2",
    "type": "Task 2 原因 / 问题 / 解决类",
    "purpose": "reasons + solutions / 原因+解决",
    "title": "Buying Too Many Clothes",
    "prompt": "In some parts of the world, people buy far too many clothes.\nWhat are the reasons for this?\nHow can people be persuaded to reduce the number of clothes they buy?",
    "difficulty": "Medium",
    "timeLimit": 40,
    "recommendedWords": 250,
    "sourceStatus": "user-provided · classification reviewed",
    "usefulPhrases": ["It is often argued that ...", "People have different views about whether ...", "This essay will explain my view.", "This essay will discuss the main points.", "The main reason is that ...", "This means that ...", "For example, ...", "As a result, ...", "On the one hand, ...", "On the other hand, ...", "However, ...", "Although this is true, ...", "In conclusion, ...", "Overall, I believe that ...", "For these reasons, ...", "The best solution would be to ..."],
    "sampleStructure": task2Structure,
    "notes": {"focus": "题型：Task 2 原因 / 问题 / 解决类；本题目的：reasons + solutions / 原因+解决。", "band5": "Give a clear answer, use two body paragraphs, and support each main idea with a simple example.", "band6": "Answer every part of the question, develop ideas logically, and use linking language without overusing templates."}
  }
];

window.IELTS_GT_DATA = {
  meta: {
    projectName: "IELTS General Training Writing Practice Hub",
    copyrightNote: "Prompts are from user-provided study materials. Classifications were reviewed on 2026-06-29.",
    books: ["Cambridge IELTS 15", "Cambridge IELTS 16", "Cambridge IELTS 17", "Cambridge IELTS 18", "Cambridge IELTS 19", "Cambridge IELTS 20"],
    testsPerBook: 4,
    classificationReviewDate: "2026-06-29"
  },
  phraseBanks: { task1: TASK1_PHRASES, task2: TASK2_PHRASES },
  prompts
};

// Add the detailed "purpose" label to the existing UI without changing its core logic.
// data.js runs before script.js; this callback runs after the app has rendered.
(function attachClassificationLabels() {
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  let lastSelectedId = "";

  function promptFromPage() {
    if (lastSelectedId) {
      const found = prompts.find((item) => item.id === lastSelectedId);
      if (found) return found;
    }
    const heading = document.getElementById("practiceTitle")?.textContent || "";
    return prompts.find((item) => heading.includes(item.title)) || null;
  }

  function addPurposeTag(container, prompt) {
    if (!container || !prompt?.purpose || container.querySelector(".purpose-tag")) return;
    const tag = document.createElement("span");
    tag.className = "tag type purpose-tag";
    tag.textContent = prompt.purpose;
    container.appendChild(tag);
  }

  function decorate() {
    document.querySelectorAll("#promptList button[data-id]").forEach((button) => {
      const prompt = prompts.find((item) => item.id === button.dataset.id);
      addPurposeTag(button.querySelector(".tags"), prompt);
    });

    const prompt = promptFromPage();
    if (!prompt) return;

    addPurposeTag(document.getElementById("metaTags"), prompt);

    const infoGrid = document.getElementById("infoGrid");
    if (infoGrid && !infoGrid.querySelector(`[data-purpose-id="${prompt.id}"]`)) {
      const card = document.createElement("div");
      card.className = "info";
      card.dataset.purposeId = prompt.id;
      card.innerHTML = `<span>${prompt.task === "Task 1" ? "写信目的" : "题目目的"}</span><strong>${escapeHtml(prompt.purpose)}</strong>`;
      infoGrid.appendChild(card);
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-id]");
    if (!button?.dataset?.id) return;
    lastSelectedId = button.dataset.id;
    window.setTimeout(decorate, 0);
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const schedule = () => window.requestAnimationFrame(decorate);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  });
})();
