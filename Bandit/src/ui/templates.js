// Curated Prompt Templates Library & Interactive Fill-in-the-Blanks Runner
// Designed for a dead-simple, beginner-friendly experience on Firefox and all browsers.

export const BUILTIN_TEMPLATES = [
  // --- WRITING (8) ---
  {
    id: 'writing-blog-intro',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: 'Catchy Blog Post Intro',
    description: 'Hook readers instantly with a compelling opening paragraph.',
    template: 'Write a compelling, magnetic blog post introduction about {{topic}} for {{audience}}. Hook the reader in the first sentence, establish why this matters right now, and set up the article with a {{tone}} tone.',
    variables: [
      { key: 'topic', label: 'Blog Topic', placeholder: 'e.g. Remote work productivity & avoiding burnout' },
      { key: 'audience', label: 'Target Audience', placeholder: 'e.g. Software engineers & startup teams' },
      { key: 'tone', label: 'Tone', placeholder: 'e.g. Relatable, energetic, and practical' }
    ],
    tags: ['blog', 'intro', 'hook', 'writing']
  },
  {
    id: 'writing-email-draft',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: 'Professional Business Email',
    description: 'Draft a polite, concise, and persuasive email for any situation.',
    template: 'Draft a professional, clear, and courteous email to {{recipient}} regarding {{purpose}}. Key points to mention: {{keyPoints}}. End with this clear call-to-action: {{callToAction}}.',
    variables: [
      { key: 'recipient', label: 'Recipient', placeholder: 'e.g. Prospective client or team manager' },
      { key: 'purpose', label: 'Purpose of Email', placeholder: 'e.g. Following up after yesterday demo meeting' },
      { key: 'keyPoints', label: 'Key Points to Cover', placeholder: 'e.g. Timeline proposal, pricing tier options' },
      { key: 'callToAction', label: 'Call to Action', placeholder: 'e.g. Confirm availability for a 15-min call on Thursday' }
    ],
    tags: ['email', 'business', 'communication', 'work']
  },
  {
    id: 'writing-product-desc',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: 'Product Description & Benefits',
    description: 'Turn feature bullet points into high-converting sales copy.',
    template: 'Write high-converting product copy for {{productName}}, designed for {{targetCustomer}}. Highlight these core features: {{keyFeatures}}. Focus heavily on customer benefits, emotional payoff, and overcoming objections.',
    variables: [
      { key: 'productName', label: 'Product Name', placeholder: 'e.g. UltraGrip Ergonomic Mouse' },
      { key: 'targetCustomer', label: 'Target Customer', placeholder: 'e.g. Designers working 8+ hours a day' },
      { key: 'keyFeatures', label: 'Key Features', placeholder: 'e.g. 57-degree natural angle, silent clicks, 70-day battery' }
    ],
    tags: ['marketing', 'sales', 'product', 'ecommerce']
  },
  {
    id: 'writing-social-post',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: 'Viral Social Media Post',
    description: 'Format high-engagement posts with hooks and hashtags.',
    template: 'Create an engaging {{platform}} post about {{topic}}. Include a bold opening hook line, bulleted insights on {{mainTakeaway}}, relevant hashtags, and an open-ended question to spark comments.',
    variables: [
      { key: 'platform', label: 'Platform', placeholder: 'e.g. LinkedIn, Twitter / X, or Threads' },
      { key: 'topic', label: 'Topic / Story', placeholder: 'e.g. Lessons learned from launching my first product' },
      { key: 'mainTakeaway', label: 'Main Takeaway', placeholder: 'e.g. Talk to 10 customers before writing any code' }
    ],
    tags: ['social', 'linkedin', 'twitter', 'content']
  },
  {
    id: 'writing-essay-outline',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: 'Comprehensive Essay Outline',
    description: 'Structure academic or opinion essays with clear arguments.',
    template: 'Generate a structured outline for an essay on "{{essayTopic}}". Central thesis: {{thesisIdea}}. Include: Introduction with hook & thesis statement, 3-4 body sections with evidence/sub-arguments, counter-argument & rebuttal, and a strong conclusion.',
    variables: [
      { key: 'essayTopic', label: 'Essay Topic', placeholder: 'e.g. The impact of AI on creative professions' },
      { key: 'thesisIdea', label: 'Thesis or Stance', placeholder: 'e.g. AI empowers artists as a tool rather than replacing them' }
    ],
    tags: ['essay', 'academic', 'outline', 'school']
  },
  {
    id: 'writing-headline-gen',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: '10 Catchy Headlines',
    description: 'Brainstorm irresistible titles for articles, videos, or newsletters.',
    template: 'Generate 10 compelling, click-worthy headlines for content about {{topic}}. Target audience: {{audience}}. Provide a mix of styles: how-to, question-based, listicle, contrarian, and benefit-driven.',
    variables: [
      { key: 'topic', label: 'Content Topic', placeholder: 'e.g. Mastering keyboard shortcuts in VS Code' },
      { key: 'audience', label: 'Target Audience', placeholder: 'e.g. Junior web developers' }
    ],
    tags: ['headlines', 'titles', 'clickbait', 'marketing']
  },
  {
    id: 'writing-story-hook',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: 'Fiction Story Opening Scene',
    description: 'Set up an evocative scene with sensory details and tension.',
    template: 'Write the opening scene for a {{genre}} story featuring {{protagonist}}. The scene begins right as {{incitingIncident}} occurs. Use vivid sensory details, establish atmospheric tension, and avoid exposition dumps.',
    variables: [
      { key: 'genre', label: 'Genre', placeholder: 'e.g. Cyberpunk mystery, Dark fantasy, Sci-fi thriller' },
      { key: 'protagonist', label: 'Protagonist', placeholder: 'e.g. An insomniac air-traffic controller' },
      { key: 'incitingIncident', label: 'Inciting Incident', placeholder: 'e.g. An unidentified beacon signals from the abandoned station' }
    ],
    tags: ['story', 'fiction', 'creative', 'novel']
  },
  {
    id: 'writing-tech-docs',
    category: 'writing',
    categoryLabel: '✍️ Writing',
    name: 'Technical Documentation Guide',
    description: 'Write developer documentation with setup steps and examples.',
    template: 'Write developer documentation for {{featureName}}. Outline prerequisites, a step-by-step setup walkthrough for {{targetEnvironment}}, copy-pasteable code examples, and common troubleshooting tips.',
    variables: [
      { key: 'featureName', label: 'Feature / Library', placeholder: 'e.g. User Authentication with JWT in Node.js' },
      { key: 'targetEnvironment', label: 'Environment / Stack', placeholder: 'e.g. Express.js and PostgreSQL' }
    ],
    tags: ['docs', 'developer', 'technical', 'guide']
  },

  // --- CODING (7) ---
  {
    id: 'code-review',
    category: 'coding',
    categoryLabel: '💻 Coding',
    name: 'Code Review & Security Audit',
    description: 'Identify bugs, performance bottlenecks, and security flaws.',
    template: 'Perform a senior-level code review for this {{language}} code:\n\n```\n{{codeSnippet}}\n```\n\nAnalyze for: 1) Logic bugs and edge cases, 2) Security vulnerabilities, 3) Performance and memory leaks, 4) Clean code & idiomatic style. Provide concrete code diffs for all suggested fixes.',
    variables: [
      { key: 'language', label: 'Programming Language', placeholder: 'e.g. TypeScript, Python, Go' },
      { key: 'codeSnippet', label: 'Code to Review', placeholder: 'Paste your code here...' }
    ],
    tags: ['code', 'review', 'security', 'audit']
  },
  {
    id: 'code-refactor',
    category: 'coding',
    categoryLabel: '💻 Coding',
    name: 'Refactor & Clean Architecture',
    description: 'Modernize messy or legacy code for readability and DRY principles.',
    template: 'Refactor this {{language}} code to adhere to clean code principles, DRY architecture, and modern best practices:\n\n```\n{{codeSnippet}}\n```\n\nExplain what you simplified and why.',
    variables: [
      { key: 'language', label: 'Language', placeholder: 'e.g. JavaScript / React' },
      { key: 'codeSnippet', label: 'Code Snippet', placeholder: 'Paste code to refactor...' }
    ],
    tags: ['refactor', 'clean-code', 'dry']
  },
  {
    id: 'code-debug',
    category: 'coding',
    categoryLabel: '💻 Coding',
    name: 'Bug Diagnoser & Fixer',
    description: 'Find why an error is occurring and get an instant fix.',
    template: 'I am getting this error in {{language}}:\n\nError Message:\n{{errorMessage}}\n\nRelevant Code:\n```\n{{codeSnippet}}\n```\n\nExplain the exact root cause of the bug and show the corrected code.',
    variables: [
      { key: 'language', label: 'Language / Framework', placeholder: 'e.g. Next.js / Python' },
      { key: 'errorMessage', label: 'Error Message', placeholder: 'e.g. TypeError: Cannot read properties of undefined' },
      { key: 'codeSnippet', label: 'Code Snippet', placeholder: 'Paste the broken code...' }
    ],
    tags: ['debug', 'bug', 'error', 'fix']
  },
  {
    id: 'code-explain',
    category: 'coding',
    categoryLabel: '💻 Coding',
    name: 'Explain Code (ELI5)',
    description: 'Break down complex algorithms or regex into plain English.',
    template: 'Explain how this {{language}} code works step-by-step in plain, beginner-friendly English. Use simple analogies where helpful:\n\n```\n{{codeSnippet}}\n```',
    variables: [
      { key: 'language', label: 'Language / Tool', placeholder: 'e.g. SQL, Regex, Rust' },
      { key: 'codeSnippet', label: 'Code to Explain', placeholder: 'Paste complex code here...' }
    ],
    tags: ['explain', 'learn', 'beginner']
  },
  {
    id: 'code-unit-tests',
    category: 'coding',
    categoryLabel: '💻 Coding',
    name: 'Write Unit Tests (TDD)',
    description: 'Generate unit tests covering happy paths, edge cases, and errors.',
    template: 'Write comprehensive unit tests using {{testFramework}} for this {{language}} function/component:\n\n```\n{{codeSnippet}}\n```\n\nCover standard happy paths, edge cases (empty, null, overflow), and expected error throws.',
    variables: [
      { key: 'testFramework', label: 'Testing Framework', placeholder: 'e.g. Jest, Vitest, PyTest' },
      { key: 'language', label: 'Language', placeholder: 'e.g. TypeScript' },
      { key: 'codeSnippet', label: 'Function to Test', placeholder: 'Paste function code...' }
    ],
    tags: ['tests', 'tdd', 'jest', 'unit-test']
  },
  {
    id: 'code-api-design',
    category: 'coding',
    categoryLabel: '💻 Coding',
    name: 'REST / GraphQL API Spec',
    description: 'Design production-grade API endpoints with schemas and errors.',
    template: 'Design a clean, RESTful API contract for managing {{resourceName}}. Include: 1) Endpoints (GET, POST, PUT, DELETE), 2) Request payloads with validation rules, 3) Response JSON schemas with status codes, 4) Standard error response format.',
    variables: [
      { key: 'resourceName', label: 'Resource / Domain', placeholder: 'e.g. User subscription billing and invoices' }
    ],
    tags: ['api', 'rest', 'backend', 'schema']
  },
  {
    id: 'code-regex-helper',
    category: 'coding',
    categoryLabel: '💻 Coding',
    name: 'Regex Generator & Explainer',
    description: 'Create bulletproof regular expressions with breakdown.',
    template: 'Create a regular expression in {{flavor}} that matches: {{patternRequirement}}.\nProvide: 1) The exact regex string, 2) Test cases that should match, 3) Test cases that should fail, 4) A breakdown of every token.',
    variables: [
      { key: 'flavor', label: 'Regex Flavor', placeholder: 'e.g. JavaScript, Python, PCRE' },
      { key: 'patternRequirement', label: 'What to Match', placeholder: 'e.g. Valid international phone numbers with optional country codes' }
    ],
    tags: ['regex', 'pattern', 'parsing']
  },

  // --- BUSINESS (6) ---
  {
    id: 'biz-meeting-agenda',
    category: 'business',
    categoryLabel: '💼 Business',
    name: 'Productive Meeting Agenda',
    description: 'Structure meetings with goals, time blocks, and owners.',
    template: 'Create a focused, productive meeting agenda for a {{meetingDuration}} meeting about "{{meetingTopic}}". Attendees: {{attendees}}. Goal: {{desiredOutcome}}. Include time allocations for each topic and an action item assignment section.',
    variables: [
      { key: 'meetingTopic', label: 'Meeting Topic', placeholder: 'e.g. Q3 Product Roadmap & Prioritization' },
      { key: 'meetingDuration', label: 'Duration', placeholder: 'e.g. 45 minutes' },
      { key: 'attendees', label: 'Attendees / Teams', placeholder: 'e.g. Product, Engineering, and Design leads' },
      { key: 'desiredOutcome', label: 'Desired Outcome', placeholder: 'e.g. Agreement on top 3 features to build next sprint' }
    ],
    tags: ['meeting', 'agenda', 'work', 'productivity']
  },
  {
    id: 'biz-proposal',
    category: 'business',
    categoryLabel: '💼 Business',
    name: 'Project Proposal Spec',
    description: 'Pitch initiatives with problem statement, timeline, and ROI.',
    template: 'Write a persuasive project proposal for "{{projectName}}".\nProblem statement: {{problemSolved}}.\nProposed solution: {{solutionOverview}}.\nExpected impact/ROI: {{expectedOutcome}}.\nInclude: Executive Summary, Objectives, Implementation Phases, Resource Estimates, and Success Metrics.',
    variables: [
      { key: 'projectName', label: 'Project Name', placeholder: 'e.g. Customer Support AI Assistant' },
      { key: 'problemSolved', label: 'Problem Being Solved', placeholder: 'e.g. Ticket response times currently average 14 hours' },
      { key: 'solutionOverview', label: 'Solution Overview', placeholder: 'e.g. Automated tiered triage bot answering top 40 FAQs' },
      { key: 'expectedOutcome', label: 'Expected Impact', placeholder: 'e.g. 60% reduction in response time, saving $40k/yr' }
    ],
    tags: ['proposal', 'project', 'pitch', 'executive']
  },
  {
    id: 'biz-swot',
    category: 'business',
    categoryLabel: '💼 Business',
    name: 'SWOT Analysis Matrix',
    description: 'Detailed Strengths, Weaknesses, Opportunities, and Threats.',
    template: 'Perform an in-depth SWOT analysis for {{businessOrProduct}} in the {{industry}} space. Competitors include {{competitors}}. Break down: Strengths, Weaknesses, Opportunities, and Threats with 4-5 strategic bullet points each, concluding with actionable recommendations.',
    variables: [
      { key: 'businessOrProduct', label: 'Company / Product', placeholder: 'e.g. Boutique specialty coffee subscription' },
      { key: 'industry', label: 'Industry', placeholder: 'e.g. Direct-to-Consumer Food & Beverage' },
      { key: 'competitors', label: 'Competitors', placeholder: 'e.g. Trade Coffee, Blue Bottle' }
    ],
    tags: ['swot', 'strategy', 'analysis', 'business']
  },
  {
    id: 'biz-customer-persona',
    category: 'business',
    categoryLabel: '💼 Business',
    name: 'Ideal Customer Persona (ICP)',
    description: 'Map demographics, pain points, motivations, and triggers.',
    template: 'Develop a detailed Ideal Customer Persona for {{productOrService}}. Target demographic: {{targetAudience}}. Include: Profile overview, daily frustrations & pain points, core aspirations, objections to purchasing, and marketing channels they trust.',
    variables: [
      { key: 'productOrService', label: 'Product / Service', placeholder: 'e.g. All-in-one personal budgeting app' },
      { key: 'targetAudience', label: 'Target Demographic', placeholder: 'e.g. Young professionals in their 20s managing student debt' }
    ],
    tags: ['persona', 'icp', 'marketing', 'customer']
  },
  {
    id: 'biz-elevator-pitch',
    category: 'business',
    categoryLabel: '💼 Business',
    name: '60-Second Elevator Pitch',
    description: 'Memorable, crisp pitch for investors, customers, or partners.',
    template: 'Write a sharp, memorable 60-second elevator pitch for {{companyName}}. Problem: {{problemStatement}}. Unique Solution: {{solutionStatement}}. Why now: {{whyNow}}. Make it conversational, punchy, and impossible to forget.',
    variables: [
      { key: 'companyName', label: 'Company / Project', placeholder: 'e.g. FlowState Audio' },
      { key: 'problemStatement', label: 'The Problem', placeholder: 'e.g. 70% of open office workers struggle with noise distractions' },
      { key: 'solutionStatement', label: 'Unique Solution', placeholder: 'e.g. Science-backed generative soundscapes tailored to heart rate' },
      { key: 'whyNow', label: 'Why Now?', placeholder: 'e.g. Hybrid work makes focus tools more critical than ever' }
    ],
    tags: ['pitch', 'investor', 'startup', 'sales']
  },
  {
    id: 'biz-okrs',
    category: 'business',
    categoryLabel: '💼 Business',
    name: 'Quarterly OKR Framework',
    description: 'Formulate inspirational Objectives and measurable Key Results.',
    template: 'Draft 3 strategic Objectives and 3-4 measurable Key Results (OKRs) for a {{teamName}} team for {{timeframe}}. Core focus: {{coreFocus}}. Ensure each KR has clear baseline metrics and numerical targets.',
    variables: [
      { key: 'teamName', label: 'Team / Department', placeholder: 'e.g. Growth Marketing or Platform Engineering' },
      { key: 'timeframe', label: 'Timeframe', placeholder: 'e.g. Q4 2026' },
      { key: 'coreFocus', label: 'Main Strategic Focus', placeholder: 'e.g. Accelerate user activation and reduce day-7 churn' }
    ],
    tags: ['okr', 'goals', 'management', 'planning']
  },

  // --- CREATIVE (5) ---
  {
    id: 'creative-character',
    category: 'creative',
    categoryLabel: '🎨 Creative',
    name: 'Character Dossier & Flaws',
    description: 'Deep character profile with core desire, fatal flaw, and voice.',
    template: 'Create a deep, three-dimensional character profile for a story in the {{genre}} genre. Name: {{characterName}}. Role: {{characterRole}}. Include: Fatal flaw, secret desire, physical tell or quirk, defining backstory event, and how their speech pattern sounds.',
    variables: [
      { key: 'characterName', label: 'Character Name', placeholder: 'e.g. Silas Vance' },
      { key: 'characterRole', label: 'Role in Story', placeholder: 'e.g. Disgraced starship captain turned smuggler' },
      { key: 'genre', label: 'Genre', placeholder: 'e.g. Gritty space western' }
    ],
    tags: ['character', 'creative', 'writing', 'fiction']
  },
  {
    id: 'creative-worldbuilding',
    category: 'creative',
    categoryLabel: '🎨 Creative',
    name: 'Fictional World Building',
    description: 'Design unique magic systems, geography, factions, and rules.',
    template: 'Flesh out a unique fictional setting named {{worldName}} for a {{genre}} setting. The defining central phenomenon is: {{centralFeature}}. Detail: 1) Physical geography & weather, 2) Social hierarchy & dominant factions, 3) Daily life for ordinary people, 4) Taboos and sacred customs.',
    variables: [
      { key: 'worldName', label: 'World / City Name', placeholder: 'e.g. The Sunken Spire of Aethelgard' },
      { key: 'genre', label: 'Genre', placeholder: 'e.g. Steampunk fantasy' },
      { key: 'centralFeature', label: 'Unique Central Feature', placeholder: 'e.g. Sunlight only falls for three hours each week' }
    ],
    tags: ['worldbuilding', 'fantasy', 'scifi', 'lore']
  },
  {
    id: 'creative-dialogue',
    category: 'creative',
    categoryLabel: '🎨 Creative',
    name: 'Tense Dialogue Scene',
    description: 'Write authentic dialogue between two characters with subtext.',
    template: 'Write a gripping dialogue scene between {{characterA}} and {{characterB}}. Setting: {{setting}}. Hidden conflict: {{hiddenConflict}}. Focus on subtext — neither character should say what they truly mean out loud.',
    variables: [
      { key: 'characterA', label: 'Character A', placeholder: 'e.g. A veteran detective' },
      { key: 'characterB', label: 'Character B', placeholder: 'e.g. A politician who owes them a favor' },
      { key: 'setting', label: 'Setting', placeholder: 'e.g. An empty diner at 2 AM in the pouring rain' },
      { key: 'hiddenConflict', label: 'Subtext / Conflict', placeholder: 'e.g. Character A knows Character B leaked the evidence' }
    ],
    tags: ['dialogue', 'script', 'scene', 'drama']
  },
  {
    id: 'creative-poem',
    category: 'creative',
    categoryLabel: '🎨 Creative',
    name: 'Custom Form Poetry',
    description: 'Evocative poetry with rich rhythm, imagery, and mood.',
    template: 'Write a poem about {{topic}} in the style of {{styleOrForm}}. Mood: {{mood}}. Use striking sensory metaphors, subtle internal rhyme, and an impactful closing line.',
    variables: [
      { key: 'topic', label: 'Poem Theme / Subject', placeholder: 'e.g. Watching fog roll over the city at dawn' },
      { key: 'styleOrForm', label: 'Style / Form', placeholder: 'e.g. Free verse, Sonnet, Haiku sequence' },
      { key: 'mood', label: 'Mood', placeholder: 'e.g. Melancholic yet serene' }
    ],
    tags: ['poetry', 'poem', 'creative', 'art']
  },
  {
    id: 'creative-lyrics',
    category: 'creative',
    categoryLabel: '🎨 Creative',
    name: 'Song Lyrics & Hook',
    description: 'Verses, chorus, and bridge with rhythm and emotional beat.',
    template: 'Write song lyrics for a {{genre}} song titled "{{songTitle}}". Theme: {{theme}}. Structure: Verse 1, Pre-Chorus, Hook/Chorus, Verse 2, Chorus, Emotional Bridge, and Outro. Include chord progression cues if applicable.',
    variables: [
      { key: 'songTitle', label: 'Song Title', placeholder: 'e.g. Neon Shadows' },
      { key: 'genre', label: 'Music Genre', placeholder: 'e.g. Indie synth-pop, Folk acoustic' },
      { key: 'theme', label: 'Theme / Story', placeholder: 'e.g. Leaving a small town late at night with nothing to lose' }
    ],
    tags: ['music', 'lyrics', 'song', 'audio']
  },

  // --- LEARNING (4) ---
  {
    id: 'learn-study-guide',
    category: 'learning',
    categoryLabel: '🎓 Learning',
    name: 'Comprehensive Study Guide',
    description: 'Summaries, key formulas, mnemonics, and test questions.',
    template: 'Create a comprehensive study guide for {{subjectOrTopic}} at the {{academicLevel}} level. Format into: 1) Core Principles (summarized in 2 sentences each), 2) Key Terminology & Definitions, 3) Common Pitfalls / Mistakes to Avoid, 4) 5 Rapid-Fire Practice Questions with Answers.',
    variables: [
      { key: 'subjectOrTopic', label: 'Subject / Topic', placeholder: 'e.g. Photosynthesis and Cellular Respiration' },
      { key: 'academicLevel', label: 'Level', placeholder: 'e.g. High School AP Biology or Intro College' }
    ],
    tags: ['study', 'guide', 'school', 'exam']
  },
  {
    id: 'learn-eli5',
    category: 'learning',
    categoryLabel: '🎓 Learning',
    name: 'Explain Like I’m 5 (ELI5)',
    description: 'Make complex topics crystal clear using fun analogies.',
    template: 'Explain the concept of "{{concept}}" to someone with zero technical background, as if explaining to a curious 10-year-old. Use a fun, everyday analogy (like cooking, Legos, or sports) to illustrate how it works. Avoid any jargon.',
    variables: [
      { key: 'concept', label: 'Concept to Explain', placeholder: 'e.g. Quantum Computing, Blockchain, or Inflation' }
    ],
    tags: ['eli5', 'explain', 'simple', 'analogy']
  },
  {
    id: 'learn-flashcards',
    category: 'learning',
    categoryLabel: '🎓 Learning',
    name: '10 Flashcard Q&A Pairs',
    description: 'Active recall question-and-answer pairs for studying.',
    template: 'Generate 10 high-impact study flashcards on {{topic}}. Target difficulty: {{difficulty}}. Format each flashcard clearly as:\nFront: [Challenging Question or Prompt]\nBack: [Concise, accurate answer with key takeaway]',
    variables: [
      { key: 'topic', label: 'Study Topic', placeholder: 'e.g. French Revolution Key Events & Causes' },
      { key: 'difficulty', label: 'Difficulty', placeholder: 'e.g. Intermediate / College Prep' }
    ],
    tags: ['flashcards', 'memorize', 'anki', 'quiz']
  },
  {
    id: 'learn-quiz-gen',
    category: 'learning',
    categoryLabel: '🎓 Learning',
    name: 'Practice Quiz with Explanations',
    description: 'Multiple-choice test with detailed reasoning for each answer.',
    template: 'Create a {{numQuestions}}-question practice quiz testing understanding of {{topic}}. Include a mix of conceptual and application questions. For each question, provide 4 options (A, B, C, D), and at the very end, include the Answer Key with a 1-sentence explanation of why the correct answer is right.',
    variables: [
      { key: 'topic', label: 'Quiz Topic', placeholder: 'e.g. Python Data Structures (Lists vs Dicts vs Sets)' },
      { key: 'numQuestions', label: 'Number of Questions', placeholder: 'e.g. 5' }
    ],
    tags: ['quiz', 'test', 'practice', 'learning']
  }
];

export const CATEGORIES = [
  { id: 'all', label: '🌟 All' },
  { id: 'writing', label: '✍️ Writing' },
  { id: 'coding', label: '💻 Coding' },
  { id: 'business', label: '💼 Business' },
  { id: 'creative', label: '🎨 Creative' },
  { id: 'learning', label: '🎓 Learning' },
  { id: 'custom', label: '⭐ My Templates' }
];

export function substituteTemplate(templateStr, values = {}, variables = []) {
  return templateStr.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
    if (values[key] !== undefined && values[key].trim() !== '') {
      return values[key].trim();
    }
    if (Array.isArray(variables)) {
      const v = variables.find(item => item.key === key);
      if (v && v.placeholder) {
        const clean = v.placeholder.replace(/^e\.g\.\s*/i, '').trim();
        if (clean) return clean;
      }
    }
    return match;
  });
}

export function extractVariables(templateStr) {
  const matches = templateStr.match(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g) || [];
  const vars = [];
  const seen = new Set();
  for (const m of matches) {
    const key = m.replace(/\{\{\s*|\s*\}\}/g, '');
    if (!seen.has(key)) {
      seen.add(key);
      vars.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1), placeholder: `Enter ${key}...` });
    }
  }
  return vars;
}

export function showTemplatesModal({ openRockyModal, stateObj, persist, onApply, copyToClipboard, showToast }) {
  const { modal, close } = openRockyModal();
  modal.classList.add('templates-modal');

  let activeCategory = 'all';
  let searchQuery = '';
  let selectedTemplate = null;
  let customTemplates = stateObj.customTemplates || [];

  function getCombinedTemplates() {
    const customs = customTemplates.map(t => ({
      ...t,
      isCustom: true,
      categoryLabel: '⭐ My Template',
      variables: t.variables || extractVariables(t.template || '')
    }));
    return [...BUILTIN_TEMPLATES, ...customs];
  }

  function renderHeader() {
    const head = document.createElement('div');
    head.className = 'templates-header';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0;font-size:16px;display:flex;align-items:center;gap:8px;';
    title.textContent = '🧩 Prompt Templates';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'templates-close-btn';
    closeBtn.style.cssText = 'background:none;border:none;color:var(--dim);font-size:18px;cursor:pointer;padding:4px 8px;';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);

    topRow.appendChild(title);
    topRow.appendChild(closeBtn);

    const desc = document.createElement('p');
    desc.style.cssText = 'margin:0 0 12px 0;font-size:12px;color:var(--dim);line-height:1.4;';
    desc.textContent = 'Pick a starting prompt, fill in the blanks, and let Bandit enhance it into a masterpiece!';

    head.appendChild(topRow);
    head.appendChild(desc);
    return head;
  }

  function renderView() {
    modal.replaceChildren();
    modal.appendChild(renderHeader());

    if (selectedTemplate) {
      renderRunner(selectedTemplate);
    } else {
      renderBrowser();
    }
  }

  function renderBrowser() {
    // 1. Search Bar
    const searchWrap = document.createElement('div');
    searchWrap.className = 'template-search-wrap';
    searchWrap.style.cssText = 'position:relative;margin-bottom:12px;';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 Search templates (e.g. blog, code, email, essay)...';
    searchInput.value = searchQuery;
    searchInput.className = 'template-search-input';
    searchInput.style.cssText = 'width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:8px;font-family:var(--font-mono);font-size:12px;outline:none;';
    
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderCardsList();
    });
    searchWrap.appendChild(searchInput);
    modal.appendChild(searchWrap);

    // 2. Category Tabs
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'template-tabs-container';
    tabsContainer.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;scrollbar-width:none;';

    const allList = getCombinedTemplates();

    CATEGORIES.forEach(cat => {
      const count = cat.id === 'all' 
        ? allList.length 
        : (cat.id === 'custom' ? customTemplates.length : allList.filter(t => t.category === cat.id).length);

      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = `tab-pill ${activeCategory === cat.id ? 'active' : ''}`;
      tabBtn.style.cssText = `white-space:nowrap;font-size:11px;padding:5px 10px;border-radius:20px;border:1px solid ${activeCategory === cat.id ? 'var(--amber)' : 'var(--line)'};background:${activeCategory === cat.id ? 'rgba(245,165,36,0.15)' : 'var(--panel-2)'};color:${activeCategory === cat.id ? 'var(--amber)' : 'var(--text)'};cursor:pointer;font-family:var(--font-mono);transition:all .15s;`;
      tabBtn.textContent = `${cat.label} (${count})`;

      tabBtn.addEventListener('click', () => {
        activeCategory = cat.id;
        renderView();
      });
      tabsContainer.appendChild(tabBtn);
    });
    modal.appendChild(tabsContainer);

    // 3. Custom Template Add Button (if on custom tab)
    if (activeCategory === 'custom') {
      const addCustomBtn = document.createElement('button');
      addCustomBtn.type = 'button';
      addCustomBtn.className = 'secondary';
      addCustomBtn.style.cssText = 'margin-bottom:12px;width:100%;font-size:12px;padding:8px;border:1px dashed var(--amber);color:var(--amber);background:rgba(245,165,36,0.08);';
      addCustomBtn.textContent = '+ Create New Custom Template';
      addCustomBtn.addEventListener('click', () => renderCustomCreator());
      modal.appendChild(addCustomBtn);
    }

    // 4. Templates Cards Grid Container
    const grid = document.createElement('div');
    grid.className = 'templates-grid';
    grid.id = 'templatesGrid';
    grid.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto;padding-right:4px;';
    modal.appendChild(grid);

    renderCardsList();
  }

  function renderCardsList() {
    const grid = modal.querySelector('#templatesGrid');
    if (!grid) return;
    grid.replaceChildren();

    const all = getCombinedTemplates();
    const filtered = all.filter(t => {
      const matchesCat = activeCategory === 'all' 
        ? true 
        : (activeCategory === 'custom' ? t.isCustom : t.category === activeCategory);
      if (!matchesCat) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const inName = (t.name || '').toLowerCase().includes(q);
      const inDesc = (t.description || '').toLowerCase().includes(q);
      const inTags = (t.tags || []).some(tag => tag.toLowerCase().includes(q));
      return inName || inDesc || inTags;
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:32px 16px;color:var(--dim);font-size:12px;line-height:1.6;';

      const line1 = document.createElement('div');
      line1.appendChild(document.createTextNode('No templates found matching "'));
      const boldQuery = document.createElement('b');
      boldQuery.textContent = searchQuery;
      line1.appendChild(boldQuery);
      line1.appendChild(document.createTextNode('".'));

      const line2 = document.createElement('div');
      line2.style.cssText = 'color:var(--dim);font-size:11px;margin-top:4px;';
      line2.textContent = 'Try searching something else or create a custom one!';

      empty.appendChild(line1);
      empty.appendChild(line2);
      grid.appendChild(empty);
      return;
    }

    filtered.forEach(t => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.style.cssText = 'background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px;cursor:pointer;transition:border-color .15s, transform .15s;text-align:left;';
      
      card.addEventListener('mouseenter', () => {
        card.style.borderColor = 'var(--amber)';
        card.style.transform = 'translateY(-1px)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = 'var(--line)';
        card.style.transform = 'none';
      });

      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
      
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--amber);background:rgba(245,165,36,0.12);padding:2px 6px;border-radius:4px;';
      badge.textContent = t.categoryLabel || t.category;
      topRow.appendChild(badge);

      if (t.isCustom) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '🗑';
        delBtn.title = 'Delete custom template';
        delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;opacity:0.6;padding:2px;';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          customTemplates = customTemplates.filter(ct => ct.id !== t.id);
          stateObj.customTemplates = customTemplates;
          persist({ customTemplates }, { immediate: true });
          showToast('Template deleted');
          renderView();
        });
        topRow.appendChild(delBtn);
      }

      const title = document.createElement('b');
      title.style.cssText = 'font-size:13px;color:var(--text);';
      title.textContent = t.name;

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:11px;color:var(--dim);line-height:1.4;';
      desc.textContent = t.description;

      const bottomRow = document.createElement('div');
      bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:4px;gap:8px;';

      const varCount = (t.variables && t.variables.length) || 0;
      const varInfo = document.createElement('span');
      varInfo.style.cssText = 'font-size:10px;color:#7e8b9b;white-space:nowrap;';
      varInfo.textContent = varCount > 0 ? `⚡ ${varCount} blanks` : `⚡ Ready`;

      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex;gap:6px;align-items:center;';

      const quickBtn = document.createElement('button');
      quickBtn.type = 'button';
      quickBtn.className = 'secondary';
      quickBtn.style.cssText = 'font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid var(--amber);color:var(--amber);background:rgba(245,165,36,0.1);font-weight:bold;cursor:pointer;white-space:nowrap;';
      quickBtn.textContent = '🚀 Quick Use';
      quickBtn.title = 'Instantly insert this prompt into chat with smart examples';
      quickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        const prompt = substituteTemplate(t.template, {}, t.variables);
        if (onApply) onApply(prompt, { enhance: false });
      });

      const customizeBtn = document.createElement('button');
      customizeBtn.type = 'button';
      customizeBtn.className = 'secondary';
      customizeBtn.style.cssText = 'font-size:10px;padding:3px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;';
      customizeBtn.textContent = '✏️ Edit ➜';
      customizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedTemplate = t;
        renderView();
      });

      btnGroup.appendChild(quickBtn);
      btnGroup.appendChild(customizeBtn);

      bottomRow.appendChild(varInfo);
      bottomRow.appendChild(btnGroup);

      card.appendChild(topRow);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(bottomRow);

      card.addEventListener('click', () => {
        selectedTemplate = t;
        renderView();
      });

      grid.appendChild(card);
    });
  }

  function renderRunner(t) {
    const runner = document.createElement('div');
    runner.className = 'template-runner';
    runner.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    // Top Navigation
    const navBar = document.createElement('div');
    navBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'secondary';
    backBtn.style.cssText = 'font-size:11px;padding:4px 8px;cursor:pointer;';
    backBtn.textContent = '← Back to Templates';
    backBtn.addEventListener('click', () => {
      selectedTemplate = null;
      renderView();
    });

    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:10px;color:var(--amber);background:rgba(245,165,36,0.12);padding:2px 8px;border-radius:12px;font-weight:bold;';
    badge.textContent = t.categoryLabel || t.category;

    navBar.appendChild(backBtn);
    navBar.appendChild(badge);
    runner.appendChild(navBar);

    // Template Info Box
    const info = document.createElement('div');
    info.style.cssText = 'background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px;text-align:left;';

    const infoTitle = document.createElement('div');
    infoTitle.style.cssText = 'font-size:13px;font-weight:bold;color:var(--text);margin-bottom:2px;';
    infoTitle.textContent = t.name;

    const infoDesc = document.createElement('div');
    infoDesc.style.cssText = 'font-size:11px;color:var(--dim);';
    infoDesc.textContent = t.description;

    info.appendChild(infoTitle);
    info.appendChild(infoDesc);
    runner.appendChild(info);

    // Variables Form & Pre-fill setup
    const vars = t.variables || [];
    const values = {};
    const inputElements = {};

    // Default values start empty so inputs show placeholders and users can type immediately
    vars.forEach(v => {
      values[v.key] = '';
    });

    if (vars.length > 0) {
      const formHeader = document.createElement('div');
      formHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

      const formTitle = document.createElement('span');
      formTitle.style.cssText = 'font-size:11px;font-weight:bold;color:var(--text);';
      formTitle.textContent = 'Customize Blanks:';

      const toolGroup = document.createElement('div');
      toolGroup.style.cssText = 'display:flex;gap:6px;';

      const fillExampleBtn = document.createElement('button');
      fillExampleBtn.type = 'button';
      fillExampleBtn.className = 'secondary';
      fillExampleBtn.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--amber);color:var(--amber);cursor:pointer;background:rgba(245,165,36,0.08);';
      fillExampleBtn.textContent = '✨ Fill Examples';
      fillExampleBtn.title = 'Pre-fill with example values';
      fillExampleBtn.addEventListener('click', () => {
        vars.forEach(v => {
          if (v.placeholder) {
            const clean = v.placeholder.replace(/^e\.g\.\s*/i, '').trim();
            values[v.key] = clean;
            if (inputElements[v.key]) inputElements[v.key].value = clean;
          }
        });
        updatePreview();
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'secondary';
      clearBtn.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:4px;cursor:pointer;';
      clearBtn.textContent = '🧹 Clear';
      clearBtn.title = 'Clear all fields to type your own';
      clearBtn.addEventListener('click', () => {
        vars.forEach(v => {
          values[v.key] = '';
          if (inputElements[v.key]) inputElements[v.key].value = '';
        });
        updatePreview();
      });

      toolGroup.appendChild(fillExampleBtn);
      toolGroup.appendChild(clearBtn);
      formHeader.appendChild(formTitle);
      formHeader.appendChild(toolGroup);
      runner.appendChild(formHeader);

      const form = document.createElement('div');
      form.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:26vh;overflow-y:auto;padding-right:4px;';

      vars.forEach((v, idx) => {
        const group = document.createElement('div');
        group.style.cssText = 'display:flex;flex-direction:column;gap:4px;text-align:left;';

        const label = document.createElement('label');
        label.style.cssText = 'font-size:11px;font-weight:bold;color:var(--text);display:flex;justify-content:space-between;';

        const labelTitle = document.createElement('span');
        labelTitle.textContent = v.label || v.key;

        const labelHint = document.createElement('span');
        labelHint.style.cssText = 'font-size:10px;color:var(--dim);font-weight:normal;';
        labelHint.textContent = v.placeholder ? (v.placeholder.length > 30 ? v.placeholder.slice(0, 30) + '…' : v.placeholder) : '';

        label.appendChild(labelTitle);
        label.appendChild(labelHint);

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = v.placeholder || `Enter ${v.key}...`;
        input.value = values[v.key] || '';
        input.style.cssText = 'background:var(--bg);border:1px solid var(--line);color:var(--text);padding:7px 10px;border-radius:6px;font-family:var(--font-mono);font-size:12px;outline:none;';
        
        input.addEventListener('input', (e) => {
          values[v.key] = e.target.value;
          updatePreview();
        });

        inputElements[v.key] = input;
        group.appendChild(label);
        group.appendChild(input);
        form.appendChild(group);

        // Auto-focus first input for convenience
        if (idx === 0) {
          setTimeout(() => input.focus(), 100);
        }
      });
      runner.appendChild(form);
    }

    // Live Preview Box
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'text-align:left;';
    
    const previewLabel = document.createElement('div');
    previewLabel.style.cssText = 'font-size:10px;text-transform:uppercase;color:var(--dim);letter-spacing:0.5px;margin-bottom:4px;display:flex;justify-content:space-between;';

    const previewTitle = document.createElement('span');
    previewTitle.textContent = 'Live Prompt Preview';

    const previewBadge = document.createElement('span');
    previewBadge.style.color = 'var(--amber)';
    previewBadge.textContent = 'ready to insert';

    previewLabel.appendChild(previewTitle);
    previewLabel.appendChild(previewBadge);

    const previewBox = document.createElement('div');
    previewBox.id = 'templateLivePreview';
    previewBox.style.cssText = 'background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:11.5px;font-family:var(--font-mono);line-height:1.5;color:var(--text);max-height:16vh;overflow-y:auto;white-space:pre-wrap;';

    function getFinalText() {
      return substituteTemplate(t.template, values, t.variables);
    }

    function updatePreview() {
      if (previewBox) {
        previewBox.textContent = getFinalText();
      }
    }

    previewWrap.appendChild(previewLabel);
    previewWrap.appendChild(previewBox);
    runner.appendChild(previewWrap);
    updatePreview();

    // Action Buttons
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px;';

    const primaryBtn = document.createElement('button');
    primaryBtn.type = 'button';
    primaryBtn.style.cssText = 'background:var(--amber);color:#000;border:none;border-radius:8px;padding:10px;font-weight:bold;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;';
    primaryBtn.textContent = '🚀 Insert into Chat';
    primaryBtn.addEventListener('click', () => {
      const prompt = getFinalText();
      close();
      if (onApply) onApply(prompt, { enhance: false });
    });

    const subActions = document.createElement('div');
    subActions.style.cssText = 'display:flex;gap:8px;';

    const enhanceBtn = document.createElement('button');
    enhanceBtn.type = 'button';
    enhanceBtn.className = 'secondary';
    enhanceBtn.style.cssText = 'flex:1;font-size:11px;padding:8px;font-weight:bold;color:var(--amber);border:1px solid var(--amber);cursor:pointer;background:rgba(245,165,36,0.08);';
    enhanceBtn.textContent = '✨ Insert & Enhance';
    enhanceBtn.title = 'Insert into chat and immediately run AI prompt enhancement';
    enhanceBtn.addEventListener('click', () => {
      const prompt = getFinalText();
      close();
      if (onApply) onApply(prompt, { enhance: true });
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary';
    copyBtn.style.cssText = 'flex:1;font-size:11px;padding:8px;cursor:pointer;';
    copyBtn.textContent = '📋 Copy Prompt';
    copyBtn.addEventListener('click', () => {
      const prompt = getFinalText();
      copyToClipboard(prompt)
        .then(() => showToast('Template copied 📋'))
        .catch(() => showToast('Could not copy'));
    });

    subActions.appendChild(enhanceBtn);
    subActions.appendChild(copyBtn);
    actions.appendChild(primaryBtn);
    actions.appendChild(subActions);
    runner.appendChild(actions);

    modal.appendChild(runner);
  }

  function renderCustomCreator() {
    modal.replaceChildren();
    modal.appendChild(renderHeader());

    const form = document.createElement('div');
    form.style.cssText = 'display:flex;flex-direction:column;gap:10px;text-align:left;';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'secondary';
    backBtn.style.cssText = 'align-self:flex-start;font-size:11px;padding:4px 8px;margin-bottom:4px;';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => renderView());
    form.appendChild(backBtn);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Template Title (e.g. My Weekly Standup)';
    nameInput.style.cssText = 'background:var(--bg);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:6px;font-size:12px;font-family:var(--font-mono);';

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.placeholder = 'Brief description (e.g. Format my weekly achievements)';
    descInput.style.cssText = 'background:var(--bg);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:6px;font-size:12px;font-family:var(--font-mono);';

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:11px;color:var(--amber);line-height:1.4;';

    const tipBold = document.createElement('b');
    tipBold.textContent = '💡 Pro Tip:';

    const code1 = document.createElement('code');
    code1.textContent = '{{variableName}}';

    const code2 = document.createElement('code');
    code2.textContent = '{{topic}}';

    const code3 = document.createElement('code');
    code3.textContent = '{{goal}}';

    tip.appendChild(tipBold);
    tip.appendChild(document.createTextNode(' Add '));
    tip.appendChild(code1);
    tip.appendChild(document.createTextNode(' anywhere to create fill-in blanks (e.g. '));
    tip.appendChild(code2);
    tip.appendChild(document.createTextNode(', '));
    tip.appendChild(code3);
    tip.appendChild(document.createTextNode(')!'));

    const promptText = document.createElement('textarea');
    promptText.placeholder = 'Write your template prompt here with {{variables}}...';
    promptText.style.cssText = 'background:var(--bg);border:1px solid var(--line);color:var(--text);padding:10px;border-radius:8px;font-size:12px;font-family:var(--font-mono);min-height:100px;resize:vertical;';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.style.cssText = 'background:var(--amber);color:#000;font-weight:bold;border:none;padding:10px;border-radius:8px;cursor:pointer;';
    saveBtn.textContent = 'Save Custom Template';

    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const template = promptText.value.trim();
      if (!name || !template) {
        showToast('Please provide a title and prompt');
        return;
      }
      const newTemplate = {
        id: 'custom-' + Date.now(),
        category: 'custom',
        categoryLabel: '⭐ Custom',
        name,
        description: descInput.value.trim() || 'Custom user template',
        template,
        variables: extractVariables(template),
        tags: ['custom']
      };

      customTemplates.unshift(newTemplate);
      stateObj.customTemplates = customTemplates;
      persist({ customTemplates }, { immediate: true });
      showToast('Template saved! ⭐');
      activeCategory = 'custom';
      renderView();
    });

    form.appendChild(nameInput);
    form.appendChild(descInput);
    form.appendChild(tip);
    form.appendChild(promptText);
    form.appendChild(saveBtn);
    modal.appendChild(form);
  }

  renderView();
}

